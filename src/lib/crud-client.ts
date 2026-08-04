"use client";

export async function crud(
  entity: string,
  action: "create" | "update" | "delete" | "upsert",
  payload: { id?: string; data?: Record<string, unknown> }
): Promise<{ ok?: boolean; id?: string; error?: string }> {
  const res = await fetch(`/api/crud/${entity}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return (await res.json()) as { ok: boolean; id?: string };
}
