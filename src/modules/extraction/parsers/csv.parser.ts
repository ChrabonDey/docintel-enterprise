import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import { BadRequestError } from '../../../core/errors/app-error';
import { logger } from '../../../core/logger';

export interface ExtractedCsvData {
  headers: string[];
  rows: Record<string, any>[];
  rowCount: number;
  delimiter: string;
  text: string;
}

export class CsvParser {
  /**
   * Synchronously detects delimiter by inspecting first few lines.
   */
  static detectDelimiter(sample: string): string {
    const delimiters = [',', ';', '\t', '|'];
    const lines = sample.split('\n').filter((l) => l.trim().length > 0).slice(0, 5);
    if (lines.length === 0) return ',';

    let bestDelimiter = ',';
    let maxCount = -1;

    for (const delim of delimiters) {
      const counts = lines.map((line) => line.split(delim).length - 1);
      // check if delimiter appears consistently across lines
      const minInLine = Math.min(...counts);
      if (minInLine > 0 && minInLine > maxCount) {
        maxCount = minInLine;
        bestDelimiter = delim;
      }
    }

    return bestDelimiter;
  }

  /**
   * Asynchronously parses CSV files with delimiter auto-detection and error recovery.
   */
  static async parse(filePath: string): Promise<ExtractedCsvData> {
    if (!fs.existsSync(filePath)) {
      throw new BadRequestError(`CSV file not found at ${filePath}`);
    }

    const fileSize = fs.statSync(filePath).size;
    if (fileSize === 0) {
      throw new BadRequestError('Corrupted document: CSV file has 0 bytes.');
    }

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const delimiter = this.detectDelimiter(fileContent);

    try {
      const records: string[][] = parse(fileContent, {
        delimiter,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });

      if (records.length === 0) {
        return {
          headers: [],
          rows: [],
          rowCount: 0,
          delimiter,
          text: '',
        };
      }

      const headers = records[0].map((h, idx) => h || `Column_${idx + 1}`);
      const rows: Record<string, any>[] = [];

      for (let i = 1; i < records.length; i++) {
        const row = records[i];
        const rowObj: Record<string, any> = {};
        headers.forEach((hdr, idx) => {
          rowObj[hdr] = row[idx] !== undefined ? row[idx] : '';
        });
        rows.push(rowObj);
      }

      logger.info(`CSV parsed successfully with delimiter '${delimiter}': ${rows.length} rows.`);

      return {
        headers,
        rows,
        rowCount: rows.length,
        delimiter,
        text: fileContent,
      };
    } catch (err: any) {
      logger.error(`CSV parsing error: ${err.message}`);
      throw new BadRequestError(`Failed to parse CSV file: ${err.message}`);
    }
  }
}

