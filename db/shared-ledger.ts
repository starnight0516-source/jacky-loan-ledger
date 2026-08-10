const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS shared_ledgers (
    id TEXT PRIMARY KEY NOT NULL,
    write_token_hash TEXT NOT NULL,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`;

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
  await db.prepare(CREATE_TABLE_SQL).run();
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
  const updatedAt = Date.now();
  const result = await db.prepare(
    "UPDATE shared_ledgers SET state_json = ?, updated_at = ? WHERE id = ? AND write_token_hash = ?",
  ).bind(JSON.stringify(state), updatedAt, id, writeTokenHash).run();
  return result.meta.changes > 0 ? { updatedAt } : null;
}
