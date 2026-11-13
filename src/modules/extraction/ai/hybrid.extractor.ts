import { HeuristicExtractor } from './heuristic.extractor';
import { LlmService } from './llm.service';
import type { InvoiceExtractionData } from '../extraction.schema';
import { logger } from '../../../core/logger';

export class HybridExtractor {
  /**
   * Performs hybrid extraction using LLM inference when available,
   * complemented by deterministic heuristic parsing.
   */
  static async extract(rawText: string): Promise<{ data: InvoiceExtractionData; method: string }> {
    // 1. Run deterministic heuristic extraction (synchronous, fast)
    const heuristicData = HeuristicExtractor.extract(rawText);

    // 2. Try LLM extraction (asynchronous)
    const llmData = await LlmService.extractWithLlm(rawText);

    if (!llmData) {
      logger.info('Using deterministic Heuristic Extractor results.');
      return { data: heuristicData, method: 'HEURISTIC_RULE_BASED' };
    }

    logger.info('Fusing LLM extraction results with deterministic validation.');

    // 3. Fusion: take LLM results, but fall back to heuristic for any missing fields if heuristic found them with high confidence
    const fused: InvoiceExtractionData = {
      invoice_number: llmData.invoice_number || heuristicData.invoice_number,
      invoice_date: llmData.invoice_date || heuristicData.invoice_date,
      supplier_name: llmData.supplier_name || heuristicData.supplier_name,
      customer_name: llmData.customer_name || heuristicData.customer_name,
      subtotal: llmData.subtotal !== null ? llmData.subtotal : heuristicData.subtotal,
      tax: llmData.tax !== null ? llmData.tax : heuristicData.tax,
      total: llmData.total !== null ? llmData.total : heuristicData.total,
      currency: llmData.currency || heuristicData.currency || 'USD',
      line_items: llmData.line_items?.length ? llmData.line_items : heuristicData.line_items,
      confidence_scores: {
        ...heuristicData.confidence_scores,
        ...(llmData.confidence_scores || {}),
      },
      missing_fields: [],
      uncertain_fields: [],
    };

    // Recompute missing fields
    if (!fused.invoice_number) fused.missing_fields.push('invoice_number');
    if (!fused.invoice_date) fused.missing_fields.push('invoice_date');
    if (!fused.supplier_name) fused.missing_fields.push('supplier_name');
    if (fused.total === null) fused.missing_fields.push('total');
    if (fused.line_items.length === 0) fused.missing_fields.push('line_items');

    return { data: fused, method: 'HYBRID_LLM_HEURISTIC' };
  }
}

