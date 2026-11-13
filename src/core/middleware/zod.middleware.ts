import type { Request, Response, NextFunction } from 'express';
import { z, type ZodSchema } from 'zod';
import { BadRequestError } from '../errors/app-error';

/**
 * Validates the Express request body against a Zod schema.
 */
export const validateBody = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync(req.body);
      req.body = parsed;
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        const errors = err.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        return next(new BadRequestError('Validation failed on request body', errors));
      }
      next(err);
    }
  };
};

/**
 * Validates request query parameters against a Zod schema.
 */
export const validateQuery = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync(req.query);
      Object.defineProperty(req, 'query', {
        value: parsed,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        const errors = err.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        return next(new BadRequestError('Validation failed on query parameters', errors));
      }
      next(err);
    }
  };
};

/**
 * Validates request route parameters against a Zod schema.
 */
export const validateParams = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync(req.params);
      Object.defineProperty(req, 'params', {
        value: parsed,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        const errors = err.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        return next(new BadRequestError('Validation failed on path parameters', errors));
      }
      next(err);
    }
  };
};

