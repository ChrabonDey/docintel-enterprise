import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { getDatabase } from '../../config/database';
import { env } from '../../config/env.config';
import { logger } from '../../core/logger';
import { registerShutdownService } from '../../core/graceful-shutdown';
import { PdfParser } from '../extraction/parsers/pdf.parser';
import { ImageParser } from '../extraction/parsers/image.parser';
import { ExcelParser } from '../extraction/parsers/excel.parser';
import { CsvParser } from '../extraction/parsers/csv.parser';
import { HybridExtractor } from '../extraction/ai/hybrid.extractor';
import { ValidationRules } from '../validation/validation.rules';
import { VectorService } from '../search/vector.service';

export interface Job {
  documentId: string;
  filePath: string;
  filename: string;
  mimeType: string;
  retryCount: number;
  addedAt: Date;
}

export class JobQueue {
  private static queue: Job[] = [];
  private static activeJobs = new Map<string, Job>();
  private static isRunning = false;
  private static maxConcurrency = env.QUEUE_CONCURRENCY;

  // Cached prepared statements for high-speed execution
  private static stmtUpdateStatus: any = null;
  private static stmtInsertExtraction: any = null;
  private static stmtInsertValidation: any = null;
  private static stmtUpdateFinalDoc: any = null;

  /**
   * Initializes queue workers, compiles reusable SQL statements, and registers graceful shutdown hook.
   */
  static init(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info(`🚀 JobQueue initialized with concurrency=${this.maxConcurrency}`);

    // Pre-compile statements
    this.initStatements();

    // Register with graceful shutdown
    registerShutdownService({
      name: 'DocumentJobQueue',
      shutdown: async () => {
        logger.info('Draining JobQueue and waiting for active jobs to finish...');
        this.isRunning = false;
        const start = Date.now();
        while (this.activeJobs.size > 0 && Date.now() - start < 10000) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        logger.info(`JobQueue drain finished. Remaining active: ${this.activeJobs.size}`);
      },
    });

    // Resume any pending or queued documents from database on boot
    this.recoverPendingJobs();
  }

  private static initStatements(): void {
    const db = getDatabase();
    this.stmtUpdateStatus = db.prepare(
      'UPDATE documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    );
    this.stmtInsertExtraction = db.prepare(`
      INSERT OR REPLACE INTO extractions (
        id, document_id, raw_text, invoice_number, invoice_date, supplier_name,
        customer_name, subtotal, tax, total, currency, line_items_json,
        confidence_scores_json, extraction_method
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtInsertValidation = db.prepare(`
      INSERT OR REPLACE INTO validations (
        id, document_id, is_valid, requires_manual_review, math_errors_json,
        missing_fields_json, duplicate_flags_json, review_reasons_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtUpdateFinalDoc = db.prepare(`
      UPDATE documents
      SET status = ?, page_count = ?, processing_time_ms = ?, failure_reason = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
  }

  /**
   * Recovers documents that were left in QUEUED or PROCESSING state after server restart.
   */
  private static recoverPendingJobs(): void {
    const db = getDatabase();
    const pendingDocs = db.prepare(`
      SELECT id, filename, mime_type, retry_count
      FROM documents
      WHERE status IN ('QUEUED', 'PROCESSING')
    `).all() as any[];

    logger.info(`Recovering ${pendingDocs.length} pending document job(s) from database.`);
    for (const doc of pendingDocs) {
      const filePath = path.resolve(env.UPLOAD_DIR, doc.filename);
      if (fs.existsSync(filePath)) {
        this.addJob(doc.id, filePath, doc.filename, doc.mime_type, doc.retry_count);
      }
    }
  }

  /**
   * Enqueues a document for background processing.
   */
  static addJob(
    documentId: string,
    filePath: string,
    filename: string,
    mimeType: string,
    retryCount = 0
  ): void {
    const db = getDatabase();
    db.prepare('UPDATE documents SET status = ?, retry_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('QUEUED', retryCount, documentId);

    this.queue.push({
      documentId,
      filePath,
      filename,
      mimeType,
      retryCount,
      addedAt: new Date(),
    });

    this.dispatch();
  }

  /**
   * Triggers processing workers up to max concurrency.
   */
  private static dispatch(): void {
    if (!this.isRunning) return;

    while (this.activeJobs.size < this.maxConcurrency && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;

      this.activeJobs.set(job.documentId, job);
      this.executeJob(job)
        .catch((err) => {
          logger.error(`Critical error executing job ${job.documentId}:`, err);
        })
        .finally(() => {
          this.activeJobs.delete(job.documentId);
          this.dispatch(); // Trigger next job in queue
        });
    }
  }

  /**
   * Executes the full asynchronous processing pipeline for a single document.
   * Uses an atomic SQLite transaction for high-speed writes.
   */
  private static async executeJob(job: Job): Promise<void> {
    const db = getDatabase();
    if (!this.stmtUpdateStatus) this.initStatements();

    const startTime = performance.now();
    logger.info(`▶️ Processing document [${job.documentId}] file: ${job.filename}`);

    this.stmtUpdateStatus.run('PROCESSING', job.documentId);

    try {
      let rawText = '';
      let pageCount = 1;
      const ext = path.extname(job.filename).toLowerCase();

      // Stage 1: Document Parsing by format
      if (ext === '.pdf') {
        const result = await PdfParser.parse(job.filePath);
        rawText = result.text;
        pageCount = result.pageCount;
      } else if (['.jpg', '.jpeg', '.png', '.tiff', '.tif'].includes(ext)) {
        const result = await ImageParser.parse(job.filePath);
        rawText = result.text;
        pageCount = 1;
      } else if (['.xlsx', '.xls'].includes(ext)) {
        const result = await ExcelParser.parse(job.filePath);
        rawText = result.text;
        pageCount = result.totalSheets;
      } else if (ext === '.csv') {
        const result = await CsvParser.parse(job.filePath);
        rawText = result.text;
        pageCount = 1;
      } else {
        throw new Error(`Unsupported document extension '${ext}'`);
      }

      // Stage 2: AI Information Extraction (Hybrid LLM + Heuristics)
      const extractionResult = await HybridExtractor.extract(rawText);
      const extracted = extractionResult.data;

      // Stage 3: Data Validation (Math rules, required fields, duplicates)
      const validationReport = ValidationRules.runAll(job.documentId, extracted);
      const finalStatus = validationReport.requiresManualReview ? 'NEEDS_REVIEW' : 'COMPLETED';

      const extractionId = crypto.randomUUID();
      const validationId = crypto.randomUUID();
      const durationMs = Math.round(performance.now() - startTime);

      // Stage 4: Atomic High-Speed SQLite Transaction
      const persistTransaction = db.transaction(() => {
        // Insert extraction
        this.stmtInsertExtraction.run(
          extractionId,
          job.documentId,
          rawText,
          extracted.invoice_number,
          extracted.invoice_date,
          extracted.supplier_name,
          extracted.customer_name,
          extracted.subtotal,
          extracted.tax,
          extracted.total,
          extracted.currency,
          JSON.stringify(extracted.line_items),
          JSON.stringify(extracted.confidence_scores),
          extractionResult.method
        );

        // Insert validation
        this.stmtInsertValidation.run(
          validationId,
          job.documentId,
          validationReport.isValid ? 1 : 0,
          validationReport.requiresManualReview ? 1 : 0,
          JSON.stringify(validationReport.mathErrors),
          JSON.stringify(validationReport.missingFields),
          JSON.stringify(validationReport.duplicateFlags),
          JSON.stringify(validationReport.reviewReasons)
        );

        // Update document status & metrics
        this.stmtUpdateFinalDoc.run(finalStatus, pageCount, durationMs, job.documentId);
      });

      persistTransaction();

      // Stage 5: Semantic Search Indexing
      VectorService.indexDocument(job.documentId, rawText);

      logger.info(`✅ Successfully processed document [${job.documentId}] in ${durationMs}ms with status: ${finalStatus}`);
    } catch (error: any) {
      const durationMs = Math.round(performance.now() - startTime);
      logger.error(`❌ Processing failed for document [${job.documentId}]: ${error.message}`);

      const maxRetries = 2;
      if (job.retryCount < maxRetries) {
        logger.info(`Retrying job [${job.documentId}] (attempt ${job.retryCount + 1}/${maxRetries})...`);
        setTimeout(() => {
          this.addJob(job.documentId, job.filePath, job.filename, job.mimeType, job.retryCount + 1);
        }, 1500);
      } else {
        db.prepare(`
          UPDATE documents
          SET status = 'FAILED', failure_reason = ?, processing_time_ms = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(error.message, durationMs, job.documentId);
      }
    }
  }

  /**
   * Reprocesses a document (manual retry or reprocessing).
   */
  static reprocess(documentId: string): void {
    const db = getDatabase();
    const doc = db.prepare('SELECT id, filename, mime_type FROM documents WHERE id = ?').get(documentId) as any;
    if (!doc) throw new Error(`Document ${documentId} not found`);

    const filePath = path.resolve(env.UPLOAD_DIR, doc.filename);
    this.addJob(doc.id, filePath, doc.filename, doc.mime_type, 0);
  }

  static getQueueStatus() {
    return {
      waiting: this.queue.length,
      active: this.activeJobs.size,
      concurrency: this.maxConcurrency,
    };
  }
}
