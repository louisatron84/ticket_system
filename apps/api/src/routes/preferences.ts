import { userPreferences, type Db } from '@forge/db';
import { MAX_REMEMBERED_PROJECTS, preferencesSchema, type Preferences } from '@forge/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/guards';
import { AppError } from '../errors';
import { loadPreferences } from '../preferences';
import { parseBody } from '../validation';

export function registerPreferencesRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;

  app.get(
    '/api/v1/me/preferences',
    { preHandler: requireUser },
    async (request): Promise<Preferences> => loadPreferences(db, request.auth!.user.id),
  );

  app.patch(
    '/api/v1/me/preferences',
    { preHandler: requireUser },
    async (request): Promise<Preferences> => {
      const patch = parseBody(preferencesSchema, request.body);
      const userId = request.auth!.user.id;

      // For a person with nothing saved yet the patch is stored as it is, except that a choice
      // being forgotten (null) has nothing to store.
      const { boardColumns, ticketsBoardColumns, ...rest } = patch;
      const firstSave = {
        ...rest,
        ...(ticketsBoardColumns ? { ticketsBoardColumns } : {}),
        ...(boardColumns
          ? {
              boardColumns: Object.fromEntries(
                Object.entries(boardColumns).filter(([, choice]) => choice !== null),
              ),
            }
          : {}),
      };

      // Otherwise the merge happens in one statement in the database, so two quick changes cannot
      // overwrite each other with stale copies. Plain jsonb `||` replaces a key's whole value, so
      // `board` and `board.fields` are merged by hand (a change to one field keeps the others), and
      // `notifications` merges kind by kind, `boardColumns` merges project by project, with null removing a project. A null
      // `ticketsBoardColumns` removes the key instead of storing a null.
      const incoming = sql`${JSON.stringify(patch)}::jsonb`;
      const stored = sql`coalesce(${userPreferences.data}->'board', '{}'::jsonb)`;
      const projectCount = sql<number>`(select count(*)::int from jsonb_object_keys(
            coalesce(${userPreferences.data}->'boardColumns', '{}'::jsonb)))`;
      await db.transaction(async (tx) => {
        // Locked, so the count before and after belong to this change alone.
        const [before] = await tx
          .select({ projects: projectCount })
          .from(userPreferences)
          .where(eq(userPreferences.userId, userId))
          .for('update');
        const [saved] = await tx
          .insert(userPreferences)
          .values({ userId, data: firstSave })
          .onConflictDoUpdate({
            target: userPreferences.userId,
            set: {
              data: sql`((${userPreferences.data} || (${incoming} - 'board' - 'boardColumns' - 'notifications'))
              || CASE WHEN ${incoming} ? 'notifications' THEN jsonb_build_object('notifications',
                   coalesce(${userPreferences.data}->'notifications', '{}'::jsonb)
                   || (${incoming}->'notifications'))
                 ELSE '{}'::jsonb END
              || CASE WHEN ${incoming} ? 'boardColumns' THEN jsonb_build_object('boardColumns',
                   jsonb_strip_nulls(
                     coalesce(${userPreferences.data}->'boardColumns', '{}'::jsonb)
                     || (${incoming}->'boardColumns')))
                 ELSE '{}'::jsonb END
              || CASE WHEN ${incoming} ? 'board' THEN jsonb_build_object('board',
                   (${stored} - 'fields')
                   || ((${incoming}->'board') - 'fields')
                   || CASE WHEN ${stored} ? 'fields' OR (${incoming}->'board') ? 'fields'
                        THEN jsonb_build_object('fields',
                          coalesce(${stored}->'fields', '{}'::jsonb)
                          || coalesce(${incoming}->'board'->'fields', '{}'::jsonb))
                        ELSE '{}'::jsonb END)
                 ELSE '{}'::jsonb END)
              - CASE WHEN jsonb_typeof(${incoming}->'ticketsBoardColumns') = 'null'
                  THEN 'ticketsBoardColumns' ELSE '' END`,
              updatedAt: new Date(),
            },
          })
          .returning({ projects: projectCount });
        // The patch alone is capped by the schema; the cap must hold for what is stored after the
        // merge too, or repeated small patches would grow the row without end. Over the cap, the
        // whole change is undone. Only a change that adds projects is refused: someone already over
        // the cap (from before it held) can still change other settings and forget projects.
        if (
          saved &&
          saved.projects > MAX_REMEMBERED_PROJECTS &&
          saved.projects > (before?.projects ?? 0)
        ) {
          throw new AppError(
            'validation_failed',
            `Column choices can be remembered for at most ${MAX_REMEMBERED_PROJECTS} projects. Reset some boards first.`,
            422,
            [{ path: 'boardColumns', message: `At most ${MAX_REMEMBERED_PROJECTS} projects.` }],
          );
        }
      });

      return loadPreferences(db, userId);
    },
  );
}
