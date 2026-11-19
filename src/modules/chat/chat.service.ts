import { getDatabase } from '../../config/database';
import { VectorService } from '../search/vector.service';
import { LlmService } from '../extraction/ai/llm.service';
import { logger } from '../../core/logger';
import type { ChatMessage, DocumentChatRequest } from './chat.schema';

export interface ChatResponse {
  answer: string;
  sources: Array<{
    documentId: string;
    filename: string;
    invoiceNumber: string | null;
    supplier: string | null;
    total: number | null;
    relevanceScore?: number;
    preview: string;
  }>;
  modelUsed: string;
}

export class ChatService {
  /**
   * Process a RAG (Retrieval-Augmented Generation) query across enterprise documents.
   */
  static async query(request: DocumentChatRequest): Promise<ChatResponse> {
    const db = getDatabase();
    const { query, documentId, history = [] } = request;

    let retrievedDocs: any[] = [];
    let sources: ChatResponse['sources'] = [];

    if (documentId) {
      // Direct single-document retrieval mode
      const doc = db.prepare(`
        SELECT d.id, d.original_name, d.raw_text,
               e.invoice_number, e.supplier_name, e.total_amount, e.currency,
               e.invoice_date, e.line_items_json
        FROM documents d
        LEFT JOIN extractions e ON d.id = e.document_id
        WHERE d.id = ?
      `).get(documentId) as any;

      if (doc) {
        retrievedDocs.push(doc);
        sources.push({
          documentId: doc.id,
          filename: doc.original_name,
          invoiceNumber: doc.invoice_number,
          supplier: doc.supplier_name,
          total: doc.total_amount,
          preview: (doc.raw_text || '').slice(0, 300),
        });
      }
    } else {
      // Semantic vector retrieval mode (RAG across document corpus)
      const similarDocs = VectorService.searchSimilar(query, 5, 0.05);

      if (similarDocs.length > 0) {
        const placeholders = similarDocs.map(() => '?').join(',');
        const docIds = similarDocs.map((s) => s.documentId);

        const rows = db.prepare(`
          SELECT d.id, d.original_name, d.raw_text,
                 e.invoice_number, e.supplier_name, e.total_amount, e.currency,
                 e.invoice_date, e.line_items_json
          FROM documents d
          LEFT JOIN extractions e ON d.id = e.document_id
          WHERE d.id IN (${placeholders})
        `).all(...docIds) as any[];

        for (const s of similarDocs) {
          const match = rows.find((r) => r.id === s.documentId);
          if (match) {
            retrievedDocs.push(match);
            sources.push({
              documentId: match.id,
              filename: match.original_name,
              invoiceNumber: match.invoice_number,
              supplier: match.supplier_name,
              total: match.total_amount,
              relevanceScore: s.score,
              preview: s.preview,
            });
          }
        }
      }

      // Fallback: if vector search found nothing, retrieve latest processed documents
      if (retrievedDocs.length === 0) {
        retrievedDocs = db.prepare(`
          SELECT d.id, d.original_name, d.raw_text,
                 e.invoice_number, e.supplier_name, e.total_amount, e.currency,
                 e.invoice_date, e.line_items_json
          FROM documents d
          LEFT JOIN extractions e ON d.id = e.document_id
          WHERE d.processing_status = 'COMPLETED'
          ORDER BY d.created_at DESC
          LIMIT 5
        `).all() as any[];

        sources = retrievedDocs.map((d) => ({
          documentId: d.id,
          filename: d.original_name,
          invoiceNumber: d.invoice_number,
          supplier: d.supplier_name,
          total: d.total_amount,
          preview: (d.raw_text || '').slice(0, 300),
        }));
      }
    }

    // Build context prompt from retrieved document chunks
    const contextBlocks = retrievedDocs.map((doc, idx) => {
      let items = '';
      try {
        if (doc.line_items_json) {
          const parsed = JSON.parse(doc.line_items_json);
          items = parsed.map((it: any) => `  - ${it.description}: Qty ${it.quantity} x ${it.unit_price} = ${it.total_price}`).join('\n');
        }
      } catch {}

      return `[DOCUMENT ${idx + 1}: ${doc.original_name} (ID: ${doc.id})]
Invoice Number: ${doc.invoice_number || 'N/A'}
Supplier: ${doc.supplier_name || 'N/A'}
Date: ${doc.invoice_date || 'N/A'}
Total: ${doc.currency || '$'}${doc.total_amount ?? 'N/A'}
Line Items:
${items || '  No item breakdown available'}
Document Text Excerpt:
${(doc.raw_text || '').slice(0, 1500)}
---`;
    }).join('\n\n');

    const systemPrompt = `You are DocIntel AI Copilot, an enterprise financial document analyst and expert assistant.
You assist finance managers, auditors, and accountants with invoice inspection, vendor queries, total spend calculations, and compliance checks.

CRITICAL RULES:
1. Always base your answers strictly on the provided DOCUMENT CONTEXT below.
2. ZERO HALLUCINATION POLICY: If the answer cannot be determined from the documents, clearly state: "The provided documents do not contain sufficient information to answer this question."
3. Cite document names, invoice numbers, or amounts accurately when answering.
4. Support queries in both English and Bengali (বাংলা) naturally according to user language.

DOCUMENT CONTEXT:
${contextBlocks || 'No documents available in context.'}`;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    // Append last 4 messages of history for conversational context
    for (const h of history.slice(-4)) {
      messages.push({ role: h.role, content: h.content });
    }

    // Add current user query
    messages.push({ role: 'user', content: query });

    let answer: string | null = null;
    let modelUsed = 'Rule-based Heuristic Copilot (Offline)';

    try {
      const llmResult = await LlmService.generateCompletion(messages, { temperature: 0.2 });
      if (llmResult && llmResult.trim().length > 0) {
        answer = llmResult.trim();
        modelUsed = `LLM (${process.env.LLM_MODEL || 'gpt-6.1-sol'}) via ${process.env.LLM_BASE_URL || 'freegg.app'}`;
      }
    } catch (err: any) {
      logger.warn(`Remote LLM chat generation failed: ${err.message}. Using intelligent heuristic response.`);
    }

    // High quality offline heuristic fallback
    if (!answer) {
      answer = this.generateHeuristicAnswer(query, retrievedDocs);
    }

    return {
      answer,
      sources,
      modelUsed,
    };
  }

  /**
   * Deterministic, zero-hallucination heuristic answering engine when remote LLM is unreachable.
   */
  private static generateHeuristicAnswer(query: string, docs: any[]): string {
    const qLower = query.toLowerCase();

    if (docs.length === 0) {
      return "No documents found in the database. Please upload an invoice or document first.";
    }

    // Total spend / summary query
    if (qLower.includes('total') || qLower.includes('spend') || qLower.includes('sum') || qLower.includes('khoroch') || qLower.includes('mot')) {
      const totalSum = docs.reduce((acc, d) => acc + (Number(d.total_amount) || 0), 0);
      const docList = docs.map((d) => `• **${d.original_name}** (${d.invoice_number || 'N/A'}): ${d.currency || '$'}${d.total_amount ?? 0} from ${d.supplier_name || 'Unknown'}`).join('\n');
      return `### Financial Document Summary\n\nAcross ${docs.length} matching document(s), the cumulative total is **$${totalSum.toLocaleString('en-US', { minimumFractionDigits: 2 })}**.\n\n**Breakdown:**\n${docList}`;
    }

    // Supplier / vendor query
    if (qLower.includes('supplier') || qLower.includes('vendor') || qLower.includes('company') || qLower.includes('kar kach theke')) {
      const suppliers = Array.from(new Set(docs.map((d) => d.supplier_name).filter(Boolean)));
      return `### Identified Suppliers / Vendors\n\nThe following suppliers were found in the current documents:\n${suppliers.map((s) => `• **${s}**`).join('\n')}`;
    }

    // Default grounded preview response
    const primary = docs[0];
    return `### Document Analysis for "${primary.original_name}"\n\n` +
      `• **Invoice Number:** ${primary.invoice_number || 'Not detected'}\n` +
      `• **Supplier:** ${primary.supplier_name || 'Not detected'}\n` +
      `• **Invoice Date:** ${primary.invoice_date || 'Not detected'}\n` +
      `• **Total Amount:** ${primary.currency || '$'}${primary.total_amount ?? '0.00'}\n\n` +
      `*Retrieved ${docs.length} relevant document(s) matching your inquiry.*`;
  }
}
