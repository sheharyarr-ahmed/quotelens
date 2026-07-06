// Hand-written Zod mirror of the backend quote schema. The single source of
// truth is backend/app/pipeline/schemas.py; a test converts this mirror via
// Zod's native z.toJSONSchema() and asserts field names, required sets, and
// enums match the committed schema/quote.schema.json artifact
// (SPEC.md - Quote schema and integrity).

import { z } from 'zod';

export const unitSchema = z.enum(['sqft', 'linear_ft', 'each', 'flat']);
export const confidenceSchema = z.enum(['stated', 'inferred']);
export const quoteStatusSchema = z.enum([
  'generating',
  'completed',
  'failed',
  'sent',
  'accepted',
]);

export const quoteLineItemSchema = z.object({
  description: z.string(),
  quantity: z.number().positive(),
  unit: unitSchema,
  price_book_item_id: z.string().nullable().default(null),
  unit_price_cents: z.number().int().min(0).nullable().default(null),
  total_cents: z.number().int().min(0).nullable().default(null),
  photo_citations: z.array(z.string()).min(1),
  confidence: confidenceSchema,
});

export const quoteSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  status: quoteStatusSchema,
  line_items: z.array(quoteLineItemSchema),
  subtotal_cents: z.number().int().min(0),
});

export type Unit = z.infer<typeof unitSchema>;
export type Confidence = z.infer<typeof confidenceSchema>;
export type QuoteStatus = z.infer<typeof quoteStatusSchema>;
export type QuoteLineItem = z.infer<typeof quoteLineItemSchema>;
export type Quote = z.infer<typeof quoteSchema>;
