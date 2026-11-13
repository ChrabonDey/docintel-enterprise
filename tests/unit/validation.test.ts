import { describe, it, expect } from 'bun:test';
import { ValidationRules } from '../../src/modules/validation/validation.rules';
import type { InvoiceExtractionData } from '../../src/modules/extraction/extraction.schema';

describe('Validation Engine Unit Tests', () => {
  it('should pass valid mathematical calculations without errors', () => {
    const validData: InvoiceExtractionData = {
      invoice_number: 'INV-101',
      invoice_date: '2026-01-01',
      supplier_name: 'Tech Solutions',
      customer_name: 'Client Corp',
      subtotal: 100.0,
      tax: 15.0,
      total: 115.0,
      currency: 'USD',
      line_items: [
        { description: 'Item 1', quantity: 2, unit_price: 50.0, total_price: 100.0 },
      ],
      confidence_scores: { total: 0.95 },
      missing_fields: [],
      uncertain_fields: [],
    };

    const mathErrors = ValidationRules.validateMath(validData);
    expect(mathErrors.length).toBe(0);

    const report = ValidationRules.runAll('test-doc-1', validData);
    expect(report.isValid).toBe(true);
    expect(report.requiresManualReview).toBe(false);
  });

  it('should detect mismatch when subtotal + tax does not equal total', () => {
    const invalidData: InvoiceExtractionData = {
      invoice_number: 'INV-102',
      invoice_date: '2026-01-01',
      supplier_name: 'Faulty Vendor',
      customer_name: 'Client Corp',
      subtotal: 100.0,
      tax: 15.0,
      total: 130.0, // Difference: 15.00
      currency: 'USD',
      line_items: [
        { description: 'Item 1', quantity: 2, unit_price: 50.0, total_price: 100.0 },
      ],
      confidence_scores: {},
      missing_fields: [],
      uncertain_fields: [],
    };

    const mathErrors = ValidationRules.validateMath(invalidData);
    expect(mathErrors.length).toBeGreaterThan(0);
    expect(mathErrors[0]).toContain('does not match Total');

    const report = ValidationRules.runAll('test-doc-2', invalidData);
    expect(report.isValid).toBe(false);
    expect(report.requiresManualReview).toBe(true);
  });

  it('should detect line item calculation error (quantity * unit_price != total)', () => {
    const invalidItemData: InvoiceExtractionData = {
      invoice_number: 'INV-103',
      invoice_date: '2026-01-01',
      supplier_name: 'Vendor',
      customer_name: 'Customer',
      subtotal: 100.0,
      tax: 10.0,
      total: 110.0,
      currency: 'USD',
      line_items: [
        { description: 'Item A', quantity: 3, unit_price: 20.0, total_price: 100.0 }, // 3 * 20 = 60 != 100
      ],
      confidence_scores: {},
      missing_fields: [],
      uncertain_fields: [],
    };

    const mathErrors = ValidationRules.validateMath(invalidItemData);
    expect(mathErrors.some((e) => e.includes('recorded Total Price'))).toBe(true);
  });

  it('should flag missing mandatory fields', () => {
    const missingData: InvoiceExtractionData = {
      invoice_number: null,
      invoice_date: null,
      supplier_name: '',
      customer_name: 'Client',
      subtotal: 100.0,
      tax: 10.0,
      total: null,
      currency: 'USD',
      line_items: [],
      confidence_scores: {},
      missing_fields: [],
      uncertain_fields: [],
    };

    const missingFields = ValidationRules.validateRequiredFields(missingData);
    expect(missingFields).toContain('invoice_number');
    expect(missingFields).toContain('invoice_date');
    expect(missingFields).toContain('supplier_name');
    expect(missingFields).toContain('total');
  });

  it('should strictly validate inputs with Zod schemas', async () => {
    const { searchQuerySchema } = await import('../../src/modules/search/search.schema');
    const { manualCorrectionSchema, crossVerifySchema } = await import('../../src/modules/documents/document.schema');

    // Valid search query
    const validSearch = searchQuerySchema.safeParse({ q: 'hosting', mode: 'hybrid', limit: '15' });
    expect(validSearch.success).toBe(true);
    if (validSearch.success) {
      expect(validSearch.data.limit).toBe(15);
      expect(validSearch.data.mode).toBe('hybrid');
    }

    // Invalid search mode
    const invalidSearch = searchQuerySchema.safeParse({ mode: 'invalid_mode_xyz' });
    expect(invalidSearch.success).toBe(false);

    // Valid cross-verify
    const validCrossVerify = crossVerifySchema.safeParse({ docAId: 'doc-1', docBId: 'doc-2' });
    expect(validCrossVerify.success).toBe(true);

    // Invalid manual correction without reason
    const invalidCorrection = manualCorrectionSchema.safeParse({
      total: 500,
      // missing reason
    });
    expect(invalidCorrection.success).toBe(false);
  });
});

