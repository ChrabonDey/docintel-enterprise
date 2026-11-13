import { z } from 'zod';
import { lineItemSchema } from '../extraction/extraction.schema';

export const manualCorrectionSchema = z.object({
  invoice_number: z.string().optional(),
  invoice_date: z.string().optional(),
  supplier_name: z.string().optional(),
  customer_name: z.string().optional(),
  subtotal: z.number().optional(),
  tax: z.number().optional(),
  total: z.number().optional(),
  currency: z.string().optional(),
  line_items: z.array(lineItemSchema).optional(),
  reason: z.string().min(3, 'A reason for manual correction must be provided for audit tracking'),
});

export const crossVerifySchema = z.object({
  docAId: z.string().min(1, 'Document A ID is required'),
  docBId: z.string().min(1, 'Document B ID is required'),
});

export const documentListQuerySchema = z.object({
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'NEEDS_REVIEW', 'VERIFIED', 'FAILED']).optional(),
  page: z.preprocess((val) => (val !== undefined && val !== '' ? parseInt(String(val), 10) : 1), z.number().int().min(1).default(1)),
  limit: z.preprocess((val) => (val !== undefined && val !== '' ? parseInt(String(val), 10) : 20), z.number().int().min(1).max(100).default(20)),
});

export const documentIdParamSchema = z.object({
  id: z.string().min(1, 'Document ID must be provided'),
});

export type DocumentListQueryInput = z.infer<typeof documentListQuerySchema>;
export type DocumentIdParamInput = z.infer<typeof documentIdParamSchema>;
export type ManualCorrectionInput = z.infer<typeof manualCorrectionSchema>;
export type CrossVerifyInput = z.infer<typeof crossVerifySchema>;

