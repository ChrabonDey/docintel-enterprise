import crypto from 'node:crypto';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import { DocumentModel } from './document.model';
import { getDatabase } from '../../config/database';
import { JobQueue } from '../jobs/queue.service';
import { ValidationRules } from '../validation/validation.rules';
import { NotFoundError, BadRequestError } from '../../core/errors/app-error';
import { logger } from '../../core/logger';
import type { ManualCorrectionInput } from './document.schema';

export class DocumentService {
  /**
   * Synchronously computes SHA-256 hash of a file for deduplication.
   */
  static calculateFileHash(filePath: string): string {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  /**
   * Asynchronously handles batch uploads of documents.
   */
  static async uploadDocuments(files: Express.Multer.File[]): Promise<any[]> {
    if (!files || files.length === 0) {
      throw new BadRequestError('No files were provided for upload.');
    }

    const results: any[] = [];

    for (const file of files) {
      const fileHash = this.calculateFileHash(file.path);
      const existingDoc = DocumentModel.findByHash(fileHash);
      const docId = uuidv4();

      const document = DocumentModel.create({
        id: docId,
        filename: file.filename,
        original_name: file.originalname,
        mime_type: file.mimetype,
        file_size: file.size,
        file_hash: fileHash,
        page_count: 1,
        status: 'QUEUED',
        failure_reason: null,
        retry_count: 0,
        processing_time_ms: 0,
      });

      // Add to background processing queue
      JobQueue.addJob(document.id, file.path, file.filename, file.mimetype, 0);

      results.push({
        id: document.id,
        filename: document.original_name,
        size: document.file_size,
        mimeType: document.mime_type,
        status: document.status,
        isDuplicate: Boolean(existingDoc),
        duplicateOf: existingDoc ? existingDoc.id : null,
      });
    }

    return results;
  }

  /**
   * Retrieves complete document inspection details including extractions, validations, and audit trail.
   */
  static getDocumentDetails(documentId: string): any {
    const db = getDatabase();
    const doc = DocumentModel.findById(documentId);
    if (!doc) {
      throw new NotFoundError(`Document with ID '${documentId}' not found.`);
    }

    const extraction = db.prepare('SELECT * FROM extractions WHERE document_id = ?').get(documentId) as any;
    const validation = db.prepare('SELECT * FROM validations WHERE document_id = ?').get(documentId) as any;
    const auditLogs = db.prepare('SELECT * FROM audit_logs WHERE document_id = ? ORDER BY created_at DESC').all(documentId) as any[];

    return {
      document: doc,
      extraction: extraction
        ? {
            ...extraction,
            line_items: extraction.line_items_json ? JSON.parse(extraction.line_items_json) : [],
            confidence_scores: extraction.confidence_scores_json ? JSON.parse(extraction.confidence_scores_json) : {},
          }
        : null,
      validation: validation
        ? {
            isValid: Boolean(validation.is_valid),
            requiresManualReview: Boolean(validation.requires_manual_review),
            mathErrors: validation.math_errors_json ? JSON.parse(validation.math_errors_json) : [],
            missingFields: validation.missing_fields_json ? JSON.parse(validation.missing_fields_json) : [],
            duplicateFlags: validation.duplicate_flags_json ? JSON.parse(validation.duplicate_flags_json) : [],
            reviewReasons: validation.review_reasons_json ? JSON.parse(validation.review_reasons_json) : [],
          }
        : null,
      auditLogs,
    };
  }

  /**
   * Applies manual corrections to an extracted document with full audit logging.
   */
  static applyManualCorrection(
    documentId: string,
    corrections: ManualCorrectionInput,
    userId: string
  ): any {
    const db = getDatabase();
    const doc = DocumentModel.findById(documentId);
    if (!doc) {
      throw new NotFoundError(`Document '${documentId}' not found.`);
    }

    const extraction = db.prepare('SELECT * FROM extractions WHERE document_id = ?').get(documentId) as any;
    if (!extraction) {
      throw new BadRequestError('Cannot apply corrections to a document with no extraction data.');
    }

    const currentLineItems = extraction.line_items_json ? JSON.parse(extraction.line_items_json) : [];

    // Fields to update
    const updatedValues = {
      invoice_number: corrections.invoice_number !== undefined ? corrections.invoice_number : extraction.invoice_number,
      invoice_date: corrections.invoice_date !== undefined ? corrections.invoice_date : extraction.invoice_date,
      supplier_name: corrections.supplier_name !== undefined ? corrections.supplier_name : extraction.supplier_name,
      customer_name: corrections.customer_name !== undefined ? corrections.customer_name : extraction.customer_name,
      subtotal: corrections.subtotal !== undefined ? corrections.subtotal : extraction.subtotal,
      tax: corrections.tax !== undefined ? corrections.tax : extraction.tax,
      total: corrections.total !== undefined ? corrections.total : extraction.total,
      currency: corrections.currency !== undefined ? corrections.currency : extraction.currency,
      line_items: corrections.line_items !== undefined ? corrections.line_items : currentLineItems,
    };

    // Log each changed field in audit_logs
    const auditInsert = db.prepare(`
      INSERT INTO audit_logs (id, document_id, user_id, action, field_changed, old_value, new_value, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Re-run validation rules on corrected data
    const newValidation = ValidationRules.runAll(documentId, {
      ...updatedValues,
      confidence_scores: extraction.confidence_scores_json ? JSON.parse(extraction.confidence_scores_json) : {},
      missing_fields: [],
      uncertain_fields: [],
    });

    const newStatus = newValidation.isValid ? 'VERIFIED' : 'NEEDS_REVIEW';

    // Execute all updates in a single atomic SQLite transaction for speed and safety
    const applyTx = db.transaction(() => {
      // 1. Audit logs
      Object.keys(updatedValues).forEach((key) => {
        const oldVal = (extraction as any)[key];
        const newVal = (updatedValues as any)[key];
        if (oldVal !== newVal) {
          auditInsert.run(
            uuidv4(),
            documentId,
            userId,
            'MANUAL_CORRECTION',
            key,
            String(oldVal),
            String(newVal),
            corrections.reason
          );
        }
      });

      // 2. Extractions
      db.prepare(`
        UPDATE extractions
        SET invoice_number = ?, invoice_date = ?, supplier_name = ?, customer_name = ?,
            subtotal = ?, tax = ?, total = ?, currency = ?, line_items_json = ?
        WHERE document_id = ?
      `).run(
        updatedValues.invoice_number,
        updatedValues.invoice_date,
        updatedValues.supplier_name,
        updatedValues.customer_name,
        updatedValues.subtotal,
        updatedValues.tax,
        updatedValues.total,
        updatedValues.currency,
        JSON.stringify(updatedValues.line_items),
        documentId
      );

      // 3. Validations
      db.prepare(`
        UPDATE validations
        SET is_valid = ?, requires_manual_review = ?, math_errors_json = ?,
            missing_fields_json = ?, duplicate_flags_json = ?, review_reasons_json = ?
        WHERE document_id = ?
      `).run(
        newValidation.isValid ? 1 : 0,
        newValidation.requiresManualReview ? 1 : 0,
        JSON.stringify(newValidation.mathErrors),
        JSON.stringify(newValidation.missingFields),
        JSON.stringify(newValidation.duplicateFlags),
        JSON.stringify(newValidation.reviewReasons),
        documentId
      );

      // 4. Update status
      DocumentModel.updateStatus(documentId, newStatus);
    });

    applyTx();

    logger.info(`Manual correction applied to document [${documentId}] by user [${userId}]. New status: ${newStatus}`);
    return this.getDocumentDetails(documentId);
  }

  /**
   * Reprocesses a document.
   */
  static reprocessDocument(documentId: string): void {
    JobQueue.reprocess(documentId);
  }
}

