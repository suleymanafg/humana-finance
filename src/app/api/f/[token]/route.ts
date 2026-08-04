// Public submit endpoint for a tokenized data request. No session — the token
// is the credential, and it grants exactly one request. Values submitted here
// land in staging only; nothing reaches the P&L until an admin integrates.
import { NextResponse, type NextRequest } from "next/server";
import { loadByToken, markOpened, saveSubmission } from "@/lib/requests/service";

export async function GET(_request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const request = await loadByToken(token);
  if (!request) return NextResponse.json({ error: "not found" }, { status: 404 });
  await markOpened(request.id, request.status);
  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const body = (await request.json()) as {
    submit?: boolean;
    rows?: Array<{ id?: string; freeLabel?: string | null; value: number | null; note?: string | null }>;
  };
  const rows = Array.isArray(body.rows) ? body.rows : [];
  // a responder cannot invent an unbounded number of lines
  if (rows.length > 500) return NextResponse.json({ error: "too many rows" }, { status: 400 });

  const result = await saveSubmission(token, rows, body.submit === true);
  if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
