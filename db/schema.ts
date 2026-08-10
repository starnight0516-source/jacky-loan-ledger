import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sharedLedgers = sqliteTable("shared_ledgers", {
  id: text("id").primaryKey(),
  writeTokenHash: text("write_token_hash").notNull(),
  stateJson: text("state_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const ledgerDevices = sqliteTable("ledger_devices", {
  id: text("id").primaryKey(),
  ledgerId: text("ledger_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  label: text("label").notNull(),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at").notNull(),
});

export const pairingCodes = sqliteTable("pairing_codes", {
  id: text("id").primaryKey(),
  ledgerId: text("ledger_id").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
});
