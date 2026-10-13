// Import of an uploaded list after the owner mapped its columns (ADMIN):
// mode "preview" reports what would happen, "commit" writes.
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { importRows, type ImportKind, type RawRow } from "@/lib/transition/service";

const KINDS: ImportKind[] = ["outlets", "stock", "tiSales"];

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await request.json()) as { kind?: ImportKind; mode?: "preview" | "commit"; rows?: RawRow[]; replace?: boolean };
  if (!body.kind || !KINDS.includes(body.kind)) return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  if (!Array.isArray(body.rows) || body.rows.length === 0) return NextResponse.json({ error: "rows required" }, { status: 400 });
  if (body.rows.length > 5000) return NextResponse.json({ error: "too many rows (max 5000)" }, { status: 400 });
  try {
    const result = await importRows(body.kind, body.rows, body.mode === "commit", session.username, { replace: !!body.replace });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}
