import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Small key/value table for facts about the installation itself. */
export const systemMetadata = pgTable('system_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
