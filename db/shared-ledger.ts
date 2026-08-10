const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS shared_ledgers (
    id TEXT PRIMARY KEY NOT NULL,
    write_token_hash TEXT NOT NULL,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`;

const CREATE_DEVICES_SQL = `
  CREATE TABLE IF NOT EXISTS ledger_devices (
    id TEXT PRIMARY KEY NOT NULL,
    ledger_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL
  )
`;

const CREATE_PAIRING_CODES_SQL = `
  CREATE TABLE IF NOT EXISTS pairing_codes (
    id TEXT PRIMARY KEY NOT NULL,
    ledger_id TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  )
`;

const CREATE_DEVICE_TOKEN_INDEX_SQL = "CREATE UNIQUE INDEX IF NOT EXISTS ledger_devices_token_idx ON ledger_devices (ledger_id, token_hash)";
const CREATE_PAIRING_CODE_INDEX_SQL = "CREATE INDEX IF NOT EXISTS pairing_codes_lookup_idx ON pairing_codes (ledger_id, code_hash, expires_at)";

type SharedLedgerRow = {
  id: string;
  state_json: string;
  updated_at: number;
};

async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

async function ensureTable() {
  const db = await getD1();
  await db.batch([
    db.prepare(CREATE_TABLE_SQL),
    db.prepare(CREATE_DEVICES_SQL),
    db.prepare(CREATE_PAIRING_CODES_SQL),
    db.prepare(CREATE_DEVICE_TOKEN_INDEX_SQL),
    db.prepare(CREATE_PAIRING_CODE_INDEX_SQL),
  ]);
  return db;
}

function randomToken(bytes = 24) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function pairingCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const values = crypto.getRandomValues(new Uint8Array(12));
  const raw = Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

async function canWrite(db: D1Database, id: string, writeTokenHash: string) {
  const owner = await db.prepare(
    "SELECT id FROM shared_ledgers WHERE id = ? AND write_token_hash = ?",
  ).bind(id, writeTokenHash).first<{ id: string }>();
  if (owner) return true;
  const device = await db.prepare(
    "SELECT id FROM ledger_devices WHERE ledger_id = ? AND token_hash = ?",
  ).bind(id, writeTokenHash).first<{ id: string }>();
  if (!device) return false;
  await db.prepare("UPDATE ledger_devices SET last_used_at = ? WHERE id = ?")
    .bind(Date.now(), device.id).run();
  return true;
}

export async function createSharedLedger(state: unknown) {
  const db = await ensureTable();
  const id = randomToken(18);
  const writeToken = randomToken(32);
  const writeTokenHash = await hashToken(writeToken);
  const updatedAt = Date.now();
  await db.prepare(
    "INSERT INTO shared_ledgers (id, write_token_hash, state_json, updated_at) VALUES (?, ?, ?, ?)",
  ).bind(id, writeTokenHash, JSON.stringify(state), updatedAt).run();
  return { id, writeToken, updatedAt };
}

export async function getSharedLedger(id: string) {
  const db = await ensureTable();
  const row = await db.prepare(
    "SELECT id, state_json, updated_at FROM shared_ledgers WHERE id = ?",
  ).bind(id).first<SharedLedgerRow>();
  if (!row) return null;
  return { id: row.id, state: JSON.parse(row.state_json), updatedAt: row.updated_at };
}

export async function updateSharedLedger(id: string, writeToken: string, state: unknown) {
  const db = await ensureTable();
  const writeTokenHash = await hashToken(writeToken);
  if (!await canWrite(db, id, writeTokenHash)) return null;
  const updatedAt = Date.now();
  const result = await db.prepare(
    "UPDATE shared_ledgers SET state_json = ?, updated_at = ? WHERE id = ?",
  ).bind(JSON.stringify(state), updatedAt, id).run();
  return result.meta.changes > 0 ? { updatedAt } : null;
}

export async function createPairingCode(id: string, writeToken: string) {
  const db = await ensureTable();
  const writeTokenHash = await hashToken(writeToken);
  if (!await canWrite(db, id, writeTokenHash)) return null;
  const code = pairingCode();
  const codeHash = await hashToken(code.replaceAll("-", ""));
  const expiresAt = Date.now() + 10 * 60 * 1000;
  await db.prepare("DELETE FROM pairing_codes WHERE expires_at < ? OR used_at IS NOT NULL")
    .bind(Date.now()).run();
  await db.prepare(
    "INSERT INTO pairing_codes (id, ledger_id, code_hash, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)",
  ).bind(randomToken(18), id, codeHash, expiresAt).run();
  return { code, expiresAt };
}

export async function claimPairingCode(id: string, code: string, label: string) {
  const db = await ensureTable();
  const normalizedCode = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const codeHash = await hashToken(normalizedCode);
  const now = Date.now();
  const pairing = await db.prepare(
    "SELECT id FROM pairing_codes WHERE ledger_id = ? AND code_hash = ? AND expires_at >= ? AND used_at IS NULL ORDER BY expires_at DESC LIMIT 1",
  ).bind(id, codeHash, now).first<{ id: string }>();
  if (!pairing) return null;
  const used = await db.prepare(
    "UPDATE pairing_codes SET used_at = ? WHERE id = ? AND used_at IS NULL",
  ).bind(now, pairing.id).run();
  if (used.meta.changes <= 0) return null;
  const writeToken = randomToken(32);
  const tokenHash = await hashToken(writeToken);
  await db.prepare(
    "INSERT INTO ledger_devices (id, ledger_id, token_hash, label, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(randomToken(18), id, tokenHash, label.slice(0, 60), now, now).run();
  const ledger = await getSharedLedger(id);
  return ledger ? { writeToken, state: ledger.state, updatedAt: ledger.updatedAt } : null;
}
