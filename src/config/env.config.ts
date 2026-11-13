import { z } from 'zod';

/**
 * Environment configuration schema validated using Zod.
 * Ensures all required environment variables are strictly typed and provided.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform((val) => parseInt(val, 10)).default('4000'),
  JWT_SECRET: z.string().min(16).default('doc_intel_super_secure_secret_key_2026_xyz!'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  CORS_ORIGIN: z.string().default('*'),
  DATABASE_PATH: z.string().default('doc_intel.db'),
  UPLOAD_DIR: z.string().default('uploads'),
  MAX_FILE_SIZE_MB: z.string().transform((val) => parseInt(val, 10)).default('50'),
  QUEUE_CONCURRENCY: z.string().transform((val) => parseInt(val, 10)).default('4'),
  // Google OAuth Client Credentials (supplied via .env or Cloud environment variables)
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  // Optional LLM API configurations
  LLM_API_KEY: z.string().optional().default(''),
  LLM_BASE_URL: z.string().optional().default('https://api.openai.com/v1'),
  LLM_MODEL: z.string().optional().default('gpt-4o-mini'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables configuration:', parsedEnv.error.format());
  process.exit(1);
}

export const env = parsedEnv.data;
export type EnvConfig = z.infer<typeof envSchema>;

