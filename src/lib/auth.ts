// Server-side session helpers (App Router).
import { cookies } from "next/headers";
import { verifySessionToken, type SessionData } from "./auth-crypto";
import { canEditData } from "./permissions";

export const SESSION_COOKIE = "hf-session";

export async function getSession(): Promise<SessionData | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/** For admin-only APIs (structure, settings, 1C sync, requests): ADMIN or null. */
export async function requireAdmin(): Promise<SessionData | null> {
  const s = await getSession();
  return s?.role === "ADMIN" ? s : null;
}

/** For data-entry APIs: ADMIN or STAFF, otherwise null. */
export async function requireDataEditor(): Promise<SessionData | null> {
  const s = await getSession();
  return canEditData(s?.role) ? s : null;
}
