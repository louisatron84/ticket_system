import { userPreferences, type Db } from '@forge/db';
import { preferencesSchema, type Preferences } from '@forge/shared';
import { eq } from 'drizzle-orm';

/** Stored preferences, or {} when none exist or the stored value no longer fits the schema. */
export async function loadPreferences(db: Db, userId: string): Promise<Preferences> {
  const [row] = await db
    .select({ data: userPreferences.data })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId));
  const parsed = preferencesSchema.safeParse(row?.data ?? {});
  return parsed.success ? parsed.data : {};
}
