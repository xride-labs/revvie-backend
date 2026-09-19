import { Router } from 'express';
import prisma from '../../lib/prisma.js';

const router = Router();

// In-process TTL cache — this endpoint is public, unauthenticated, and
// byte-identical for every caller; the data is reference/seed data that
// changes on the order of weeks/months (new manufacturer or model added),
// yet was previously hit on every single request with no caching at all.
// Same pattern as src/lib/notifications.ts's pushPrefCache. A simple
// in-process Map is fine here (not Redis) since the data is small, public,
// and identical across instances — worst case on a cache miss racing across
// instances is a handful of extra identical DB reads, not a correctness issue.
const CATALOG_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const manufacturersCache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(cache: Map<string, CacheEntry<unknown>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.value as T;
  return undefined;
}

function setCached<T>(cache: Map<string, CacheEntry<unknown>>, key: string, value: T): void {
  cache.set(key, { value, expiresAt: Date.now() + CATALOG_CACHE_TTL_MS });
}

// GET /api/catalog/manufacturers
router.get('/manufacturers', async (req, res) => {
  try {
    const cached = getCached(manufacturersCache, 'manufacturers');
    if (cached) {
      res.json(cached);
      return;
    }

    const manufacturers = await prisma.manufacturer.findMany({
      orderBy: { name: 'asc' },
    });
    setCached(manufacturersCache, 'manufacturers', manufacturers);
    res.json(manufacturers);
  } catch (error) {
    console.error('Error fetching manufacturers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/catalog/manufacturers/:id/models
router.get('/manufacturers/:id/models', async (req, res) => {
  try {
    const cacheKey = `models:${req.params.id}`;
    const cached = getCached(manufacturersCache, cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const models = await prisma.bikeModel.findMany({
      where: { manufacturerId: req.params.id },
      orderBy: { name: 'asc' },
    });
    setCached(manufacturersCache, cacheKey, models);
    res.json(models);
  } catch (error) {
    console.error('Error fetching bike models:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/catalog/bikes
router.get('/bikes', async (req, res) => {
  try {
    const cached = getCached(manufacturersCache, 'bikes');
    if (cached) {
      res.json(cached);
      return;
    }

    const bikes = await prisma.bikeModel.findMany({
      include: { manufacturer: true },
      orderBy: { name: 'asc' },
      take: 100,
    });
    setCached(manufacturersCache, 'bikes', bikes);
    res.json(bikes);
  } catch (error) {
    console.error('Error fetching catalog bikes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const catalogRoutes = router;
