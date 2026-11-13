# System Walkthrough & Demonstration Guide
*(Script and step-by-step instructions for demonstrating the working application)*

This guide provides a structured walkthrough script demonstrating all 7 tasks required by the scenario: document ingestion, AI extraction, mathematical validation, REST API, semantic search, cross-verification, and the React frontend.

---

## 1. Quick Start Commands

```bash
# 1. Install dependencies (if not already installed)
bun install

# 2. Seed database with benchmark invoices and initial accounts
bun run seed

# 3. Run automated test suite
bun test tests/

# 4. Run benchmark evaluation suite
bun run evaluate

# 5. Start the full-stack server
bun run start
```
The application will be live at: **`http://localhost:4000`**

---

## 2. Walkthrough Script for Video Recording

### Scene 1: Introduction & Scenario Overview (0:00 - 1:00)
- **Goal:** Introduce the business problem: company receives thousands of multi-format business documents daily (PDFs up to 1000 pages, Excel, CSV, images), with employees spending hours manually extracting invoice details, verifying calculations, and cross-verifying invoices with spreadsheets.
- **Action:** Show the system landing page running at `http://localhost:4000`. Point out the clean UI tabs: Documents Repository, Ingestion Center, Cross-Verification Studio, Semantic Search, and Analytics.

### Scene 2: Document Processing & Multi-Format Ingestion (1:00 - 2:30)
- **Goal:** Demonstrate Task 1 & Task 4.
- **Action:**
  1. Click on the **Upload** tab.
  2. Drag and drop multiple files from `datasets/invoices/`:
     - Digital single-page invoice (`INV-2026-001_ApexSolutions.pdf`)
     - Multi-page document (`INV-2026-002_EnterpriseMultiPage.pdf`)
     - Multi-sheet spreadsheet (`INV-2026-003_NordicRetail.xlsx`)
     - CSV billing record (`INV-2026-004_DeltaSupplies.csv`)
     - Math discrepancy invoice (`INV-2026-005_MathDiscrepancy.csv`)
  3. Submit upload. Note the immediate JSON response confirming files are queued in the background queue.
  4. Switch to the **Documents** tab. Show how the status badges update in real-time (`QUEUED` -> `PROCESSING` -> `COMPLETED` / `NEEDS_REVIEW`).

### Scene 3: AI Information Extraction & Zero-Hallucination Guarantee (2:30 - 4:00)
- **Goal:** Demonstrate Task 2.
- **Action:**
  1. Click **Inspect** on `INV-2026-001_ApexSolutions.pdf`.
  2. Show extracted fields:
     - Invoice Number: `INV-2026-001` (Confidence: 95%)
     - Invoice Date: `2026-02-15`
     - Supplier Name: `Apex Cloud Solutions Inc.`
     - Customer Name: `Global Logistics Corp`
     - Subtotal: `$1,500.00`, Tax: `$150.00`, Total: `$1,650.00`
     - Line items table:
       - Item 1: `Enterprise Cloud Hosting` (Qty: 1, Unit: $1200, Total: $1200)
       - Item 2: `Dedicated SSL Certificate` (Qty: 2, Unit: $150, Total: $300)
  3. Point out that no hallucinated data was invented; missing fields are explicitly flagged.

### Scene 4: Mathematical Validation & Manual Correction Workflow (4:00 - 5:30)
- **Goal:** Demonstrate Task 3 & Task 4 manual correction.
- **Action:**
  1. In the document list, find `INV-2026-005_MathDiscrepancy.csv` flagged with a yellow **NEEDS_REVIEW** badge.
  2. Click **Inspect**.
  3. Show the **Validation Alerts Banner**:
     - Alert: `Subtotal ($200.00) + Tax ($20.00) = $220.00, which does not match Total ($300.00). Difference: $80.00.`
  4. Click the **Manual Correction** button.
  5. Fix the Total amount from `300.00` to `220.00`.
  6. Fill in the mandatory audit reason: `"Audited line item calculations and corrected total to match subtotal + tax."`
  7. Click **Save & Verify**.
  8. Show how the document immediately transitions to **VERIFIED** status, the alert banner disappears, and an immutable entry is added to the **Audit Correction Trail**.

### Scene 5: Cross-Verification Studio (PDF vs Excel) (5:30 - 7:00)
- **Goal:** Demonstrate the scenario's cross-verification requirement (PDF-PDF and PDF-Excel cross-checking).
- **Action:**
  1. Navigate to the **Cross-Verification** tab.
  2. Select **Document A:** `INV-2026-003_NordicRetail.xlsx` (Supplier Invoice).
  3. Select **Document B:** `PO-2026-003_MetroSuperstores.xlsx` (Internal Purchase Order).
  4. Click **Run Reconciliation & Cross-Verification**.
  5. Show the resulting **Reconciliation Matrix**:
     - Overall Match Score: **100%**
     - Status: **MATCHED**
     - Field-by-field verification: Invoice Number, Supplier Name, Total Amount, Tax, and Line Items Count.

### Scene 6: Hybrid Keyword & Semantic Search (7:00 - 8:00)
- **Goal:** Demonstrate Task 5.
- **Action:**
  1. Navigate to the **Semantic Search** tab.
  2. Search for natural language concept: `"Enterprise cloud hosting"` (using Hybrid mode).
  3. Show that `INV-2026-001_ApexSolutions.pdf` is retrieved with high cosine similarity score (88%).
  4. Test keyword search for specific invoice ID: `"INV-2026-004"`.

### Scene 7: Performance Analytics & Test Suite (8:00 - 9:00)
- **Goal:** Demonstrate Task 7.
- **Action:**
  1. Navigate to the **Analytics** tab.
  2. Show live aggregated KPI metrics: Ingestion rate (100%), Extraction Success Rate, Average Processing Latency (~110ms), and Total Financial Invoiced Volume.
  3. Switch to terminal:
     - Run `bun test` to show 20 automated tests passing.
     - Run `bun run evaluate` to show empirical benchmark accuracy report (100% accuracy, latency breakdown).
  4. Conclude the demonstration.

