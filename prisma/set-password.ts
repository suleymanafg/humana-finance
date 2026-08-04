import "dotenv/config";
// Change a user's password against whichever database DATABASE_URL points at.
// There is no password-change screen in the app yet, and the seeded logins
// (admin/admin123) are public knowledge in the repo, so they must not survive
// on a deployed instance.
//
//   npx tsx prisma/set-password.ts <username>
//
// The new password is read from stdin, never from argv — arguments show up in
// shell history and process listings.
import { createInterface } from "node:readline";
import { newPrismaClient } from "../src/lib/prisma-factory";
import { hashPassword } from "../src/lib/auth-crypto";

const username = process.argv[2];
const prisma = newPrismaClient();

function readSecret(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (a) => (rl.close(), resolve(a))));
}

async function main() {
  if (!username) {
    console.error("usage: npx tsx prisma/set-password.ts <username>");
    process.exitCode = 1;
    return;
  }
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    const all = await prisma.user.findMany({ select: { username: true, role: true } });
    console.error(
      `no user "${username}". Existing: ${all.map((u) => `${u.username} (${u.role})`).join(", ")}`
    );
    process.exitCode = 1;
    return;
  }

  const password = (process.env.NEW_PASSWORD ?? (await readSecret(`New password for ${username}: `))).trim();
  if (password.length < 12) {
    console.error(`Too short (${password.length} chars). Use at least 12 — this login guards the whole P&L.`);
    process.exitCode = 1;
    return;
  }
  if (/^(admin|viewer|password)\d*$/i.test(password)) {
    console.error("That is a guessable password. Pick something else.");
    process.exitCode = 1;
    return;
  }

  await prisma.user.update({
    where: { username },
    data: { passwordHash: hashPassword(password) },
  });
  const target = (process.env.DATABASE_URL ?? "").startsWith("postgres") ? "Postgres (Neon)" : "local SQLite";
  console.log(`✓ password updated for "${username}" on ${target}`);
}

main()
  .catch((e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
