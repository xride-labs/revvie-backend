import { Redis } from "ioredis";
import { aiConfig } from "../config/ai.config.js";

let redisClient: Redis | null = null;
if (process.env.REDIS_URL) {
  try {
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    redisClient.connect().catch(() => {
      // Redis unavailable, fallback to in-memory
      redisClient = null;
    });
  } catch (e) {
    redisClient = null;
  }
}

// In-memory fallback map: key -> count
const inMemoryStore = new Map<string, { count: number; date: string }>();

function getTodayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function resetUserCreditsForTesting(userId?: string) {
  inMemoryStore.clear();
  if (redisClient && redisClient.status === "ready") {
    try {
      if (userId) {
        await redisClient.del(`ai:credits:${userId}:${getTodayString()}`);
      } else {
        const keys = await redisClient.keys("ai:credits:*");
        if (keys.length) await redisClient.del(...keys);
      }
    } catch (e) {
      // Ignore in tests
    }
  }
}

export interface CreditStatus {
  allowed: boolean;
  remaining: number;
  limit: number;
  used: number;
}

export async function checkAndConsumeCredit(userId: string): Promise<CreditStatus> {
  const limit = aiConfig.dailyCreditsLimit;
  const today = getTodayString();
  const redisKey = `ai:credits:${userId}:${today}`;

  // 1. Try Redis first if available
  if (redisClient && redisClient.status === "ready") {
    try {
      const current = await redisClient.incr(redisKey);
      if (current === 1) {
        // Set TTL to 24h
        await redisClient.expire(redisKey, 86400);
      }

      if (current > limit) {
        // Exceeded
        return {
          allowed: false,
          remaining: 0,
          limit,
          used: current - 1,
        };
      }

      return {
        allowed: true,
        remaining: Math.max(0, limit - current),
        limit,
        used: current,
      };
    } catch (err) {
      // Fall through to in-memory
    }
  }

  // 2. In-memory fallback
  const memKey = `${userId}:${today}`;
  const existing = inMemoryStore.get(memKey);
  const currentCount = existing && existing.date === today ? existing.count : 0;

  if (currentCount >= limit) {
    return {
      allowed: false,
      remaining: 0,
      limit,
      used: currentCount,
    };
  }

  const nextCount = currentCount + 1;
  inMemoryStore.set(memKey, { count: nextCount, date: today });

  return {
    allowed: true,
    remaining: limit - nextCount,
    limit,
    used: nextCount,
  };
}

export async function getRemainingCredits(userId: string): Promise<{ remaining: number; limit: number; used: number }> {
  const limit = aiConfig.dailyCreditsLimit;
  const today = getTodayString();
  const redisKey = `ai:credits:${userId}:${today}`;

  if (redisClient && redisClient.status === "ready") {
    try {
      const val = await redisClient.get(redisKey);
      const used = val ? parseInt(val, 10) : 0;
      return {
        remaining: Math.max(0, limit - used),
        limit,
        used,
      };
    } catch (e) {
      // Fall through
    }
  }

  const memKey = `${userId}:${today}`;
  const existing = inMemoryStore.get(memKey);
  const used = existing && existing.date === today ? existing.count : 0;

  return {
    remaining: Math.max(0, limit - used),
    limit,
    used,
  };
}

/** Give back a credit when the model call failed, so outages don't burn quota. */
export async function refundCredit(userId: string): Promise<void> {
  const today = getTodayString();
  if (redisClient && redisClient.status === "ready") {
    try {
      await redisClient.decr(`ai:credits:${userId}:${today}`);
      return;
    } catch (e) {
      // Fall through to in-memory
    }
  }
  const existing = inMemoryStore.get(`${userId}:${today}`);
  if (existing && existing.count > 0) existing.count -= 1;
}
