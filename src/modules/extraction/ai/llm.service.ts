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
   * Universal text generation supporting both OpenAI Chat Completions and OpenAI Responses API
   */
  static async generateCompletion(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options: { jsonFormat?: boolean; temperature?: number } = {}
  ): Promise<string | null> {
    if (!env.LLM_API_KEY) {
      logger.debug('No LLM_API_KEY provided; skipping remote LLM inference.');
      return null;
    }

    const { jsonFormat = false, temperature = 0.0 } = options;

    // Helper: try Responses API (/v1/responses)
    const tryResponsesApi = async (): Promise<string | null> => {
      const url = env.LLM_BASE_URL.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '') + '/responses';
      const promptText = messages.map((m) => `${m.role.toUpperCase()}:\n${m.content}`).join('\n\n');
      
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.LLM_API_KEY}`,
        },
        body: JSON.stringify({
          model: env.LLM_MODEL,
          input: promptText,
          temperature,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Responses API returned ${res.status}: ${err}`);
      }

      const data = await res.json() as any;
      if (data.output_text) return data.output_text;
      if (data.output?.[0]?.content?.[0]?.text) return data.output[0].content[0].text;
      if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
      return JSON.stringify(data);
    };

    // Helper: try Chat Completions API (/v1/chat/completions)
    const tryChatCompletionsApi = async (): Promise<string | null> => {
      const url = env.LLM_BASE_URL.replace(/\/responses\/?$/, '').replace(/\/+$/, '') + '/chat/completions';
      const bodyPayload: any = {
        model: env.LLM_MODEL,
        messages,
        temperature,
      };
      if (jsonFormat) {
        bodyPayload.response_format = { type: 'json_object' };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.LLM_API_KEY}`,
        },
        body: JSON.stringify(bodyPayload),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Chat Completions API returned ${res.status}: ${err}`);
      }

      const data = await res.json() as any;
      return data.choices?.[0]?.message?.content || null;
    };

    // Auto-detect endpoint preference based on base URL
    const isResponsesEndpoint = env.LLM_BASE_URL.includes('/responses') || env.LLM_BASE_URL.includes('freegg');

    try {
      if (isResponsesEndpoint) {
        try {
          return await tryResponsesApi();
        } catch (err: any) {
          logger.warn(`Responses API failed (${err.message}). Trying standard Chat Completions fallback...`);
          return await tryChatCompletionsApi();
        }
      } else {
        try {
          return await tryChatCompletionsApi();
        } catch (err: any) {
          logger.warn(`Chat Completions failed (${err.message}). Trying Responses API fallback...`);
          return await tryResponsesApi();
        }
      }
    } catch (err: any) {
      logger.warn(`All LLM API endpoints failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Calls LLM API to extract structured invoice data with zero hallucination.
   */
  static async extractWithLlm(documentText: string): Promise<InvoiceExtractionData | null> {
    if (!env.LLM_API_KEY) {
      return null;
    }

    try {
      logger.info('Calling LLM API for zero-hallucination document extraction...');
      const responseContent = await this.generateCompletion(
        [
          { role: 'system', content: INVOICE_EXTRACTION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Please extract structured data from the following document text:\n\n${documentText.slice(0, 15000)}`,
          },
        ],
        { jsonFormat: true, temperature: 0.0 }
      );

      if (!responseContent) return null;

      // Extract JSON if wrapped in markdown code fences
      const cleanJson = responseContent.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '').trim();
      const parsed: InvoiceExtractionData = JSON.parse(cleanJson);
      return parsed;
    } catch (error: any) {
      logger.warn(`LLM extraction request failed: ${error.message}. Falling back to heuristic extractor.`);
      return null;
    }
  }
}
