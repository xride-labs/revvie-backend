import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

let postgresConnectPromise: Promise<void> | null = null;

export async function connectPostgres(): Promise<void> {
  if (postgresConnectPromise) {
    return postgresConnectPromise;
  }

  postgresConnectPromise = prisma
    .$connect()
    .then(() => {
      console.log("✅ PostgreSQL connected successfully");
    })
    .catch((error: Error) => {
      postgresConnectPromise = null;
      console.error("❌ PostgreSQL connection failed:", error.message);
      throw error;
    });

  return postgresConnectPromise;
}

export { prisma };
export default prisma;
