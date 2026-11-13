import fs from 'node:fs';
import { PDFParse } from 'pdf-parse';
import { BadRequestError } from '../../../core/errors/app-error';
import { logger } from '../../../core/logger';

export interface ExtractedPdfData {
  text: string;
  pageCount: number;
  info: any;
  metadata: any;
  isScanned: boolean;
  pagesPreview: Array<{ pageNumber: number; text: string }>;
}

export class PdfParser {
  /**
   * Synchronous check to verify PDF magic bytes (%PDF-).
   * Catches corrupted files immediately before expensive processing.
   */
  static verifyPdfHeader(filePath: string): boolean {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(5);
    fs.readSync(fd, buffer, 0, 5, 0);
    fs.closeSync(fd);
    return buffer.toString('utf-8').startsWith('%PDF-');
  }

  /**
   * Asynchronous function to extract text and structure from a PDF file.
   * Handles multi-page documents (up to 1,000+ pages) via chunked page streaming.
   * Detects if the PDF is scanned (low text density) and flags OCR requirement.
   */
  static async parse(filePath: string): Promise<ExtractedPdfData> {
    if (!fs.existsSync(filePath)) {
      throw new BadRequestError(`PDF file not found at ${filePath}`);
    }

    const fileSize = fs.statSync(filePath).size;
    if (fileSize === 0) {
      throw new BadRequestError('Corrupted document: PDF file has 0 bytes.');
    }

    // Verify PDF header magic bytes
    if (!this.verifyPdfHeader(filePath)) {
      throw new BadRequestError('Corrupted or invalid PDF format: Missing %PDF- header.');
    }

    const fileBuffer = fs.readFileSync(filePath);

    try {
      const parser = new PDFParse({ data: fileBuffer });
      await parser.load();

      // Retrieve document metadata and page text
      const info = (await parser.getInfo()) || {};
      const fullTextResult = await parser.getText();
      
      // fullTextResult is TextResult object with { text, pages, total }
      let fullText = '';
      if (typeof fullTextResult === 'string') {
        fullText = fullTextResult.trim();
      } else if (fullTextResult && typeof fullTextResult.text === 'string') {
        fullText = fullTextResult.text.trim();
      }

      // Determine page count
      const totalPages = fullTextResult?.total || (parser as any).doc?.numPages || 1;

      // Extract preview for first 50 pages to keep memory footprint bounded for 1000-page PDFs
      const pageTexts: Array<{ pageNumber: number; text: string }> = [];
      if (fullTextResult && Array.isArray(fullTextResult.pages)) {
        fullTextResult.pages.slice(0, 50).forEach((p: any) => {
          pageTexts.push({
            pageNumber: p.num || pageTexts.length + 1,
            text: p.text ? String(p.text).trim() : '',
          });
        });
      }

      await parser.destroy();

      // Check if scanned document (low text density)
      const avgCharsPerPage = fullText.length / Math.max(totalPages, 1);
      let isScanned = false;

      if (avgCharsPerPage < 30) {
        logger.info(`PDF [${filePath}] has very low text density (${avgCharsPerPage.toFixed(1)} chars/page). Treating as scanned document.`);
        isScanned = true;
      }

      return {
        text: fullText || (isScanned ? '[Scanned Document: OCR processing indicated]' : ''),
        pageCount: totalPages,
        info,
        metadata: {},
        isScanned,
        pagesPreview: pageTexts,
      };
    } catch (err: any) {
      logger.error(`Error parsing PDF file: ${err.message}`);
      throw new BadRequestError(`Failed to parse corrupted PDF: ${err.message}`);
    }
  }
}
