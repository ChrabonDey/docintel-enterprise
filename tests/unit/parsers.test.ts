import { describe, it, expect } from 'bun:test';
import path from 'node:path';
import fs from 'node:fs';
import { PdfParser } from '../../src/modules/extraction/parsers/pdf.parser';
import { ExcelParser } from '../../src/modules/extraction/parsers/excel.parser';
import { CsvParser } from '../../src/modules/extraction/parsers/csv.parser';
import { ImageParser } from '../../src/modules/extraction/parsers/image.parser';
import { BadRequestError } from '../../src/core/errors/app-error';

describe('Document Parsers Unit Tests', () => {
  it('should parse digital PDF and extract pages and text', async () => {
    const pdfPath = path.resolve('datasets/invoices/INV-2026-001_ApexSolutions.pdf');
    const result = await PdfParser.parse(pdfPath);

    expect(result.pageCount).toBe(1);
    expect(result.text).toContain('INV-2026-001');
    expect(result.text).toContain('Apex Cloud Solutions Inc.');
    expect(result.text).toContain('1650.00');
  });

  it('should parse multi-page PDF and count total pages correctly', async () => {
    const multiPdfPath = path.resolve('datasets/invoices/INV-2026-002_EnterpriseMultiPage.pdf');
    const result = await PdfParser.parse(multiPdfPath);

    expect(result.pageCount).toBe(2);
    expect(result.text).toContain('Titanium Logistics Global');
    expect(result.text).toContain('INV-2026-002');
  });

  it('should parse multi-sheet Excel workbook and extract sheet data', async () => {
    const xlsxPath = path.resolve('datasets/invoices/INV-2026-003_NordicRetail.xlsx');
    const result = await ExcelParser.parse(xlsxPath);

    expect(result.totalSheets).toBe(2);
    expect(result.sheets[0].sheetName).toBe('Summary');
    expect(result.sheets[1].sheetName).toBe('LineItems');
    expect(result.text).toContain('Nordic Retail Group');
    expect(result.text).toContain('5400');
  });

  it('should auto-detect comma delimiter and parse CSV file', async () => {
    const csvPath = path.resolve('datasets/invoices/INV-2026-004_DeltaSupplies.csv');
    const result = await CsvParser.parse(csvPath);

    expect(result.delimiter).toBe(',');
    expect(result.rowCount).toBeGreaterThan(0);
    expect(result.text).toContain('Delta Industrial Supplies Ltd');
  });

  it('should detect and reject corrupted PDF file with invalid header', async () => {
    const corruptedPath = path.resolve('datasets/invoices/INV-2026-CORRUPTED.pdf');
    expect(PdfParser.parse(corruptedPath)).rejects.toThrow(BadRequestError);
  });

  it('should reject 0-byte empty file gracefully', async () => {
    const emptyFile = path.resolve('datasets/invoices/empty_test_file.csv');
    fs.writeFileSync(emptyFile, '');
    try {
      expect(CsvParser.parse(emptyFile)).rejects.toThrow(BadRequestError);
    } finally {
      if (fs.existsSync(emptyFile)) fs.unlinkSync(emptyFile);
    }
  });
});

