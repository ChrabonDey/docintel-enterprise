import { getDatabase } from '../../config/database';
import { v4 as uuidv4 } from 'uuid';
import { NotFoundError, BadRequestError } from '../../core/errors/app-error';

export interface CrossVerificationResult {
  id: string;
  docAId: string;
  docBId: string;
  docAName: string;
  docBName: string;
  status: 'MATCHED' | 'DISCREPANCY_FOUND' | 'FAILED';
  matchScore: number; // 0 to 100
  discrepancies: Array<{
    field: string;
    docAValue: any;
    docBValue: any;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    message: string;
  }>;
  summary: string;
  createdAt: string;
}

export class VerificationService {
  /**
   * Cross-verifies two documents (PDF vs PDF, PDF vs Excel, etc.).
   * Compares extracted financials, invoice numbers, supplier names, and line items.
   */
  static async crossVerify(docAId: string, docBId: string): Promise<CrossVerificationResult> {
    if (docAId === docBId) {
      throw new BadRequestError('Cannot cross-verify a document with itself. Please select two distinct documents.');
    }

    const db = getDatabase();

    // Fetch document metadata and extractions
    const getDocQuery = db.prepare(`
      SELECT d.id, d.original_name, d.mime_type, e.invoice_number, e.invoice_date,
             e.supplier_name, e.customer_name, e.subtotal, e.tax, e.total,
             e.currency, e.line_items_json
      FROM documents d
      LEFT JOIN extractions e ON d.id = e.document_id
      WHERE d.id = ?
    `);

    const docA = getDocQuery.get(docAId) as any;
    const docB = getDocQuery.get(docBId) as any;

    if (!docA) throw new NotFoundError(`Document A (ID: ${docAId}) not found.`);
    if (!docB) throw new NotFoundError(`Document B (ID: ${docBId}) not found.`);

    if (!docA.total && !docA.invoice_number) {
      throw new BadRequestError(`Document A (${docA.original_name}) has not finished extraction or has no data.`);
    }
    if (!docB.total && !docB.invoice_number) {
      throw new BadRequestError(`Document B (${docB.original_name}) has not finished extraction or has no data.`);
    }

    const discrepancies: CrossVerificationResult['discrepancies'] = [];
    let scorePoints = 0;
    const maxScorePoints = 100;

    // 1. Total Amount Comparison (Weight: 35 points)
    if (docA.total !== null && docB.total !== null) {
      const diff = Math.abs(docA.total - docB.total);
      if (diff <= 0.05) {
        scorePoints += 35;
      } else {
        const pctDiff = ((diff / Math.max(docA.total, docB.total)) * 100).toFixed(1);
        discrepancies.push({
          field: 'total',
          docAValue: `${docA.currency || ''} ${docA.total}`,
          docBValue: `${docB.currency || ''} ${docB.total}`,
          severity: 'HIGH',
          message: `Total amounts differ by ${diff.toFixed(2)} (${pctDiff}% variance).`,
        });
      }
    } else {
      discrepancies.push({
        field: 'total',
        docAValue: docA.total,
        docBValue: docB.total,
        severity: 'HIGH',
        message: 'Total amount is missing in one of the documents.',
      });
    }

    // 2. Invoice Number Comparison (Weight: 25 points)
    if (docA.invoice_number && docB.invoice_number) {
      const normA = docA.invoice_number.trim().toLowerCase();
      const normB = docB.invoice_number.trim().toLowerCase();
      if (normA === normB || normA.includes(normB) || normB.includes(normA)) {
        scorePoints += 25;
      } else {
        discrepancies.push({
          field: 'invoice_number',
          docAValue: docA.invoice_number,
          docBValue: docB.invoice_number,
          severity: 'HIGH',
          message: `Invoice numbers do not match ('${docA.invoice_number}' vs '${docB.invoice_number}').`,
        });
      }
    } else {
      discrepancies.push({
        field: 'invoice_number',
        docAValue: docA.invoice_number,
        docBValue: docB.invoice_number,
        severity: 'MEDIUM',
        message: 'Invoice number is absent in at least one document.',
      });
    }

    // 3. Supplier Name Comparison (Weight: 15 points)
    if (docA.supplier_name && docB.supplier_name) {
      const supA = docA.supplier_name.toLowerCase();
      const supB = docB.supplier_name.toLowerCase();
      if (supA === supB || supA.includes(supB) || supB.includes(supA)) {
        scorePoints += 15;
      } else {
        discrepancies.push({
          field: 'supplier_name',
          docAValue: docA.supplier_name,
          docBValue: docB.supplier_name,
          severity: 'MEDIUM',
          message: `Supplier names do not match ('${docA.supplier_name}' vs '${docB.supplier_name}').`,
        });
      }
    } else {
      scorePoints += 5; // partial
    }

    // 4. Tax and Subtotal Comparison (Weight: 15 points)
    if (docA.tax !== null && docB.tax !== null) {
      const taxDiff = Math.abs(docA.tax - docB.tax);
      if (taxDiff <= 0.05) {
        scorePoints += 15;
      } else {
        discrepancies.push({
          field: 'tax',
          docAValue: docA.tax,
          docBValue: docB.tax,
          severity: 'LOW',
          message: `Tax amounts differ by ${taxDiff.toFixed(2)}.`,
        });
      }
    } else {
      scorePoints += 8;
    }

    // 5. Line items count reconciliation (Weight: 10 points)
    const itemsA = docA.line_items_json ? JSON.parse(docA.line_items_json) : [];
    const itemsB = docB.line_items_json ? JSON.parse(docB.line_items_json) : [];

    if (itemsA.length > 0 && itemsB.length > 0) {
      if (itemsA.length === itemsB.length) {
        scorePoints += 10;
      } else {
        discrepancies.push({
          field: 'line_items_count',
          docAValue: itemsA.length,
          docBValue: itemsB.length,
          severity: 'LOW',
          message: `Line items count differs: Doc A has ${itemsA.length} items, Doc B has ${itemsB.length} items.`,
        });
      }
    } else {
      scorePoints += 5;
    }

    const matchScore = Math.min(100, Math.max(0, scorePoints));
    let status: 'MATCHED' | 'DISCREPANCY_FOUND' | 'FAILED' = 'MATCHED';

    if (matchScore < 80 || discrepancies.some((d) => d.severity === 'HIGH')) {
      status = 'DISCREPANCY_FOUND';
    }

    const summary =
      status === 'MATCHED'
        ? `Verification Passed: Documents '${docA.original_name}' and '${docB.original_name}' match with ${matchScore}% confidence.`
        : `Verification Discrepancies: Found ${discrepancies.length} discrepancy(ies) between '${docA.original_name}' and '${docB.original_name}'. Match score: ${matchScore}%.`;

    const verificationRecord: CrossVerificationResult = {
      id: uuidv4(),
      docAId,
      docBId,
      docAName: docA.original_name,
      docBName: docB.original_name,
      status,
      matchScore,
      discrepancies,
      summary,
      createdAt: new Date().toISOString(),
    };

    // Store in database
    const insertQuery = db.prepare(`
      INSERT INTO cross_verifications (id, doc_a_id, doc_b_id, status, match_score, discrepancies_json, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertQuery.run(
      verificationRecord.id,
      docAId,
      docBId,
      status,
      matchScore,
      JSON.stringify(discrepancies),
      summary
    );

    return verificationRecord;
  }

  static getHistory(): any[] {
    const db = getDatabase();
    const query = db.prepare(`
      SELECT cv.*,
             da.original_name as doc_a_name,
             db.original_name as doc_b_name
      FROM cross_verifications cv
      JOIN documents da ON cv.doc_a_id = da.id
      JOIN documents db ON cv.doc_b_id = db.id
      ORDER BY cv.created_at DESC
      LIMIT 50
    `);
    return query.all();
  }
}

