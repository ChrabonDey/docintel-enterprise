import { env } from '../../../config/env.config';
import { logger } from '../../../core/logger';
import type { InvoiceExtractionData } from '../extraction.schema';

export const INVOICE_EXTRACTION_SYSTEM_PROMPT = `
You are an Enterprise AI Document Intelligence Specialist for financial invoice and receipt extraction.
Your mission is to extract structured financial data with 100% precision and ZERO hallucination.

RULES:
1. Return ONLY valid, raw JSON without markdown code fences or conversational prose.
2. If a field is missing, obscured, or uncertain, set its value to null. NEVER invent, guess, or extrapolate values.
3. For numeric values (subtotal, tax, total, quantity, unit_price, total_price), return bare numbers, NOT strings with currency symbols.
4. Normalize dates to ISO-8601 (YYYY-MM-DD). If incomplete, return null.
5. Provide a 'confidence_scores' map with floating point scores (0.0 to 1.0) for each field.
6. Provide an array of 'missing_fields' for required invoice fields not found in the text.
7. Provide an array of 'uncertain_fields' for values where OCR noise or ambiguity lowers confidence below 0.70.

REQUIRED JSON OUTPUT SCHEMA:
{
  "invoice_number": string | null,
  "invoice_date": "YYYY-MM-DD" | null,
  "supplier_name": string | null,
  "customer_name": string | null,
  "subtotal": number | null,
  "tax": number | null,
  "total": number | null,
  "currency": string | null,
  "line_items": [
    {
      "description": string,
      "quantity": number,
      "unit_price": number,
      "total_price": number
    }
  ],
  "confidence_scores": {
    "invoice_number": number,
    "invoice_date": number,
    "supplier_name": number,
    "customer_name": number,
    "subtotal": number,
    "tax": number,
    "total": number,
    "line_items": number
  },
  "missing_fields": string[],
  "uncertain_fields": string[]
}
`;

export class LlmService {
  /**
   * Calls LLM API (OpenAI compatible / Gemini / local endpoint) to extract invoice data.
   */
  static async extractWithLlm(documentText: string): Promise<InvoiceExtractionData | null> {
    if (!env.LLM_API_KEY) {
      logger.debug('No LLM_API_KEY provided; skipping remote LLM inference.');
      return null;
    }

    try {
      logger.info('Calling LLM API for zero-hallucination document extraction...');
      const response = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.LLM_API_KEY}`,
        },
        body: JSON.stringify({
          model: env.LLM_MODEL,
          messages: [
            { role: 'system', content: INVOICE_EXTRACTION_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Please extract structured data from the following document text:\n\n${documentText.slice(0, 15000)}`,
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.0, // Zero temperature to eliminate creative hallucinations
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(`LLM API responded with error status ${response.status}: ${errorText}`);
        return null;
      }

      const json = await response.json();
      const content = json.choices?.[0]?.message?.content;
      if (!content) return null;

      const parsed: InvoiceExtractionData = JSON.parse(content);
      return parsed;
    } catch (error: any) {
      logger.warn(`LLM extraction request failed: ${error.message}. Falling back to heuristic extractor.`);
      return null;
    }
  }
}

