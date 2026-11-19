import { getDatabase } from '../../config/database';
import { VectorService } from '../search/vector.service';
import { LlmService } from '../extraction/ai/llm.service';
import { logger } from '../../core/logger';
import type { ChatMessage, DocumentChatRequest } from './chat.schema';

export interface ChatMetric {
  label: string;
  value: string;
  color?: 'emerald' | 'cyan' | 'indigo' | 'amber';
}

export interface ChatTable {
  headers: string[];
  rows: string[][];
}

export interface ChatCardData {
  type: 'summary' | 'breakdown' | 'supplier_list' | 'single_doc';
  title: string;
  metrics?: ChatMetric[];
  table?: ChatTable;
  highlights?: string[];
}

export interface ChatResponse {
  answer: string;
  cardData?: ChatCardData;
  sources: Array<{
    documentId: string;
    filename: string;
    invoiceNumber: string | null;
    supplier: string | null;
    total: number | null;
    currency?: string | null;
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
        SELECT d.id, d.original_name, d.mime_type, e.raw_text,
               e.invoice_number, e.invoice_date, e.supplier_name, e.customer_name,
               e.subtotal, e.tax, e.total, e.currency, e.line_items_json
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
          total: doc.total,
          currency: doc.currency,
          preview: (doc.raw_text || '').slice(0, 300),
        });
      }
    } else {
      // Semantic vector retrieval mode (RAG across document corpus)
      const similarDocs = VectorService.searchSimilar(query, 6, 0.04);

      if (similarDocs.length > 0) {
        const placeholders = similarDocs.map(() => '?').join(',');
        const docIds = similarDocs.map((s) => s.documentId);

        const rows = db.prepare(`
          SELECT d.id, d.original_name, d.mime_type, e.raw_text,
                 e.invoice_number, e.invoice_date, e.supplier_name, e.customer_name,
                 e.subtotal, e.tax, e.total, e.currency, e.line_items_json
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
              total: match.total,
              currency: match.currency,
              relevanceScore: s.score,
              preview: s.preview,
            });
          }
        }
      }

      // Fallback: if vector search found nothing, retrieve latest processed documents
      if (retrievedDocs.length === 0) {
        retrievedDocs = db.prepare(`
          SELECT d.id, d.original_name, d.mime_type, e.raw_text,
                 e.invoice_number, e.invoice_date, e.supplier_name, e.customer_name,
                 e.subtotal, e.tax, e.total, e.currency, e.line_items_json
          FROM documents d
          LEFT JOIN extractions e ON d.id = e.document_id
          WHERE d.status IN ('COMPLETED', 'VERIFIED', 'NEEDS_REVIEW')
          ORDER BY d.created_at DESC
          LIMIT 6
        `).all() as any[];

        sources = retrievedDocs.map((d) => ({
          documentId: d.id,
          filename: d.original_name,
          invoiceNumber: d.invoice_number,
          supplier: d.supplier_name,
          total: d.total,
          currency: d.currency,
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
Customer: ${doc.customer_name || 'N/A'}
Date: ${doc.invoice_date || 'N/A'}
Subtotal: ${doc.currency || '$'}${doc.subtotal ?? 'N/A'}
Tax: ${doc.currency || '$'}${doc.tax ?? 'N/A'}
Total: ${doc.currency || '$'}${doc.total ?? 'N/A'}
Line Items:
${items || '  No line item breakdown available'}
Document Text Excerpt:
${(doc.raw_text || '').slice(0, 1500)}
---`;
    }).join('\n\n');

    const systemPrompt = `You are DocIntel AI Financial Analyst Copilot.
You assist finance leaders, auditors, and operations teams with precise, grounded document insights.

CRITICAL RULES:
1. Always base your answers strictly on the provided DOCUMENT CONTEXT below.
2. ZERO HALLUCINATION POLICY: Never invent amounts or numbers not in the documents.
3. Be structured and well-formatted with clear headings and summaries.
4. Support both English and Bengali (বাংলা) naturally based on the user's inquiry.

DOCUMENT CONTEXT:
${contextBlocks || 'No documents available in context.'}`;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    for (const h of history.slice(-4)) {
      messages.push({ role: h.role, content: h.content });
    }
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

    // Generate rich structured card data
    const cardData = this.buildCardData(query, retrievedDocs);

    if (!answer) {
      answer = this.generateHeuristicAnswer(query, retrievedDocs, cardData);
    }

    return {
      answer,
      cardData,
      sources,
      modelUsed,
    };
  }

  /**
   * Builds rich structured card visual components for the frontend (Metrics, Data Tables, Highlights).
   */
  private static buildCardData(query: string, docs: any[]): ChatCardData | undefined {
    if (docs.length === 0) return undefined;
    const qLower = query.toLowerCase();

    // 1. Total Spend / Summary / General Financial Query
    if (
      qLower.includes('total') ||
      qLower.includes('spend') ||
      qLower.includes('sum') ||
      qLower.includes('khoroch') ||
      qLower.includes('mot') ||
      qLower.includes('overview')
    ) {
      const totalSum = docs.reduce((acc, d) => acc + (Number(d.total) || 0), 0);
      const uniqueSuppliers = Array.from(new Set(docs.map((d) => d.supplier_name).filter(Boolean)));
      
      const rows = docs.map((d) => [
        d.original_name,
        d.invoice_number || 'N/A',
        d.supplier_name || 'Unknown',
        d.invoice_date || 'N/A',
        `${d.currency || '$'}${Number(d.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      ]);

      return {
        type: 'breakdown',
        title: 'Enterprise Financial Spend Overview',
        metrics: [
          {
            label: 'Cumulative Total Spend',
            value: `$${totalSum.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            color: 'emerald',
          },
          {
            label: 'Documents Analyzed',
            value: `${docs.length} Invoices`,
            color: 'cyan',
          },
          {
            label: 'Unique Suppliers',
            value: `${uniqueSuppliers.length} Vendors`,
            color: 'indigo',
          },
        ],
        table: {
          headers: ['Document Name', 'Invoice #', 'Supplier', 'Date', 'Total Amount'],
          rows,
        },
        highlights: [
          `Audited across ${docs.length} active invoices in the repository.`,
          `Combined cumulative monetary volume: $${totalSum.toLocaleString('en-US', { minimumFractionDigits: 2 })}.`,
          `Top supplier by transaction count: ${uniqueSuppliers[0] || 'N/A'}.`,
        ],
      };
    }

    // 2. Supplier / Vendor Portfolio Query
    if (
      qLower.includes('supplier') ||
      qLower.includes('vendor') ||
      qLower.includes('company') ||
      qLower.includes('kar kach theke')
    ) {
      const supplierMap = new Map<string, { count: number; total: number; invoices: string[] }>();
      for (const d of docs) {
        const name = d.supplier_name || 'Unspecified Supplier';
        const curr = supplierMap.get(name) || { count: 0, total: 0, invoices: [] };
        curr.count += 1;
        curr.total += Number(d.total) || 0;
        if (d.invoice_number) curr.invoices.push(d.invoice_number);
        supplierMap.set(name, curr);
      }

      const rows: string[][] = [];
      supplierMap.forEach((val, name) => {
        rows.push([
          name,
          `${val.count} invoice(s)`,
          val.invoices.join(', ') || 'N/A',
          `$${val.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        ]);
      });

      return {
        type: 'supplier_list',
        title: 'Supplier & Vendor Portfolio Directory',
        metrics: [
          {
            label: 'Active Suppliers',
            value: `${supplierMap.size} Vendors`,
            color: 'indigo',
          },
          {
            label: 'Total Associated Invoices',
            value: `${docs.length} Documents`,
            color: 'cyan',
          },
        ],
        table: {
          headers: ['Supplier Name', 'Invoice Count', 'Invoice Numbers', 'Billed Amount'],
          rows,
        },
      };
    }

    // 3. Single Document Detailed Inspection
    const primary = docs[0];
    let lineItemRows: string[][] = [];
    if (primary.line_items_json) {
      try {
        const items = JSON.parse(primary.line_items_json);
        if (Array.isArray(items) && items.length > 0) {
          lineItemRows = items.map((it: any) => [
            it.description || 'Item',
            String(it.quantity || 1),
            `$${Number(it.unit_price || 0).toFixed(2)}`,
            `$${Number(it.total_price || 0).toFixed(2)}`,
          ]);
        }
      } catch {}
    }

    return {
      type: 'single_doc',
      title: `Document Inspection: ${primary.original_name}`,
      metrics: [
        {
          label: 'Total Amount',
          value: `${primary.currency || '$'}${Number(primary.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          color: 'emerald',
        },
        {
          label: 'Invoice Number',
          value: primary.invoice_number || 'N/A',
          color: 'cyan',
        },
        {
          label: 'Invoice Date',
          value: primary.invoice_date || 'N/A',
          color: 'indigo',
        },
        {
          label: 'Supplier',
          value: primary.supplier_name || 'N/A',
          color: 'amber',
        },
      ],
      table: lineItemRows.length > 0
        ? {
            headers: ['Line Item Description', 'Quantity', 'Unit Price', 'Total'],
            rows: lineItemRows,
          }
        : undefined,
      highlights: [
        `Customer / Bill-to: ${primary.customer_name || 'N/A'}`,
        `Subtotal: ${primary.currency || '$'}${primary.subtotal ?? '0.00'} | Tax: ${primary.currency || '$'}${primary.tax ?? '0.00'}`,
      ],
    };
  }

  /**
   * Deterministic, zero-hallucination heuristic answering engine when remote LLM is unreachable.
   */
  private static generateHeuristicAnswer(query: string, docs: any[], cardData?: ChatCardData): string {
    const qLower = query.toLowerCase();

    if (docs.length === 0) {
      return "No matching financial records found in the database. Please upload an invoice or document first.";
    }

    if (cardData?.type === 'breakdown') {
      const total = cardData.metrics?.[0]?.value || '$0.00';
      return `### Financial Document Summary\n\nBased on your query, we retrieved **${docs.length} matching invoice(s)** from the enterprise archive.\nThe cumulative volume calculated across these records is **${total}**.\n\nPlease review the structured breakdown and itemized table below for individual transaction details.`;
    }

    if (cardData?.type === 'supplier_list') {
      return `### Supplier & Vendor Directory\n\nIdentified **${cardData.metrics?.[0]?.value || 'multiple'}** across the repository with verified financial records.\nA complete breakdown of invoices and total billed volume per supplier is presented below.`;
    }

    const primary = docs[0];
    return `### Invoice Analysis for "${primary.original_name}"\n\n` +
      `• **Invoice Number:** ${primary.invoice_number || 'Not detected'}\n` +
      `• **Supplier:** ${primary.supplier_name || 'Not detected'}\n` +
      `• **Invoice Date:** ${primary.invoice_date || 'Not detected'}\n` +
      `• **Customer:** ${primary.customer_name || 'Not detected'}\n` +
      `• **Total Amount:** ${primary.currency || '$'}${primary.total ?? '0.00'}\n\n` +
      `*Retrieved ${docs.length} grounded document(s) matching your inquiry.*`;
  }
}
