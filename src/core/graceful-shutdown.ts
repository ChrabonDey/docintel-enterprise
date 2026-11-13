import type { Server } from 'node:http';
import { closeDatabase } from '../config/database';
import { logger } from './logger';

export interface GracefulService {
  name: string;
  shutdown: () => Promise<void> | void;
}

const servicesToShutdown: GracefulService[] = [];

/**
 * Register background workers or services to be terminated during shutdown.
 */
export function registerShutdownService(service: GracefulService) {
  servicesToShutdown.push(service);
}

/**
 * Configures graceful shutdown listeners for the Node/Bun process.
 */
export function setupGracefulShutdown(server: Server): void {
  let isShuttingDown = false;

  const handleShutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn(`Shutdown already in progress. Ignoring duplicate signal: ${signal}`);
      return;
    }
    isShuttingDown = true;
    logger.info(`🚨 Received ${signal}. Initiating graceful shutdown...`);

    // Force terminate if shutdown hangs longer than 15 seconds
    const forceExitTimer = setTimeout(() => {
      logger.error('⚠️ Graceful shutdown timed out after 15s. Forcing exit.');
      process.exit(1);
    }, 15000);
    forceExitTimer.unref();

    try {
      // 1. Stop HTTP server from accepting new connections
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            logger.error('Error closing HTTP server:', err);
            return reject(err);
          }
          logger.info('🛑 HTTP server stopped accepting new connections.');
          resolve();
        });
      });

      // 2. Stop and drain registered services (e.g. Queue workers, background timers)
      for (const service of servicesToShutdown) {
        try {
          logger.info(`Shutting down service: ${service.name}...`);
          await service.shutdown();
          logger.info(`✅ Service ${service.name} stopped successfully.`);
        } catch (svcErr) {
          logger.error(`Error shutting down service ${service.name}:`, svcErr);
        }
      }

      // 3. Close Database connection
      closeDatabase();

      logger.info('🎉 Graceful shutdown complete. Exiting process safely.');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown sequence:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));

  process.on('uncaughtException', (err) => {
    logger.error('💥 Uncaught Exception detected:', { error: err.message, stack: err.stack });
    handleShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('💥 Unhandled Promise Rejection detected:', { reason });
    handleShutdown('unhandledRejection');
  });
}

