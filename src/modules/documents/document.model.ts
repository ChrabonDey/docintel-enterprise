import { getDatabase } from '../../config/database';

export interface DocumentEntity {
  id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  file_hash: string;
  page_count: number;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'NEEDS_REVIEW' | 'VERIFIED' | 'FAILED';
  failure_reason: string | null;
  retry_count: number;
  processing_time_ms: number;
  created_at: string;
  updated_at: string;
}

export class DocumentModel {
  private static get db() {
    return getDatabase();
  }

  static create(doc: Omit<DocumentEntity, 'created_at' | 'updated_at'>): DocumentEntity {
    const query = this.db.prepare(`
      INSERT INTO documents (
        id, filename, original_name, mime_type, file_size, file_hash,
        page_count, status, failure_reason, retry_count, processing_time_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    query.run(
      doc.id,
      doc.filename,
      doc.original_name,
      doc.mime_type,
      doc.file_size,
      doc.file_hash,
      doc.page_count,
      doc.status,
      doc.failure_reason,
      doc.retry_count,
      doc.processing_time_ms
    );

    return this.findById(doc.id)!;
  }

  static findById(id: string): DocumentEntity | null {
    const query = this.db.prepare('SELECT * FROM documents WHERE id = ?');
    return (query.get(id) as DocumentEntity) || null;
  }

  static findByHash(hash: string): DocumentEntity | null {
    const query = this.db.prepare('SELECT * FROM documents WHERE file_hash = ? ORDER BY created_at DESC LIMIT 1');
    return (query.get(hash) as DocumentEntity) || null;
  }

  static listAll(filters: {
    status?: string;
    limit?: number;
    offset?: number;
  }): { items: any[]; total: number } {
    const conditions: string[] = ['1=1'];
    const params: any[] = [];

    if (filters.status) {
      conditions.push('d.status = ?');
      params.push(filters.status);
    }

    const countSql = `SELECT COUNT(*) as count FROM documents d WHERE ${conditions.join(' AND ')}`;
    const total = (this.db.prepare(countSql).get(...params) as { count: number }).count;

    const limit = filters.limit || 20;
    const offset = filters.offset || 0;

    const querySql = `
      SELECT
        d.*,
        e.invoice_number, e.invoice_date, e.supplier_name, e.customer_name,
        e.subtotal, e.tax, e.total, e.currency,
        v.is_valid, v.requires_manual_review, v.review_reasons_json
      FROM documents d
      LEFT JOIN extractions e ON d.id = e.document_id
      LEFT JOIN validations v ON d.id = v.document_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY d.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const items = this.db.prepare(querySql).all(...params, limit, offset);
    return { items, total };
  }

  static updateStatus(id: string, status: DocumentEntity['status'], failureReason: string | null = null): void {
    const query = this.db.prepare(`
      UPDATE documents
      SET status = ?, failure_reason = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    query.run(status, failureReason, id);
  }

  static delete(id: string): boolean {
    const query = this.db.prepare('DELETE FROM documents WHERE id = ?');
    const result = query.run(id);
    return result.changes > 0;
  }
}

