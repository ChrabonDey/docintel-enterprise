import { createApp } from './app';
import { env } from './config/env.config';
import { getDatabase } from './config/database';
import { JobQueue } from './modules/jobs/queue.service';
import { setupGracefulShutdown } from './core/graceful-shutdown';
import { logger } from './core/logger';
import { UserModel } from './modules/auth/auth.model';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

async function bootstrap() {
  logger.info('🚀 Starting Enterprise Document Intelligence System...');

  // 1. Initialize SQLite Database & Tables
  const db = getDatabase();
  logger.info('💾 SQLite Database connected with WAL mode enabled.');

  // 2. Seed default users if table is empty
  const userCount = UserModel.count();
  if (userCount === 0) {
    logger.info('🌱 Seeding initial system administrator and analyst accounts...');
    const adminHash = await bcrypt.hash('AdminPass123!', 10);
    UserModel.create({
      id: uuidv4(),
      username: 'admin',
      email: 'admin@docintel.com',
      password_hash: adminHash,
      role: 'ADMIN',
      api_key: 'doc_key_admin_super_secret_master_token_2026',
    });

    const analystHash = await bcrypt.hash('AnalystPass123!', 10);
    UserModel.create({
      id: uuidv4(),
      username: 'analyst',
      email: 'analyst@docintel.com',
      password_hash: analystHash,
      role: 'ANALYST',
      api_key: 'doc_key_analyst_review_token_2026',
    });

    logger.info('✅ Initial users seeded: admin@docintel.com (AdminPass123!), analyst@docintel.com (AnalystPass123!)');
  }

  // 3. Initialize Background Job Processing Queue
  JobQueue.init();

  // 4. Create Express Application
  const app = createApp();

  // 5. Start HTTP Server
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    logger.info(`✨ DocIntel API Server running on http://localhost:${env.PORT} [${env.NODE_ENV}]`);
    logger.info(`🩺 Health check: http://localhost:${env.PORT}/api/v1/health`);
  });

  // 6. Setup Graceful Shutdown (SIGINT, SIGTERM, DB close, Queue drain)
  setupGracefulShutdown(server);
}

bootstrap().catch((error) => {
  logger.error('Fatal crash during server startup:', error);
  process.exit(1);
});
