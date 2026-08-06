// Lets a signed-in user set their own password. This is the only way an
// account created with a temporary password becomes usable: the gate in
// proxy.ts keeps such a session out of every other page until it succeeds.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, SESSION_COOKIE } from "@/lib/auth";
import { createSessionToken, hashPassword, verifyPassword, type Role } from "@/lib/auth-crypto";

const MIN_LENGTH = 12;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { currentPassword, newPassword } = (await request.json()) as {
    currentPassword?: string;
    newPassword?: string;
  };
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "both passwords are required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { username: session.username } });
  // the current password is required even on a forced change, so a walk-up at
  // an unlocked screen cannot silently take the account over
  if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
    return NextResponse.json({ error: "current password is wrong" }, { status: 403 });
  }
  if (newPassword.length < MIN_LENGTH) {
    return NextResponse.json(
      { error: `password must be at least ${MIN_LENGTH} characters` },
      { status: 400 }
    );
  }
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: "choose a different password" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(newPassword), mustChangePassword: false },
  });
  await prisma.auditLog.create({
    data: {
      entity: "user",
      entityId: user.id,
      action: "PASSWORD_CHANGE",
      data: JSON.stringify({ username: user.username, forced: user.mustChangePassword }),
      username: session.username,
    },
  });

  // reissue the cookie without the mustChange flag so the gate lifts
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, createSessionToken(user.username, user.role as Role), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 3600 * 24 * 14,
  });
  return res;
}
