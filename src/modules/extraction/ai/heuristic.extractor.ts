import type { InvoiceExtractionData, LineItem } from '../extraction.schema';

export class HeuristicExtractor {
  /**
   * Deterministically extracts invoice fields from raw document text.
   * Operates completely offline, fast, and does NOT invent or hallucinate data.
   */
  static extract(rawText: string): InvoiceExtractionData {
    const lines = rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    const confidence: Record<string, number> = {};
    const missing: string[] = [];
    const uncertain: string[] = [];

    // 1. Currency extraction
    const currencyMatch = this.detectCurrency(rawText);
    const currency = currencyMatch.value;
    confidence['currency'] = currencyMatch.confidence;

    // 2. Invoice Number
    const invNumMatch = this.detectInvoiceNumber(rawText, lines);
    const invoice_number = invNumMatch.value;
    confidence['invoice_number'] = invNumMatch.confidence;
    if (!invoice_number) missing.push('invoice_number');
    else if (invNumMatch.confidence < 0.7) uncertain.push('invoice_number');

    // 3. Invoice Date
    const dateMatch = this.detectInvoiceDate(rawText);
    const invoice_date = dateMatch.value;
    confidence['invoice_date'] = dateMatch.confidence;
    if (!invoice_date) missing.push('invoice_date');
    else if (dateMatch.confidence < 0.7) uncertain.push('invoice_date');

    // 4. Supplier Name
    const supplierMatch = this.detectSupplierName(lines);
    const supplier_name = supplierMatch.value;
    confidence['supplier_name'] = supplierMatch.confidence;
    if (!supplier_name) missing.push('supplier_name');
    else if (supplierMatch.confidence < 0.7) uncertain.push('supplier_name');

    // 5. Customer Name
    const customerMatch = this.detectCustomerName(rawText, lines);
    const customer_name = customerMatch.value;
    confidence['customer_name'] = customerMatch.confidence;
    if (!customer_name) missing.push('customer_name');
    else if (customerMatch.confidence < 0.7) uncertain.push('customer_name');

    // 6. Financial Totals (Subtotal, Tax, Total)
    const amounts = this.detectAmounts(lines, rawText);
    const subtotal = amounts.subtotal;
    const tax = amounts.tax;
    const total = amounts.total;

    confidence['subtotal'] = amounts.subtotalConf;
    confidence['tax'] = amounts.taxConf;
    confidence['total'] = amounts.totalConf;

    if (total === null) missing.push('total');
    if (subtotal === null) missing.push('subtotal');
    if (tax === null) missing.push('tax');

    // 7. Line Items
    const lineItemsResult = this.detectLineItems(lines);
    const line_items = lineItemsResult.items;
    confidence['line_items'] = lineItemsResult.confidence;
    if (line_items.length === 0) missing.push('line_items');

    return {
      invoice_number,
      invoice_date,
      supplier_name,
      customer_name,
      subtotal,
      tax,
      total,
      currency,
      line_items,
      confidence_scores: confidence,
      missing_fields: missing,
      uncertain_fields: uncertain,
    };
  }

  private static detectCurrency(text: string): { value: string | null; confidence: number } {
    if (/\$|USD/i.test(text)) return { value: 'USD', confidence: 0.95 };
    if (/€|EUR/i.test(text)) return { value: 'EUR', confidence: 0.95 };
    if (/£|GBP/i.test(text)) return { value: 'GBP', confidence: 0.95 };
    if (/৳|BDT|Taka/i.test(text)) return { value: 'BDT', confidence: 0.95 };
    if (/CAD/i.test(text)) return { value: 'CAD', confidence: 0.9 };
    if (/AUD/i.test(text)) return { value: 'AUD', confidence: 0.9 };
    return { value: 'USD', confidence: 0.5 };
  }

  private static detectInvoiceNumber(text: string, lines: string[]): { value: string | null; confidence: number } {
    const regexes = [
      /(?:invoice\s*(?:no|number|#|num)\s*[:\s\t#]+)([A-Za-z0-9-_/]+)/i,
      /(?:bill\s*(?:no|number|#)?[:\s\t#]+)([A-Za-z0-9-_/]+)/i,
      /(?:inv[#:\s\t-]+)([A-Za-z0-9-_/]+)/i,
      /(?:receipt\s*(?:no|#)?[:\s\t#]+)([A-Za-z0-9-_/]+)/i,
      /\b(INV-\d{4}-\d{3,6})\b/i,
      /\b(INV-\d{4,8}-[A-Za-z0-9]+)\b/i,
    ];

    for (const regex of regexes) {
      const match = text.match(regex);
      if (match && match[1] && match[1].length >= 3 && !/summary|date|total|to/i.test(match[1])) {
        return { value: match[1].trim(), confidence: 0.95 };
      }
    }

    // Look for lines containing "Invoice"
    for (const line of lines) {
      if (/invoice/i.test(line) && !/summary/i.test(line)) {
        const parts = line.split(/[:\s\t]+/);
        for (let i = 0; i < parts.length; i++) {
          if (/^([A-Z]{2,4}-\d{3,8}(-\d+)?|\d{4,8})$/.test(parts[i])) {
            return { value: parts[i], confidence: 0.85 };
          }
        }
      }
    }

    return { value: null, confidence: 0.0 };
  }

  private static detectInvoiceDate(text: string): { value: string | null; confidence: number } {
    const patterns = [
      /(?:invoice\s*date|date[:\s\t]+)(?:is\s*)?([0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2})/i, // YYYY-MM-DD
      /(?:invoice\s*date|date[:\s\t]+)(?:is\s*)?([0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{4})/i, // DD-MM-YYYY or MM-DD-YYYY
      /(?:invoice\s*date|date[:\s\t]+)(?:is\s*)?([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,   // Jan 15, 2026
      /\b([0-9]{4}[-/][0-9]{2}[-/][0-9]{2})\b/,
      /\b([0-9]{2}[-/][0-9]{2}[-/][0-9]{4})\b/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        try {
          const parsed = new Date(match[1]);
          if (!isNaN(parsed.getTime())) {
            return { value: parsed.toISOString().split('T')[0], confidence: 0.95 };
          }
        } catch {
          // continue
        }
      }
    }

    return { value: null, confidence: 0.0 };
  }

  private static detectSupplierName(lines: string[]): { value: string | null; confidence: number } {
    // Check for explicit "From:" or "Supplier:" label
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/(?:from|supplier|vendor|issued\s*by)[:\s\t]+(.+)/i);
      if (match && match[1] && match[1].trim().length > 1) {
        return { value: match[1].trim(), confidence: 0.95 };
      }
    }

    // Company name in the top lines
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const candidate = lines[i];
      if (
        !/invoice|receipt|date|total|page|bill\s*to|sheet/i.test(candidate) &&
        candidate.length > 3 &&
        candidate.length < 50
      ) {
        return { value: candidate, confidence: 0.8 };
      }
    }

    return { value: null, confidence: 0.0 };
  }

  private static detectCustomerName(text: string, lines: string[]): { value: string | null; confidence: number } {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/(?:bill\s*to|sold\s*to|customer|buyer|client|recipient)[:\s\t]+(.+)/i);
      if (match && match[1] && match[1].trim().length > 1) {
        return { value: match[1].trim(), confidence: 0.95 };
      }

      if (/^(?:bill\s*to|sold\s*to|customer)[:]?$/i.test(line) && i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (nextLine.length > 2 && !/invoice|date|total/i.test(nextLine)) {
          return { value: nextLine, confidence: 0.9 };
        }
      }
    }

    return { value: null, confidence: 0.0 };
  }

  private static detectAmounts(lines: string[], rawText: string): {
    subtotal: number | null;
    tax: number | null;
    total: number | null;
    subtotalConf: number;
    taxConf: number;
    totalConf: number;
  } {
    const parseNum = (str: string): number | null => {
      const cleaned = str.replace(/[$,€£৳\s]/g, '').replace(/,/g, '');
      const num = parseFloat(cleaned);
      return isNaN(num) ? null : Math.round(num * 100) / 100;
    };

    let subtotal: number | null = null;
    let tax: number | null = null;
    let total: number | null = null;
    let subtotalConf = 0.0;
    let taxConf = 0.0;
    let totalConf = 0.0;

    // Line-by-line inspection to prevent "Subtotal" matching "Total"
    for (const line of lines) {
      // 1. Subtotal
      if (/subtotal|sub\s*total|net\s*amount/i.test(line)) {
        const m = line.match(/(?:subtotal|sub\s*total|net\s*amount)[:\s\t]+[$€£৳]?\s*([0-9,]+\.?[0-9]*)/i);
        if (m && m[1]) {
          subtotal = parseNum(m[1]);
          if (subtotal !== null) subtotalConf = 0.95;
        }
        continue;
      }

      // 2. Tax / VAT / GST
      if (/(?:tax|vat|gst|sales\s*tax)/i.test(line)) {
        const m = line.match(/(?:tax|vat|gst|sales\s*tax)(?:\s*\(?[A-Za-z0-9\s.%]+\)?)?[:\s\t]+[$€£৳]?\s*([0-9,]+\.?[0-9]*)/i);
        if (m && m[1]) {
          tax = parseNum(m[1]);
          if (tax !== null) taxConf = 0.95;
        }
        continue;
      }

      // 3. Total (strict, ignoring subtotal)
      if (/\b(?:grand\s*)?total\b|amount\s*due|balance\s*due/i.test(line)) {
        const m = line.match(/(?:\b(?:grand\s*)?total|amount\s*due|balance\s*due\b)[:\s\t]+[$€£৳]?\s*([0-9,]+\.?[0-9]*)/i);
        if (m && m[1]) {
          total = parseNum(m[1]);
          if (total !== null) totalConf = 0.98;
        }
      }
    }

    // Deduce missing values if math relationship holds
    if (subtotal !== null && tax !== null && total === null) {
      total = Math.round((subtotal + tax) * 100) / 100;
      totalConf = 0.85;
    } else if (total !== null && subtotal !== null && tax === null) {
      tax = Math.round((total - subtotal) * 100) / 100;
      taxConf = 0.8;
    } else if (total !== null && tax !== null && subtotal === null) {
      subtotal = Math.round((total - tax) * 100) / 100;
      subtotalConf = 0.8;
    }

    return { subtotal, tax, total, subtotalConf, taxConf, totalConf };
  }

  private static detectLineItems(lines: string[]): { items: LineItem[]; confidence: number } {
    const items: LineItem[] = [];

    for (const line of lines) {
      if (/subtotal|tax|total|invoice|date|bill\s*to|summary|sheet/i.test(line)) continue;

      // Pattern 1: Comma-separated (CSV rows: "Industrial Safety Helmets,10,25.00,250.00")
      if (line.includes(',')) {
        const parts = line.split(',').map((p) => p.trim());
        if (parts.length >= 4) {
          const desc = parts[0];
          const qty = parseInt(parts[1], 10);
          const unit = parseFloat(parts[2].replace(/[$,€£৳]/g, ''));
          const tot = parseFloat(parts[3].replace(/[$,€£৳]/g, ''));

          if (!isNaN(qty) && !isNaN(unit) && !isNaN(tot) && desc.length > 2 && isNaN(Number(desc))) {
            items.push({
              description: desc,
              quantity: qty,
              unit_price: Math.round(unit * 100) / 100,
              total_price: Math.round(tot * 100) / 100,
            });
            continue;
          }
        }
      }

      // Pattern 2: Tab-separated (Excel rows)
      if (line.includes('\t')) {
        const parts = line.split('\t').map((p) => p.trim());
        if (parts.length >= 4) {
          const desc = parts[0];
          const qty = parseInt(parts[1], 10);
          const unit = parseFloat(parts[2].replace(/[$,€£৳]/g, ''));
          const tot = parseFloat(parts[3].replace(/[$,€£৳]/g, ''));

          if (!isNaN(qty) && !isNaN(unit) && !isNaN(tot) && desc.length > 2 && isNaN(Number(desc))) {
            items.push({
              description: desc,
              quantity: qty,
              unit_price: Math.round(unit * 100) / 100,
              total_price: Math.round(tot * 100) / 100,
            });
            continue;
          }
        }
      }

      // Pattern 3: Space-delimited (PDF text rows: "Enterprise Cloud Hosting 1 1200.00 1200.00")
      const match = line.match(/^([A-Za-z0-9\s-_.()]{3,50})\s+(\d+)\s+[$€£৳]?([0-9,.]+)\s+[$€£৳]?([0-9,.]+)$/);
      if (match) {
        const desc = match[1].trim();
        const qty = parseInt(match[2], 10);
        const unit = parseFloat(match[3].replace(/,/g, ''));
        const tot = parseFloat(match[4].replace(/,/g, ''));

        if (!isNaN(qty) && !isNaN(unit) && !isNaN(tot) && isNaN(Number(desc))) {
          items.push({
            description: desc,
            quantity: qty,
            unit_price: Math.round(unit * 100) / 100,
            total_price: Math.round(tot * 100) / 100,
          });
        }
      }
    }

    const conf = items.length > 0 ? 0.95 : 0.0;
    return { items, confidence: conf };
  }
}
