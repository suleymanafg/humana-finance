import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSessionToken, verifyPassword } from "@/lib/auth-crypto";
import type { Role } from "@/lib/auth-crypto";
import { SESSION_COOKIE } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const { username, password } = (await request.json()) as { username?: string; password?: string };
  if (!username || !password) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "invalid" }, { status: 401 });
  }
  const token = createSessionToken(user.username, user.role as Role, {
    mustChange: user.mustChangePassword,
  });
  const res = NextResponse.json({
    ok: true,
    role: user.role,
    mustChange: user.mustChangePassword,
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 3600 * 24 * 14,
  });
  return res;
}
