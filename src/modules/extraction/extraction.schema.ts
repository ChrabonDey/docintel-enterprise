import { z } from 'zod';

export const lineItemSchema = z.object({
  description: z.string().min(1, 'Line item description is required'),
  quantity: z.number().min(0, 'Quantity cannot be negative').default(1),
  unit_price: z.number().min(0, 'Unit price cannot be negative').default(0),
  total_price: z.number().min(0, 'Total price cannot be negative').default(0),
});

export const invoiceExtractionSchema = z.object({
  invoice_number: z.string().nullable().default(null),
  invoice_date: z.string().nullable().default(null),
  supplier_name: z.string().nullable().default(null),
  customer_name: z.string().nullable().default(null),
  subtotal: z.number().nullable().default(null),
  tax: z.number().nullable().default(null),
  total: z.number().nullable().default(null),
  currency: z.string().nullable().default('USD'),
  line_items: z.array(lineItemSchema).default([]),
  confidence_scores: z.record(z.string(), z.number()).default({}),
  missing_fields: z.array(z.string()).default([]),
  uncertain_fields: z.array(z.string()).default([]),
});

export type LineItem = z.infer<typeof lineItemSchema>;
export type InvoiceExtractionData = z.infer<typeof invoiceExtractionSchema>;

