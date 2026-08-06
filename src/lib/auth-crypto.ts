// Password hashing (scrypt) and HMAC session tokens — no native deps.
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const SECRET = process.env.SESSION_SECRET ?? "humana-dev-secret-change-in-prod";

/**
 * ADMIN  — everything, including structure (categories, products, settings).
 * STAFF  — fills in figures; cannot change structure or see admin-only pages.
 * VIEWER — reads everything, changes nothing.
 */
export const ROLES = ["ADMIN", "STAFF", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export interface SessionData {
  username: string;
  role: Role;
  exp: number; // unix seconds
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function createSessionToken(username: string, role: Role, ttlHours = 24 * 14): string {
  const data: SessionData = { username, role, exp: Math.floor(Date.now() / 1000) + ttlHours * 3600 };
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): SessionData | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as SessionData;
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    if (!ROLES.includes(data.role)) return null;
    return data;
  } catch {
    return null;
  }
}
