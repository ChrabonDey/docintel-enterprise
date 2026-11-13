import fs from 'node:fs';
import path from 'node:path';
import { createWorker } from 'tesseract.js';
import { BadRequestError } from '../../../core/errors/app-error';
import { logger } from '../../../core/logger';

export interface ExtractedImageData {
  text: string;
  confidence: number;
  format: string;
  dimensions?: { width: number; height: number };
}

export class ImageParser {
  /**
   * Synchronous validation of image magic bytes to detect corruption immediately.
   */
  static verifyImageHeader(filePath: string): string {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(8);
    fs.readSync(fd, buffer, 0, 8, 0);
    fs.closeSync(fd);

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'JPEG';
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return 'PNG';
    }
    // TIFF: 49 49 2A 00 (Little Endian) or 4D 4D 00 2A (Big Endian)
    if (
      (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
      (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a)
    ) {
      return 'TIFF';
    }

    throw new BadRequestError('Corrupted or invalid image format: Unrecognized magic bytes.');
  }

  /**
   * Asynchronous OCR extraction using Tesseract.js.
   * Handles scanned documents, receipts, and invoices with confidence scoring.
   */
  static async parse(filePath: string): Promise<ExtractedImageData> {
    if (!fs.existsSync(filePath)) {
      throw new BadRequestError(`Image file not found at ${filePath}`);
    }

    const fileSize = fs.statSync(filePath).size;
    if (fileSize === 0) {
      throw new BadRequestError('Corrupted image: file size is 0 bytes.');
    }

    const format = this.verifyImageHeader(filePath);
    logger.info(`Starting OCR processing on ${format} image: ${path.basename(filePath)}`);

    try {
      const worker = await createWorker('eng');
      const ret = await worker.recognize(filePath);
      await worker.terminate();

      const text = ret.data.text.trim();
      const confidence = ret.data.confidence;

      return {
        text,
        confidence,
        format,
      };
    } catch (err: any) {
      logger.error(`OCR processing failed for ${filePath}: ${err.message}`);
      throw new BadRequestError(`OCR processing failed: ${err.message}`);
    }
  }
}

