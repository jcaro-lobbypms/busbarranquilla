import { Router } from 'express';
import { createReport, listNearbyReports, confirmReport, resolveReport, getOccupancy, getRouteReports } from '../controllers/reportController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Rutas nombradas ANTES de rutas con parámetros
router.get('/nearby', listNearbyReports);
router.get('/occupancy/:routeId', getOccupancy);
router.get('/route/:routeId', authMiddleware, getRouteReports);
router.post('/', authMiddleware, createReport);
router.put('/:id/confirm', authMiddleware, confirmReport);
router.patch('/:id/resolve', authMiddleware, resolveReport);

export default router;
