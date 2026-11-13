# System Architecture & Technical Specifications

## 1. High-Level System Architecture

```mermaid
flowchart TD
    Client["Client Web Interface (React + Tailwind)<br/>REST API Consumers (ERP / Scripts)"] -->|Multipart Upload / JSON API| API_Gateway["Express API Server (MVC Architecture)"]

    subgraph Security_Layer["Security & Validation Layer"]
        CORS["CORS Policy Guard"]
        Auth["JWT & API-Key Middleware (RBAC)"]
        ZodVal["Zod Schema Validator"]
    end

    API_Gateway --> CORS --> Auth --> ZodVal

    subgraph Core_Modules["Core Modules (MVC)"]
        DocController["Document Controller"]
        SearchController["Search & Vector Controller"]
        VerifyController["Cross-Verification Controller"]
        AnalyticsController["Analytics Controller"]
    end

    ZodVal --> Core_Modules

    DocController -->|Enqueue Document Job| JobQueue["Async JobQueue (Concurrency = 4)"]

    subgraph Ingestion_Pipeline["Multi-Format Document Parsing Engine"]
        JobQueue --> Dispatcher{"Format Dispatcher"}
        Dispatcher -->|PDF (Digital / Scanned)| PdfParser["PDF Parser (Streaming & Chunking up to 1000 pgs)"]
        Dispatcher -->|Images (JPG / PNG / TIFF)| ImageParser["OCR Image Parser (Tesseract.js / OpenCV)"]
        Dispatcher -->|Spreadsheets (XLSX / XLS)| ExcelParser["Excel Parser (Multi-sheet Traversal)"]
        Dispatcher -->|CSV| CsvParser["CSV Streaming Parser (Delimiter Sniffer)"]
    end

    subgraph AI_Extraction["AI Information Extraction"]
        PdfParser --> Extractor["Hybrid AI Extractor"]
        ImageParser --> Extractor
        ExcelParser --> Extractor
        CsvParser --> Extractor
        Extractor -->|Optional LLM API| LLM["Zero-Hallucination LLM Prompt Engine"]
        Extractor -->|Offline / Fallback| Heuristics["Deterministic Regex & NLP Parser"]
    end

    subgraph Validation_Engine["Data Validation & Cross-Verification"]
        Extractor --> ValRules["Math & Consistency Rules<br/>(Subtotal + Tax == Total, Line Items Sum)"]
        ValRules --> DupCheck["Duplicate Detection Engine (Hash & Supplier+Inv#)"]
        DupCheck --> ReviewFlag["Manual Review Flagging Engine"]
    end

    subgraph Persistence["Storage & Database Layer"]
        ReviewFlag --> SQLite[("SQLite Database (WAL Mode)<br/>• documents<br/>• extractions<br/>• validations<br/>• audit_logs")]
        Extractor --> VectorStore[("Vector Embedding Index<br/>(Cosine Semantic Search)")]
    end
```

---

## 2. Document Processing & Lifecycle State Machine

```mermaid
stateDiagram-v2
    [*] --> QUEUED: File Uploaded & SHA-256 Checksum Computed
    QUEUED --> PROCESSING: Worker Picks Job from Queue
    PROCESSING --> PARSING: Detect Format & Verify Magic Bytes
    PARSING --> OCR_EXTRACTION: Low Text Density / Image Format
    PARSING --> DIGITAL_EXTRACTION: Digital PDF / Sheet Rows
    OCR_EXTRACTION --> AI_EXTRACTION: Raw Text Extracted
    DIGITAL_EXTRACTION --> AI_EXTRACTION: Raw Text Extracted
    AI_EXTRACTION --> VALIDATION: Structured JSON Generated
    VALIDATION --> COMPLETED: Math Consistent & Mandatory Fields Present
    VALIDATION --> NEEDS_REVIEW: Math Mismatch / Duplicate / Missing Required Fields
    NEEDS_REVIEW --> VERIFIED: Auditor Applies Manual Correction & Supplies Audit Reason
    PROCESSING --> FAILED: Corrupted File / Parse Error (Retried up to 2 times)
```

---

## 3. Cross-Verification Pipeline (PDF vs PDF, PDF vs Excel)

```mermaid
sequenceDiagram
    autonumber
    actor Auditor as Financial Auditor / System
    participant API as Verification Controller
    participant Engine as Verification Service
    participant DB as SQLite Storage

    Auditor->>API: POST /api/v1/documents/cross-verify { docAId, docBId }
    API->>Engine: crossVerify(docAId, docBId)
    Engine->>DB: Fetch extractions & line items for Doc A & Doc B
    DB-->>Engine: Structured Invoice Records
    Note over Engine: 1. Total Amount Comparison & Variance %<br/>2. Invoice Number Exact / Substring Match<br/>3. Supplier & Customer Fuzzy Match<br/>4. Tax & Subtotal Reconciliation<br/>5. Line-by-Line Item & Price Matching
    Engine->>Engine: Compute Match Score (0 - 100%)
    Engine->>DB: Store CrossVerification Result
    Engine-->>API: Reconciliation Report + Discrepancy List
    API-->>Auditor: Return JSON Response with Status (MATCHED / DISCREPANCY_FOUND)
```

