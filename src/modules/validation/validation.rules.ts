import type { InvoiceExtractionData } from '../extraction/extraction.schema';
import { getDatabase } from '../../config/database';

export interface ValidationReport {
  isValid: boolean;
  requiresManualReview: boolean;
  mathErrors: string[];
  missingFields: string[];
  duplicateFlags: string[];
  reviewReasons: string[];
}

export class ValidationRules {
  /**
   * Synchronous pure function to validate mathematical consistency.
   */
  static validateMath(data: InvoiceExtractionData): string[] {
    const errors: string[] = [];
    const tolerance = 0.03; // float precision delta

    // 1. Subtotal + Tax = Total
    if (data.subtotal !== null && data.tax !== null && data.total !== null) {
      const calculatedTotal = Math.round((data.subtotal + data.tax) * 100) / 100;
      const diff = Math.abs(calculatedTotal - data.total);
      if (diff > tolerance) {
        errors.push(
          `Subtotal (${data.currency} ${data.subtotal}) + Tax (${data.currency} ${data.tax}) = ${data.currency} ${calculatedTotal}, which does not match Total (${data.currency} ${data.total}). Difference: ${data.currency} ${diff.toFixed(2)}.`
        );
      }
    }

    // 2. Line Items calculation: quantity * unit_price == total_price
    let sumOfLineItems = 0;
    data.line_items.forEach((item, index) => {
      const expectedTotal = Math.round(item.quantity * item.unit_price * 100) / 100;
      const itemDiff = Math.abs(expectedTotal - item.total_price);
      if (itemDiff > tolerance) {
        errors.push(
          `Line item #${index + 1} ('${item.description}'): Quantity (${item.quantity}) × Unit Price (${item.unit_price}) = ${expectedTotal}, but recorded Total Price is ${item.total_price}.`
        );
      }
      sumOfLineItems += item.total_price;
    });

    // 3. Sum of line items vs Subtotal
    if (data.line_items.length > 0 && data.subtotal !== null) {
      const roundedLineSum = Math.round(sumOfLineItems * 100) / 100;
      const subtotalDiff = Math.abs(roundedLineSum - data.subtotal);
      if (subtotalDiff > tolerance) {
        errors.push(
          `Sum of line items (${data.currency} ${roundedLineSum}) does not match Subtotal (${data.currency} ${data.subtotal}). Difference: ${data.currency} ${subtotalDiff.toFixed(2)}.`
        );
      }
    }

    return errors;
  }

  /**
   * Identifies missing mandatory fields.
   */
  static validateRequiredFields(data: InvoiceExtractionData): string[] {
    const missing: string[] = [];
    if (!data.invoice_number || data.invoice_number.trim() === '') missing.push('invoice_number');
    if (!data.invoice_date || data.invoice_date.trim() === '') missing.push('invoice_date');
    if (!data.supplier_name || data.supplier_name.trim() === '') missing.push('supplier_name');
    if (data.total === null || isNaN(data.total)) missing.push('total');
    return missing;
  }

  /**
   * Checks database for duplicate invoices (same supplier + invoice number).
   */
  static checkDuplicates(
    currentDocumentId: string,
    invoiceNumber: string | null,
    supplierName: string | null
  ): string[] {
    if (!invoiceNumber || !supplierName) return [];

    const db = getDatabase();
    const query = db.prepare(`
      SELECT d.id, d.original_name, e.invoice_number, e.supplier_name, e.total
      FROM extractions e
      JOIN documents d ON e.document_id = d.id
      WHERE e.document_id != ?
        AND LOWER(e.invoice_number) = LOWER(?)
        AND LOWER(e.supplier_name) = LOWER(?)
    `);

    const duplicates = query.all(currentDocumentId, invoiceNumber, supplierName) as any[];
    if (duplicates.length > 0) {
      return duplicates.map(
        (dup) =>
          `Duplicate detected: Invoice #${invoiceNumber} for '${supplierName}' was already processed in document '${dup.original_name}' (ID: ${dup.id}).`
      );
    }

    return [];
  }

  /**
   * Runs the complete validation suite and determines manual review requirements.
   */
  static runAll(
    documentId: string,
    data: InvoiceExtractionData,
    options: { checkDuplicates?: boolean } = { checkDuplicates: true }
  ): ValidationReport {
    const mathErrors = this.validateMath(data);
    const missingFields = this.validateRequiredFields(data);
    const duplicateFlags = options.checkDuplicates !== false
      ? this.checkDuplicates(documentId, data.invoice_number, data.supplier_name)
      : [];

    const reviewReasons: string[] = [];

    if (mathErrors.length > 0) {
      reviewReasons.push(`Mathematical discrepancies found (${mathErrors.length} calculation errors)`);
    }

    if (missingFields.length > 0) {
      reviewReasons.push(`Missing mandatory fields: ${missingFields.join(', ')}`);
    }

    if (duplicateFlags.length > 0) {
      reviewReasons.push('Duplicate invoice detected in system');
    }

    // Check confidence scores
    const criticalFields = ['invoice_number', 'total', 'supplier_name'];
    criticalFields.forEach((field) => {
      const score = data.confidence_scores[field];
      if (score !== undefined && score < 0.7) {
        reviewReasons.push(`Low confidence score for ${field} (${(score * 100).toFixed(0)}%)`);
      }
    });

    const isValid = mathErrors.length === 0 && missingFields.length === 0 && duplicateFlags.length === 0;
    const requiresManualReview = reviewReasons.length > 0;

    return {
      isValid,
      requiresManualReview,
      mathErrors,
      missingFields,
      duplicateFlags,
      reviewReasons,
    };
  }
}

