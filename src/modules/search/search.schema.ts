import { z } from 'zod';

export const searchQuerySchema = z.object({
  q: z.string().optional(),
  mode: z.enum(['keyword', 'semantic', 'hybrid']).default('hybrid'),
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'NEEDS_REVIEW', 'VERIFIED', 'FAILED']).optional(),
  supplier: z.string().optional(),
  minAmount: z.preprocess((val) => (val !== undefined && val !== '' ? parseFloat(String(val)) : undefined), z.number().optional()),
  maxAmount: z.preprocess((val) => (val !== undefined && val !== '' ? parseFloat(String(val)) : undefined), z.number().optional()),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD format').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD format').optional(),
  page: z.preprocess((val) => (val !== undefined && val !== '' ? parseInt(String(val), 10) : 1), z.number().int().min(1).default(1)),
  limit: z.preprocess((val) => (val !== undefined && val !== '' ? parseInt(String(val), 10) : 20), z.number().int().min(1).max(100).default(20)),
});

export type SearchQueryInput = z.infer<typeof searchQuerySchema>;

