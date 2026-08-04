import { PrismaClient } from "@/generated/prisma/client";
import { newPrismaClient } from "./prisma-factory";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? newPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
