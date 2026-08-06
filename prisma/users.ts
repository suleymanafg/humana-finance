import "dotenv/config";
// Manage login accounts. There is no user-management screen yet, so this is
// how accounts are created, listed, and removed.
//
//   npx tsx prisma/users.ts list [--production]
//   npx tsx prisma/users.ts add <username> <ADMIN|STAFF|VIEWER> [--production]
//   npx tsx prisma/users.ts remove <username> [--production]
//
// --production targets the live site via the commented `# DATABASE_URL_PRODUCTION=`
// line in .env. Without it the target is whatever DATABASE_URL points at (the
// dev branch), so an account created for the live site would silently go to a
// database nobody uses.
//
// The password is read from stdin, never from argv — arguments show up in shell
// history and process listings.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { newPrismaClient } from "../src/lib/prisma-factory";
import { ROLES, hashPassword, type Role } from "../src/lib/auth-crypto";

const [command, username, roleArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const useProduction = process.argv.includes("--production");

function productionUrl(): string {
  const env = readFileSync(".env", "utf8");
  const url = (env.match(/^#\s*DATABASE_URL_PRODUCTION=\s*"?([^"\n]+)/m) ?? [])[1]?.trim();
  if (!url) {
    throw new Error(
      "No `# DATABASE_URL_PRODUCTION=` line in .env. Add the live connection string there first."
    );
  }
  return url;
}

const prisma = newPrismaClient(useProduction ? productionUrl() : undefined);
const target = useProduction ? "PRODUCTION (the live site)" : "the dev branch";

function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (a) => (rl.close(), resolve(a))));
}

async function list() {
  const users = await prisma.user.findMany({ orderBy: { username: "asc" } });
  console.log(`Accounts on ${target}:`);
  for (const u of users) {
    console.log(`  ${u.username.padEnd(20)} ${u.role}`);
  }
  if (users.length === 0) console.log("  (none)");
}

async function add() {
  if (!username || !ROLES.includes(roleArg as Role)) {
    console.error(`usage: npx tsx prisma/users.ts add <username> <${ROLES.join("|")}> [--production]`);
    process.exitCode = 1;
    return;
  }
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.error(`"${username}" already exists on ${target} (role ${existing.role}).`);
    console.error("Use prisma/set-password.ts to change its password.");
    process.exitCode = 1;
    return;
  }

  if (roleArg === "ADMIN") {
    console.log(
      "\n⚠ ADMIN can change every figure, run the 1C sync, and instruct the AI assistant to write data."
    );
    const ok = await ask('Type "yes" to confirm an ADMIN account: ');
    if (ok.trim().toLowerCase() !== "yes") {
      console.log("cancelled");
      return;
    }
  } else if (roleArg === "STAFF") {
    console.log(
      "\nSTAFF fills in figures (OPEX, stock, AR, shipments, balance inputs) but cannot add or rename\n" +
        "categories, change Settings, or open Health checks / Data requests. They do see the P&L and margins."
    );
  } else {
    console.log(
      "\nVIEWER sees everything — P&L, margins, unit costs, the balance sheet — but cannot change anything."
    );
  }

  const password = (process.env.NEW_PASSWORD ?? (await ask(`Password for ${username}: `))).trim();
  if (password.length < 12) {
    console.error(`Too short (${password.length} chars). Use at least 12.`);
    process.exitCode = 1;
    return;
  }
  if (/^(admin|viewer|password|humana)\d*$/i.test(password)) {
    console.error("That is a guessable password. Pick something else.");
    process.exitCode = 1;
    return;
  }

  await prisma.user.create({
    data: { username, role: roleArg as Role, passwordHash: hashPassword(password) },
  });
  console.log(`✓ created "${username}" (${roleArg}) on ${target}`);
}

async function remove() {
  if (!username) {
    console.error("usage: npx tsx prisma/users.ts remove <username> [--production]");
    process.exitCode = 1;
    return;
  }
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    console.error(`no user "${username}" on ${target}`);
    process.exitCode = 1;
    return;
  }
  const admins = await prisma.user.count({ where: { role: "ADMIN" } });
  if (user.role === "ADMIN" && admins <= 1) {
    console.error("Refusing to remove the last ADMIN — you would lock yourself out.");
    process.exitCode = 1;
    return;
  }
  const ok = await ask(`Type "${username}" to confirm removal from ${target}: `);
  if (ok.trim() !== username) {
    console.log("cancelled");
    return;
  }
  await prisma.user.delete({ where: { username } });
  console.log(`✓ removed "${username}" from ${target}`);
}

async function main() {
  if (command === "list") return list();
  if (command === "add") return add();
  if (command === "remove") return remove();
  console.error("usage: npx tsx prisma/users.ts <list|add|remove> [...] [--production]");
  process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
