// Database errors that stop the whole app, told apart so the owner sees what to
// do: the schema is behind the code (deployed before `prisma db push`) or the
// database cannot be reached with the configured DATABASE_URL.
export interface DbProblem {
  kind: "schema" | "connection";
  /** the missing table or column, when the error names it */
  detail: string | null;
}

export function databaseProblem(e: unknown): DbProblem | null {
  const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
  const message = e instanceof Error ? e.message : "";
  if (code === "P2021" || code === "P2022") {
    return { kind: "schema", detail: message.match(/(?:table|column) `([^`]+)`/)?.[1] ?? null };
  }
  if (code === "P1000" || code === "P1001" || code === "P1003") return { kind: "connection", detail: null };
  return null;
}
