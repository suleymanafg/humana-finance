// Server-side session helpers (App Router).
import { cookies } from "next/headers";
import { verifySessionToken, type SessionData } from "./auth-crypto";

export const SESSION_COOKIE = "hf-session";

export async function getSession(): Promise<SessionData | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/** For mutation APIs: returns the session if ADMIN, otherwise null. */
export async function requireAdmin(): Promise<SessionData | null> {
  const s = await getSession();
  return s?.role === "ADMIN" ? s : null;
}
