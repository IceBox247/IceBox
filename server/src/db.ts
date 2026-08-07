import { PrismaClient } from '@prisma/client';

// Single shared Prisma client. Re-used across hot reloads in dev.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** Round a money amount to 2 decimals to avoid float drift. */
export function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
