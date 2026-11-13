import type { Request, Response, NextFunction } from 'express';
import { UnauthorizedError, ForbiddenError } from '../errors/app-error';
import { AuthService, type TokenPayload } from '../../modules/auth/auth.service';
import { UserModel } from '../../modules/auth/auth.model';

// Extend Express Request type to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/**
 * Middleware that authenticates incoming requests using either:
 * 1. Bearer JWT token in Authorization header
 * 2. API Key in X-API-KEY header
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // 1. Check API Key header
    const apiKey = req.headers['x-api-key'] as string;
    if (apiKey) {
      const user = UserModel.findByApiKey(apiKey);
      if (user) {
        req.user = {
          userId: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
        };
        return next();
      }
      throw new UnauthorizedError('Invalid API Key provided');
    }

    // 2. Check Bearer JWT token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or malformed Authorization header. Expected: Bearer <token>');
    }

    const token = authHeader.split(' ')[1];
    const decoded = AuthService.verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Role-Based Access Control (RBAC) guard.
 */
export const authorizeRoles = (...allowedRoles: Array<'ADMIN' | 'ANALYST' | 'OPERATOR'>) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required before permission check'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new ForbiddenError(
          `Access forbidden: Role '${req.user.role}' lacks required permissions [${allowedRoles.join(', ')}]`
        )
      );
    }

    next();
  };
};

