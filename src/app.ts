import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { getCorsOptions } from './config/cors.config';
import { env } from './config/env.config';
import { logger } from './core/logger';
import { errorHandler } from './core/middleware/error.middleware';
import { NotFoundError } from './core/errors/app-error';
import { authRoutes } from './modules/auth/auth.routes';
import { documentRoutes } from './modules/documents/document.routes';
import { searchRoutes } from './modules/search/search.routes';
import { analyticsRoutes } from './modules/analytics/analytics.routes';
import { chatRoutes } from './modules/chat/chat.routes';
import { getDatabase } from './config/database';
import { JobQueue } from './modules/jobs/queue.service';

export function createApp(): express.Application {
  const app = express();

  // 1. Cross-Origin Resource Sharing (CORS)
  app.use(cors(getCorsOptions()));

  // 2. Body parsers
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: true, limit: '20mb' }));

  // 3. Request Logger middleware
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info(`${req.method} ${req.originalUrl} [${res.statusCode}] - ${duration}ms`);
    });
    next();
  });

  // 4. Serve uploads for document preview and public frontend bundle
  app.use('/uploads', express.static(path.resolve(env.UPLOAD_DIR)));
  app.use(express.static(path.resolve('public')));

  // 5. System Health Check & Liveness Probe
  app.get('/api/v1/health', (req, res) => {
    const db = getDatabase();
    const dbOk = Boolean(db.prepare('SELECT 1').get());
    const queueStatus = JobQueue.getQueueStatus();

    res.status(200).json({
      status: 'UP',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      services: {
        database: dbOk ? 'CONNECTED' : 'DISCONNECTED',
        jobQueue: queueStatus,
      },
    });
  });

  // 6. Application Routes (MVC Module Structure)
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/documents', documentRoutes);
  app.use('/api/v1/search', searchRoutes);
  app.use('/api/v1/analytics', analyticsRoutes);
  app.use('/api/v1/chat', chatRoutes);

  // 7. Serve frontend for root and HTML views
  app.get('/', (req, res) => {
    res.sendFile(path.resolve('public/index.html'));
  });

  // 8. Catch-all: serve index.html for client-side GET navigation, 404 for undefined API endpoints
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.resolve('public/index.html'));
    }
    next(new NotFoundError(`Resource not found at endpoint: ${req.method} ${req.originalUrl}`));
  });

  // 9. Centralized Global Error Handler
  app.use(errorHandler);

  return app;
}
