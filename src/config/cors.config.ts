import type { CorsOptions } from 'cors';
import { env } from './env.config';

/**
 * Enterprise CORS (Cross-Origin Resource Sharing) Configuration.
 * Restricts access to trusted origins while supporting localhost and configured origins.
 */
export const getCorsOptions = (): CorsOptions => {
  const allowedOrigins = env.CORS_ORIGIN === '*'
    ? '*'
    : env.CORS_ORIGIN.split(',').map((origin) => origin.trim());

  return {
    origin: (origin, callback) => {
      // Allow requests with no origin (such as mobile apps, curl, or server-to-server)
      if (!origin || allowedOrigins === '*') {
        return callback(null, true);
      }

      if (allowedOrigins.indexOf(origin) !== -1 || origin.startsWith('http://localhost:')) {
        return callback(null, true);
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS policy.`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-KEY'],
    exposedHeaders: ['Content-Range', 'X-Content-Range', 'X-Total-Count'],
    credentials: true,
    maxAge: 86400, // 24 hours preflight cache
  };
};

