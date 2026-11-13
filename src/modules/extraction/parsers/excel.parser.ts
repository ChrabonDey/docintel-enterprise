import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { BadRequestError } from '../../../core/errors/app-error';
import { logger } from '../../../core/logger';

export interface SheetData {
  sheetName: string;
  rowCount: number;
  headers: string[];
  rows: Record<string, any>[];
  rawText: string;
}

export interface ExtractedExcelData {
  sheets: SheetData[];
  text: string;
  totalSheets: number;
  totalRows: number;
}

export class ExcelParser {
  /**
   * Synchronous validation of Excel file headers (PK zip header for .xlsx or OLE for .xls)
   */
  static verifyExcelHeader(filePath: string): boolean {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(8);
    fs.readSync(fd, buffer, 0, 8, 0);
    fs.closeSync(fd);

    // .xlsx is a PKZIP container (50 4B 03 04)
    const isXlsx = buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
    // .xls is an OLE CFB container (D0 CF 11 E0 A1 B1 1A E1)
    const isXls = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;

    return isXlsx || isXls;
  }

  /**
   * Asynchronously parses XLSX / XLS files, iterating across multiple sheets.
   */
  static async parse(filePath: string): Promise<ExtractedExcelData> {
    if (!fs.existsSync(filePath)) {
      throw new BadRequestError(`Excel file not found at ${filePath}`);
    }

    const fileSize = fs.statSync(filePath).size;
    if (fileSize === 0) {
      throw new BadRequestError('Corrupted document: Excel file has 0 bytes.');
    }

    if (!this.verifyExcelHeader(filePath)) {
      throw new BadRequestError('Corrupted or invalid spreadsheet: Missing valid Excel header signature.');
    }

    try {
      const fileBuffer = fs.readFileSync(filePath);
      const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });

      const sheets: SheetData[] = [];
      let aggregatedText = '';
      let totalRows = 0;

      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) continue;

        // Convert worksheet to JSON rows
        const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        if (rawJson.length === 0) {
          sheets.push({
            sheetName,
            rowCount: 0,
            headers: [],
            rows: [],
            rawText: `[Sheet: ${sheetName}] (Empty)`,
          });
          continue;
        }

        // Auto-detect header row (first non-empty array)
        let headerIndex = 0;
        while (headerIndex < rawJson.length && (!rawJson[headerIndex] || rawJson[headerIndex].length === 0)) {
          headerIndex++;
        }

        const headers: string[] = (rawJson[headerIndex] || []).map((h: any, i: number) =>
          String(h).trim() || `Column_${i + 1}`
        );

        const rows: Record<string, any>[] = [];
        for (let i = headerIndex + 1; i < rawJson.length; i++) {
          const rowValues = rawJson[i];
          if (!rowValues || rowValues.every((val: any) => val === '' || val === null || val === undefined)) {
            continue; // skip blank rows
          }

          const rowObj: Record<string, any> = {};
          headers.forEach((hdr, idx) => {
            rowObj[hdr] = rowValues[idx] !== undefined ? rowValues[idx] : '';
          });
          rows.push(rowObj);
        }

        totalRows += rows.length;

        // Generate text representation of the sheet
        const sheetText = [
          `--- Sheet: ${sheetName} ---`,
          headers.join('\t'),
          ...rows.map((r) => headers.map((h) => r[h]).join('\t')),
        ].join('\n');

        aggregatedText += sheetText + '\n\n';

        sheets.push({
          sheetName,
          rowCount: rows.length,
          headers,
          rows,
          rawText: sheetText,
        });
      }

      logger.info(`Excel parsed successfully: ${sheets.length} sheet(s), ${totalRows} total data rows.`);

      return {
        sheets,
        text: aggregatedText.trim(),
        totalSheets: sheets.length,
        totalRows,
      };
    } catch (err: any) {
      logger.error(`Failed to parse Excel spreadsheet: ${err.message}`);
      throw new BadRequestError(`Failed to parse Excel file: ${err.message}`);
    }
  }
}

