import { getDatabase } from '../../config/database';
import { VectorService } from './vector.service';

export interface SearchQueryFilters {
  q?: string;
  mode?: 'keyword' | 'semantic' | 'hybrid';
  status?: string;
  supplier?: string;
  minAmount?: number;
  maxAmount?: number;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export class SearchService {
  /**
   * Performs hybrid search combining keyword filters and vector similarity.
   */
  static search(filters: SearchQueryFilters) {
    const db = getDatabase();
    const mode = filters.mode || 'hybrid';
    const page = Math.max(1, filters.page || 1);
    const limit = Math.max(1, Math.min(100, filters.limit || 20));
    const offset = (page - 1) * limit;

    let semanticMatches: Map<string, number> = new Map();

    // 1. If query is provided and mode involves semantic search, get vector matches
    if (filters.q && (mode === 'semantic' || mode === 'hybrid')) {
      const vectorResults = VectorService.searchSimilar(filters.q, 50, 0.1);
      vectorResults.forEach((r) => semanticMatches.set(r.documentId, r.score));
    }

    // 2. Build SQL conditions for structured filtering & keyword search
    const conditions: string[] = ['1=1'];
    const params: any[] = [];

    if (filters.status) {
      conditions.push('d.status = ?');
      params.push(filters.status);
    }

    if (filters.supplier) {
      conditions.push('LOWER(e.supplier_name) LIKE ?');
      params.push(`%${filters.supplier.toLowerCase()}%`);
    }

    if (filters.minAmount !== undefined) {
      conditions.push('e.total >= ?');
      params.push(filters.minAmount);
    }

    if (filters.maxAmount !== undefined) {
      conditions.push('e.total <= ?');
      params.push(filters.maxAmount);
    }

    if (filters.startDate) {
      conditions.push('e.invoice_date >= ?');
      params.push(filters.startDate);
    }

    if (filters.endDate) {
      conditions.push('e.invoice_date <= ?');
      params.push(filters.endDate);
    }

    // Keyword text search condition
    if (filters.q && (mode === 'keyword' || mode === 'hybrid')) {
      const searchTerm = `%${filters.q.toLowerCase()}%`;
      conditions.push(`(
        LOWER(d.original_name) LIKE ? OR
        LOWER(e.invoice_number) LIKE ? OR
        LOWER(e.supplier_name) LIKE ? OR
        LOWER(e.customer_name) LIKE ? OR
        LOWER(e.raw_text) LIKE ?
      )`);
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Count total matching query
    const countSql = `
      SELECT COUNT(*) as total
      FROM documents d
      LEFT JOIN extractions e ON d.id = e.document_id
      WHERE ${conditions.join(' AND ')}
    `;
    const countRow = db.prepare(countSql).get(...params) as { total: number };
    const totalCount = countRow ? countRow.total : 0;

    // Fetch paginated results
    const selectSql = `
      SELECT
        d.id, d.original_name, d.mime_type, d.file_size, d.page_count,
        d.status, d.created_at, d.processing_time_ms,
        e.invoice_number, e.invoice_date, e.supplier_name, e.customer_name,
        e.subtotal, e.tax, e.total, e.currency,
        v.is_valid, v.requires_manual_review
      FROM documents d
      LEFT JOIN extractions e ON d.id = e.document_id
      LEFT JOIN validations v ON d.id = v.document_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY d.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const rows = db.prepare(selectSql).all(...params, limit, offset) as any[];

    // Annotate with semantic match score if available
    const enrichedResults = rows.map((row) => ({
      ...row,
      semanticScore: semanticMatches.get(row.id) || 0,
    }));

    // If semantic mode is prioritized, sort by semantic score
    if (mode === 'semantic' && filters.q) {
      enrichedResults.sort((a, b) => b.semanticScore - a.semanticScore);
    }

    return {
      results: enrichedResults,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
      },
    };
  }
}

