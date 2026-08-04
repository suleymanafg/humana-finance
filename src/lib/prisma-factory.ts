// One place that knows which driver to use, imported by src/lib/db.ts (the
// app singleton) and by every script in prisma/.
//
// The adapter is chosen from the URL scheme, so local SQLite and Neon Postgres
// both work. The one thing that is NOT automatic is `provider` in
// prisma/schema.prisma — it must match, and changing it means regenerating:
//
//   SQLite  → provider = "sqlite",     DATABASE_URL=file:./dev.db
//   Neon    → provider = "postgresql", DATABASE_URL=postgresql://…-pooler…
//   then:   npx prisma generate
//
// `npm run db:use-sqlite` / `npm run db:use-postgres` do that flip for you.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Local tooling (`npx tsx prisma/…`) does not load .env, so outside production
 * an unset URL falls back to the dev database — that is what every script
 * relied on before. In production a missing URL must fail loudly instead:
 * silently opening an empty SQLite file would render the whole app as zeros.
 */
export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL is not set. Set the Neon connection string in the Vercel " +
        "project settings — refusing to fall back to a local SQLite file."
    );
  }
  return "file:./dev.db";
}

export const isPostgres = (url: string) => url.startsWith("postgres");

export function newPrismaClient(url = databaseUrl()): PrismaClient {
  const adapter = isPostgres(url)
    ? new PrismaPg({ connectionString: url })
    : new PrismaLibSql({ url });
  return new PrismaClient({ adapter });
}
