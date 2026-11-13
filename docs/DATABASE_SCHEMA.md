# Database Schema Specification

## 1. Entity-Relationship Diagram (ERD)

```mermaid
erDiagram
    users ||--o{ audit_logs : performs
    documents ||--|| extractions : has
    documents ||--|| validations : has
    documents ||--o{ audit_logs : tracks
    documents ||--o{ document_vectors : indexes
    documents ||--o{ cross_verifications : participates_as_docA
    documents ||--o{ cross_verifications : participates_as_docB

    users {
        TEXT id PK
        TEXT username UK
        TEXT email UK
        TEXT password_hash
        TEXT role
        TEXT api_key UK
        DATETIME created_at
    }

    documents {
        TEXT id PK
        TEXT filename
        TEXT original_name
        TEXT mime_type
        INTEGER file_size
        TEXT file_hash
        INTEGER page_count
        TEXT status
        TEXT failure_reason
        INTEGER retry_count
        INTEGER processing_time_ms
        DATETIME created_at
        DATETIME updated_at
    }

    extractions {
        TEXT id PK
        TEXT document_id FK
        TEXT raw_text
        TEXT invoice_number
        TEXT invoice_date
        TEXT supplier_name
        TEXT customer_name
        REAL subtotal
        REAL tax
        REAL total
        TEXT currency
        TEXT line_items_json
        TEXT confidence_scores_json
        TEXT extraction_method
        DATETIME created_at
    }

    validations {
        TEXT id PK
        TEXT document_id FK
        INTEGER is_valid
        INTEGER requires_manual_review
        TEXT math_errors_json
        TEXT missing_fields_json
        TEXT duplicate_flags_json
        TEXT review_reasons_json
        DATETIME created_at
    }

    audit_logs {
        TEXT id PK
        TEXT document_id FK
        TEXT user_id FK
        TEXT action
        TEXT field_changed
        TEXT old_value
        TEXT new_value
        TEXT reason
        DATETIME created_at
    }

    cross_verifications {
        TEXT id PK
        TEXT doc_a_id FK
        TEXT doc_b_id FK
        TEXT status
        REAL match_score
        TEXT discrepancies_json
        TEXT summary
        DATETIME created_at
    }

    document_vectors {
        TEXT id PK
        TEXT document_id FK
        TEXT vector_json
        TEXT text_preview
        DATETIME created_at
    }
```

---

## 2. Table Schemas & Indexing Strategy

### 1. `users` Table
Stores authentication credentials, hashed passwords, roles, and programmatic API keys.
- **Indexes:** `UNIQUE(username)`, `UNIQUE(email)`, `UNIQUE(api_key)`
- **Roles:** `ADMIN`, `ANALYST`, `OPERATOR`

### 2. `documents` Table
Stores metadata, file size, SHA-256 deduplication hash, page count, and processing status.
- **Statuses:** `QUEUED`, `PROCESSING`, `COMPLETED`, `NEEDS_REVIEW`, `VERIFIED`, `FAILED`
- **Indexes:**
  - `idx_documents_file_hash` ON `documents(file_hash)`
  - `idx_documents_status` ON `documents(status)`
  - `idx_documents_created_at` ON `documents(created_at)`

### 3. `extractions` Table
Contains structured financial data extracted by the hybrid AI pipeline.
- **Columns:** `invoice_number`, `invoice_date`, `supplier_name`, `customer_name`, `subtotal`, `tax`, `total`, `currency`, `line_items_json`, `confidence_scores_json`.
- **Indexes:**
  - `idx_extractions_invoice_num` ON `extractions(invoice_number)`
  - `idx_extractions_supplier` ON `extractions(supplier_name)`

### 4. `validations` Table
Maintains mathematical validation results, missing mandatory field alerts, duplicate flags, and manual review requirements.

### 5. `audit_logs` Table
Provides an immutable ledger of every manual correction applied by auditors: who performed it, what field was updated, old value vs new value, mandatory justification reason, and timestamp.

### 6. `cross_verifications` Table
Maintains reconciliation history comparing Document A (PDF) with Document B (PDF or Excel), storing match scores and detailed discrepancies.

### 7. `document_vectors` Table
Maintains normalized semantic term vectors for semantic similarity queries and cosine distance calculation.

