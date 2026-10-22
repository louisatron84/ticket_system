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

      // jsonb concatenation merges atomically in the database, so two quick changes cannot
      // overwrite each other with stale copies.
      await db
        .insert(userPreferences)
        .values({ userId, data: patch })
        .onConflictDoUpdate({
          target: userPreferences.userId,
          set: {
            data: sql`${userPreferences.data} || ${JSON.stringify(patch)}::jsonb`,
            updatedAt: new Date(),
          },
        });

      return loadPreferences(db, userId);
    },
  );
}
