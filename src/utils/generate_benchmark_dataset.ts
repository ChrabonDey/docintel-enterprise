import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

const DATASETS_DIR = path.resolve('datasets');
const INVOICES_DIR = path.join(DATASETS_DIR, 'invoices');

if (!fs.existsSync(INVOICES_DIR)) {
  fs.mkdirSync(INVOICES_DIR, { recursive: true });
}

/**
 * Creates a minimal valid standard digital PDF file with embedded text streams.
 */
function createDigitalPdf(filePath: string, textLines: string[]) {
  const contentStream = textLines
    .map((line, idx) => `BT /F1 12 Tf 50 ${750 - idx * 20} Td (${line.replace(/[()]/g, '')}) Tj ET`)
    .join('\n');

  const pdfData = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${contentStream.length} >>
stream
${contentStream}
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000300 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
385
%%EOF`;

  fs.writeFileSync(filePath, pdfData, 'utf-8');
}

/**
 * Creates a multi-page PDF (simulating 10-page document).
 */
function createMultiPagePdf(filePath: string, pages: string[][]) {
  let objects = '';
  const pageRefs: string[] = [];
  let objCount = 2; // obj 1 is catalog, obj 2 is pages

  // We'll generate pages starting at obj 3
  const pageObjs: string[] = [];
  let currentObjIdx = 3;

  for (let p = 0; p < pages.length; p++) {
    const pageObjIdx = currentObjIdx++;
    const contentObjIdx = currentObjIdx++;
    const fontObjIdx = currentObjIdx++;

    pageRefs.push(`${pageObjIdx} 0 R`);

    const stream = pages[p]
      .map((line, idx) => `BT /F1 12 Tf 50 ${750 - idx * 22} Td (${line.replace(/[()]/g, '')}) Tj ET`)
      .join('\n');

    pageObjs.push(`
${pageObjIdx} 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjIdx} 0 R /Resources << /Font << /F1 ${fontObjIdx} 0 R >> >> >>
endobj
${contentObjIdx} 0 obj
<< /Length ${stream.length} >>
stream
${stream}
endstream
endobj
${fontObjIdx} 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
    `);
  }

  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pages.length} >>
endobj
${pageObjs.join('\n')}
xref
0 ${currentObjIdx}
trailer
<< /Size ${currentObjIdx} /Root 1 0 R >>
startxref
500
%%EOF`;

  fs.writeFileSync(filePath, pdf, 'utf-8');
}

export function generateBenchmarkDataset() {
  console.log('📦 Generating labeled benchmark dataset...');

  // 1. Digital PDF Invoice (Clean)
  const pdf1Path = path.join(INVOICES_DIR, 'INV-2026-001_ApexSolutions.pdf');
  createDigitalPdf(pdf1Path, [
    'Apex Cloud Solutions Inc.',
    '100 Enterprise Way, Suite 400',
    'Invoice Number: INV-2026-001',
    'Invoice Date: 2026-02-15',
    'Bill To: Global Logistics Corp',
    '-------------------------------------------------------',
    'Description                    Qty   UnitPrice   Total',
    'Enterprise Cloud Hosting        1    1200.00     1200.00',
    'Dedicated SSL Certificate       2     150.00      300.00',
    '-------------------------------------------------------',
    'Subtotal: $1500.00',
    'Tax (10%): $150.00',
    'Total: $1650.00',
    'Currency: USD',
  ]);

  // 2. Multi-Page Digital PDF Invoice (Simulating multi-page document)
  const pdfMultiPath = path.join(INVOICES_DIR, 'INV-2026-002_EnterpriseMultiPage.pdf');
  createMultiPagePdf(pdfMultiPath, [
    [
      'Titanium Logistics Global',
      'Invoice Number: INV-2026-002',
      'Invoice Date: 2026-03-01',
      'Customer: Acme Manufacturing Ltd',
      'Page 1: Freight Services',
      'Freight Shipping Express 1 2000.00 2000.00',
    ],
    [
      'Titanium Logistics Global',
      'Invoice Number: INV-2026-002',
      'Page 2: Warehousing and Handling',
      'Warehouse Cold Storage 3 500.00 1500.00',
      'Subtotal: $3500.00',
      'Tax (8%): $280.00',
      'Total: $3780.00',
      'Currency: USD',
    ],
  ]);

  // 3. Multi-Sheet Excel Invoice (XLSX)
  const xlsxPath = path.join(INVOICES_DIR, 'INV-2026-003_NordicRetail.xlsx');
  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary
  const summaryData = [
    ['Invoice Summary', ''],
    ['Invoice Number:', 'INV-2026-003'],
    ['Invoice Date:', '2026-04-10'],
    ['Supplier:', 'Nordic Retail Group'],
    ['Customer:', 'Metro Superstores'],
    ['Currency:', 'EUR'],
    ['Subtotal:', 4500.0],
    ['Tax (VAT 20%):', 900.0],
    ['Total:', 5400.0],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // Sheet 2: Line Items
  const lineItemsData = [
    ['Description', 'Quantity', 'UnitPrice', 'TotalPrice'],
    ['Organic Arabica Coffee Beans (Bulk)', 50, 60.0, 3000.0],
    ['Premium Ceylon Tea Crates', 30, 50.0, 1500.0],
  ];
  const wsItems = XLSX.utils.aoa_to_sheet(lineItemsData);
  XLSX.utils.book_append_sheet(wb, wsItems, 'LineItems');

  XLSX.writeFile(wb, xlsxPath);

  // 4. CSV Invoice
  const csvPath = path.join(INVOICES_DIR, 'INV-2026-004_DeltaSupplies.csv');
  const csvContent = [
    'Supplier: Delta Industrial Supplies Ltd',
    'Customer: BuildTech Contractors',
    'Invoice Number: INV-2026-004',
    'Invoice Date: 2026-05-18',
    'Description,Quantity,UnitPrice,TotalPrice',
    'Industrial Safety Helmets,10,25.00,250.00',
    'Heavy Duty Work Gloves,20,10.00,200.00',
    'Subtotal: $450.00',
    'Tax: $45.00',
    'Total: $495.00',
    'Currency: USD',
  ].join('\n');
  fs.writeFileSync(csvPath, csvContent, 'utf-8');

  // 5. Document with Intentional Math Discrepancy (for Task 3 validation tests)
  const mathErrorCsvPath = path.join(INVOICES_DIR, 'INV-2026-005_MathDiscrepancy.csv');
  const mathErrorContent = [
    'Supplier: Discrepancy Hardware Inc',
    'Customer: FixIt Retail',
    'Invoice Number: INV-2026-005',
    'Invoice Date: 2026-06-20',
    'Description,Quantity,UnitPrice,TotalPrice',
    'Power Drill Model X,2,100.00,200.00',
    'Subtotal: $200.00',
    'Tax: $20.00',
    'Total: $300.00', // Intentional error: 200 + 20 != 300
    'Currency: USD',
  ].join('\n');
  fs.writeFileSync(mathErrorCsvPath, mathErrorContent, 'utf-8');

  // 6. Purchase Order Excel for Cross-Verification against INV-2026-003
  const poXlsxPath = path.join(INVOICES_DIR, 'PO-2026-003_MetroSuperstores.xlsx');
  const poWb = XLSX.utils.book_new();
  const poData = [
    ['Purchase Order', ''],
    ['PO Number:', 'PO-2026-003'],
    ['Invoice CrossRef:', 'INV-2026-003'],
    ['Vendor:', 'Nordic Retail Group'],
    ['Buyer:', 'Metro Superstores'],
    ['Subtotal:', 4500.0],
    ['Tax:', 900.0],
    ['Total:', 5400.0],
    ['Currency:', 'EUR'],
    ['Description', 'Quantity', 'UnitPrice', 'TotalPrice'],
    ['Organic Arabica Coffee Beans (Bulk)', 50, 60.0, 3000.0],
    ['Premium Ceylon Tea Crates', 30, 50.0, 1500.0],
  ];
  const wsPo = XLSX.utils.aoa_to_sheet(poData);
  XLSX.utils.book_append_sheet(poWb, wsPo, 'PurchaseOrder');
  XLSX.writeFile(poWb, poXlsxPath);

  // 7. Corrupted File (0 bytes & invalid header)
  const corruptedPath = path.join(INVOICES_DIR, 'INV-2026-CORRUPTED.pdf');
  fs.writeFileSync(corruptedPath, 'NOT A REAL PDF FILE HEADER CORRUPTED DATA BYTES 123456');

  // 8. Ground Truth JSON dataset metadata
  const groundTruth = {
    'INV-2026-001_ApexSolutions.pdf': {
      invoice_number: 'INV-2026-001',
      invoice_date: '2026-02-15',
      supplier_name: 'Apex Cloud Solutions Inc.',
      customer_name: 'Global Logistics Corp',
      subtotal: 1500.0,
      tax: 150.0,
      total: 1650.0,
      currency: 'USD',
      line_items_count: 2,
      expected_valid: true,
      expected_review: false,
    },
    'INV-2026-002_EnterpriseMultiPage.pdf': {
      invoice_number: 'INV-2026-002',
      invoice_date: '2026-03-01',
      supplier_name: 'Titanium Logistics Global',
      customer_name: 'Acme Manufacturing Ltd',
      subtotal: 3500.0,
      tax: 280.0,
      total: 3780.0,
      currency: 'USD',
      line_items_count: 2,
      expected_valid: true,
      expected_review: false,
    },
    'INV-2026-003_NordicRetail.xlsx': {
      invoice_number: 'INV-2026-003',
      invoice_date: '2026-04-10',
      supplier_name: 'Nordic Retail Group',
      customer_name: 'Metro Superstores',
      subtotal: 4500.0,
      tax: 900.0,
      total: 5400.0,
      currency: 'EUR',
      line_items_count: 2,
      expected_valid: true,
      expected_review: false,
    },
    'INV-2026-004_DeltaSupplies.csv': {
      invoice_number: 'INV-2026-004',
      invoice_date: '2026-05-18',
      supplier_name: 'Delta Industrial Supplies Ltd',
      customer_name: 'BuildTech Contractors',
      subtotal: 450.0,
      tax: 45.0,
      total: 495.0,
      currency: 'USD',
      line_items_count: 2,
      expected_valid: true,
      expected_review: false,
    },
    'INV-2026-005_MathDiscrepancy.csv': {
      invoice_number: 'INV-2026-005',
      invoice_date: '2026-06-20',
      supplier_name: 'Discrepancy Hardware Inc',
      customer_name: 'FixIt Retail',
      subtotal: 200.0,
      tax: 20.0,
      total: 300.0,
      currency: 'USD',
      line_items_count: 1,
      expected_valid: false,
      expected_review: true,
    },
  };

  fs.writeFileSync(path.join(DATASETS_DIR, 'ground_truth.json'), JSON.stringify(groundTruth, null, 2), 'utf-8');
  console.log(`✅ Benchmark dataset generated with ${Object.keys(groundTruth).length} test documents in ${INVOICES_DIR}`);
}

// Execute if run directly
if (import.meta.main) {
  generateBenchmarkDataset();
}

