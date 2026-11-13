import { Router } from 'express';
import { AnalyticsController } from './analytics.controller';
import { authenticate } from '../../core/middleware/auth.middleware';

const router = Router();

router.get('/metrics', authenticate, AnalyticsController.getMetrics);

export const analyticsRoutes = router;

