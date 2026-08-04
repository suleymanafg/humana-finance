import type { PrismaClient } from "@/generated/prisma/client";
import { newPrismaClient } from "./prisma-factory";

// The client is created on first *use*, not on import.
//
// Next collects page data at build time, which imports this module. Building
// with an eagerly-constructed client meant the build failed whenever
// DATABASE_URL was absent — but a build never queries anything, so it has no
// business needing a database. Deferring construction keeps the build honest
// and still fails loudly at runtime if the URL is genuinely missing.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function client(): PrismaClient {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = newPrismaClient();
  return globalForPrisma.prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const real = client() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    // bind methods so `this` is the client, not the proxy
    return typeof value === "function" ? value.bind(real) : value;
  },
});
