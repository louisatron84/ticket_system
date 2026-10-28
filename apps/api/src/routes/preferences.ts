import { userPreferences, type Db } from '@forge/db';
import { preferencesSchema, type Preferences } from '@forge/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/guards';
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
      await db
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
        });

      return loadPreferences(db, userId);
    },
  );
}
