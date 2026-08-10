import { createSharedLedger, getSharedLedger, updateSharedLedger } from "@/db/shared-ledger";

export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = new Set([
  "https://starnight0516-source.github.io",
  "https://jacky-loan-ledger.familywu5-3.chatgpt.site",
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const allowedOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://jacky-loan-ledger.familywu5-3.chatgpt.site";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });
}

function validState(state: unknown) {
  if (!state || typeof state !== "object") return false;
  const candidate = state as { settings?: unknown; records?: unknown; settlements?: unknown };
  return Boolean(candidate.settings && Array.isArray(candidate.records) && candidate.settlements && typeof candidate.settlements === "object");
}

async function requestBody(request: Request) {
  const size = Number(request.headers.get("content-length") ?? "0");
  if (size > 1_000_000) throw new Error("payload_too_large");
  return request.json() as Promise<{ id?: string; state?: unknown }>;
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
    if (!/^[a-f0-9]{36}$/.test(id)) return json(request, { error: "invalid_share_id" }, 400);
    const ledger = await getSharedLedger(id);
    return ledger ? json(request, ledger) : json(request, { error: "not_found" }, 404);
  } catch (error) {
    console.error(error);
    return json(request, { error: "read_failed" }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await requestBody(request);
    if (!validState(body.state)) return json(request, { error: "invalid_state" }, 400);
    const ledger = await createSharedLedger(body.state);
    return json(request, ledger, 201);
  } catch (error) {
    console.error(error);
    return json(request, { error: error instanceof Error ? error.message : "create_failed" }, 500);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await requestBody(request);
    const id = body.id?.trim() ?? "";
    const authorization = request.headers.get("authorization") ?? "";
    const writeToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!/^[a-f0-9]{36}$/.test(id) || !/^[a-f0-9]{64}$/.test(writeToken) || !validState(body.state)) {
      return json(request, { error: "invalid_request" }, 400);
    }
    const updated = await updateSharedLedger(id, writeToken, body.state);
    return updated ? json(request, updated) : json(request, { error: "forbidden" }, 403);
  } catch (error) {
    console.error(error);
    return json(request, { error: error instanceof Error ? error.message : "update_failed" }, 500);
  }
}
