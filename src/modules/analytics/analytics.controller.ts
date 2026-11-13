import type { Request, Response, NextFunction } from 'express';
import { AnalyticsService } from './analytics.service';

export class AnalyticsController {
  static getMetrics(req: Request, res: Response, next: NextFunction): void {
    try {
      const metrics = AnalyticsService.getMetrics();
      res.status(200).json({
        success: true,
        data: metrics,
      });
    } catch (error) {
      next(error);
    }
  }
}

