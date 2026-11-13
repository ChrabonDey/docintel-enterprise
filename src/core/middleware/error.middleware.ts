import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app-error';
import { logger } from '../logger';

/**
 * Global Error Handling Middleware.
 * Catches all operational and unhandled errors, logs them, and formats clean JSON responses.
 */
export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void => {
  if (err instanceof AppError) {
    logger.warn(`Operational Error: ${err.message}`, {
      path: req.originalUrl,
      method: req.method,
      statusCode: err.statusCode,
      details: err.details,
    });

    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.name,
        message: err.message,
        details: err.details || null,
      },
    });
    return;
  }

  // Unhandled / Internal Server Error
  logger.error(`Unhandled Exception: ${err.message}`, {
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: process.env.NODE_ENV === 'production' ? 'Internal server error occurred' : err.message,
    },
  });
};

