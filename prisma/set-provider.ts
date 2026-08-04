// Flips the datasource provider and regenerates the client, because those two
// must always agree and doing it by hand is how you end up with a 500 that
// says "DATABASE_URL is not set" on a perfectly good database.
//
//   npm run db:use-sqlite     # local, file:./dev.db
//   npm run db:use-postgres   # Neon
//
// It only edits the schema. Point DATABASE_URL at the matching database
// yourself — the app refuses to start if the two disagree.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const SCHEMA = "prisma/schema.prisma";
const target = process.argv[2];

if (target !== "sqlite" && target !== "postgresql") {
  console.error("usage: tsx prisma/set-provider.ts <sqlite|postgresql>");
  process.exit(1);
}

const before = readFileSync(SCHEMA, "utf8");
const after = before.replace(
  /(datasource db \{[\s\S]*?provider\s*=\s*)"(sqlite|postgresql)"/,
  `$1"${target}"`
);

if (before === after) {
  console.log(`provider already "${target}"`);
} else {
  writeFileSync(SCHEMA, after);
  console.log(`provider → "${target}"`);
}

const url = process.env.DATABASE_URL ?? "";
const looksPg = url.startsWith("postgres");
if (url && looksPg !== (target === "postgresql")) {
  console.warn(
    `\n⚠ DATABASE_URL looks like ${looksPg ? "Postgres" : "SQLite"} but the provider is now "${target}".` +
      "\n  Update DATABASE_URL in .env before starting the app."
  );
}

execSync("npx prisma generate", { stdio: "inherit" });
