import { Router } from 'express';
import prisma from '../../lib/prisma.js';

const router = Router();

// GET /api/catalog/manufacturers
router.get('/manufacturers', async (req, res) => {
  try {
    const manufacturers = await prisma.manufacturer.findMany({
      orderBy: { name: 'asc' },
    });
    res.json(manufacturers);
  } catch (error) {
    console.error('Error fetching manufacturers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/catalog/manufacturers/:id/models
router.get('/manufacturers/:id/models', async (req, res) => {
  try {
    const models = await prisma.bikeModel.findMany({
      where: { manufacturerId: req.params.id },
      orderBy: { name: 'asc' },
    });
    res.json(models);
  } catch (error) {
    console.error('Error fetching bike models:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const catalogRoutes = router;
