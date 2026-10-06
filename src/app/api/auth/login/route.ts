import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSessionToken, verifyPassword } from "@/lib/auth-crypto";
import type { Role } from "@/lib/auth-crypto";
import { SESSION_COOKIE } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { username?: string; password?: string };
  const username = body.username?.trim();
  const password = body.password;
  if (!username || !password) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  // A phone capitalises the first letter of the login and a password copied
  // from a message often brings a space along: match the login regardless of
  // case (when that is unambiguous) and accept the password without the
  // surrounding spaces. Accounts are created with trimmed passwords.
  let user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    const sameName = await prisma.user.findMany({
      where: { username: { equals: username, mode: "insensitive" } },
      take: 2,
    });
    if (sameName.length === 1) user = sameName[0];
  }
  const trimmed = password.trim();
  const passwordOk =
    !!user &&
    (verifyPassword(password, user.passwordHash) || (trimmed !== password && verifyPassword(trimmed, user.passwordHash)));
  if (!user || !passwordOk) {
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
