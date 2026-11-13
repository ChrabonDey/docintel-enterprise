import { getDatabase } from '../../config/database';

export class AnalyticsService {
  static getMetrics() {
    const db = getDatabase();

    const counts = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'VERIFIED' THEN 1 ELSE 0 END) as verified,
        SUM(CASE WHEN status = 'NEEDS_REVIEW' THEN 1 ELSE 0 END) as needs_review,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status IN ('QUEUED', 'PROCESSING') THEN 1 ELSE 0 END) as pending,
        AVG(CASE WHEN processing_time_ms > 0 THEN processing_time_ms ELSE NULL END) as avg_processing_time_ms
      FROM documents
    `).get() as any;

    const total = counts.total || 0;
    const completed = (counts.completed || 0) + (counts.verified || 0);
    const needsReview = counts.needs_review || 0;
    const failed = counts.failed || 0;
    const pending = counts.pending || 0;

    const successRate = total > 0 ? Math.round(((completed) / total) * 1000) / 10 : 0;
    const failureRate = total > 0 ? Math.round((failed / total) * 1000) / 10 : 0;

    // Breakdown by mime type / format
    const formatBreakdown = db.prepare(`
      SELECT mime_type, COUNT(*) as count
      FROM documents
      GROUP BY mime_type
    `).all() as any[];

    // Total financial value extracted
    const financialStats = db.prepare(`
      SELECT
        COUNT(*) as invoices_with_total,
        SUM(total) as grand_total_amount,
        AVG(total) as avg_invoice_amount
      FROM extractions
      WHERE total IS NOT NULL
    `).get() as any;

    // Validation issue summary
    const validationIssues = db.prepare(`
      SELECT
        SUM(CASE WHEN is_valid = 0 THEN 1 ELSE 0 END) as invalid_calculations,
        SUM(CASE WHEN requires_manual_review = 1 THEN 1 ELSE 0 END) as flagged_for_review
      FROM validations
    `).get() as any;

    return {
      overview: {
        totalDocuments: total,
        completedDocuments: completed,
        needsReviewDocuments: needsReview,
        failedDocuments: failed,
        pendingDocuments: pending,
        successRatePct: successRate,
        failureRatePct: failureRate,
        avgProcessingTimeMs: Math.round(counts.avg_processing_time_ms || 0),
      },
      financials: {
        totalExtractedVolume: financialStats.grand_total_amount ? Math.round(financialStats.grand_total_amount * 100) / 100 : 0,
        averageInvoiceAmount: financialStats.avg_invoice_amount ? Math.round(financialStats.avg_invoice_amount * 100) / 100 : 0,
        extractedInvoiceCount: financialStats.invoices_with_total || 0,
      },
      validationStats: {
        mathDiscrepanciesDetected: validationIssues.invalid_calculations || 0,
        flaggedForManualAudit: validationIssues.flagged_for_review || 0,
      },
      formatBreakdown,
    };
  }
}

