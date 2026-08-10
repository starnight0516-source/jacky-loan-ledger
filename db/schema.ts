import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sharedLedgers = sqliteTable("shared_ledgers", {
  id: text("id").primaryKey(),
  writeTokenHash: text("write_token_hash").notNull(),
  stateJson: text("state_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
