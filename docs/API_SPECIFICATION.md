# Enterprise Document Intelligence REST API Specification

**Base URL:** `http://localhost:4000/api/v1`

---

## 1. Authentication Endpoints

### `POST /auth/register`
Creates a new user account.
- **Request Body (JSON):**
  ```json
  {
    "username": "financial_auditor",
    "email": "auditor@company.com",
    "password": "StrongPassword123!",
    "role": "ANALYST"
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "User registered successfully",
    "data": {
      "user": {
        "id": "c1f7b0f0-82a1-43bf-b519-74d150b0c169",
        "username": "financial_auditor",
        "email": "auditor@company.com",
        "role": "ANALYST",
        "apiKey": "doc_key_84c8a514d0f508a8e137"
      },
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expiresIn": "24h"
    }
  }
  ```

### `POST /auth/login`
Authenticates user and returns JWT Bearer Token.
- **Request Body (JSON):**
  ```json
  {
    "usernameOrEmail": "admin@docintel.com",
    "password": "AdminPass123!"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expiresIn": "24h"
    }
  }
  ```

---

## 2. Document Ingestion & Processing Endpoints

### `POST /documents/upload`
Uploads multiple documents (PDF, JPG, PNG, TIFF, XLSX, XLS, CSV) and enqueues them for background OCR & AI extraction.
- **Headers:** `Authorization: Bearer <token>`
- **Content-Type:** `multipart/form-data`
- **Form Field:** `files` (array of files, max 20 per batch)
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "Successfully uploaded and queued 2 document(s).",
    "data": [
      {
        "id": "d3f58564-926d-4041-8e36-d262053684e1",
        "filename": "INV-2026-001_ApexSolutions.pdf",
        "size": 385,
        "mimeType": "application/pdf",
        "status": "QUEUED",
        "isDuplicate": false
      }
    ]
  }
  ```

### `GET /documents`
Lists ingested documents with pagination and filtering.
- **Query Params:**
  - `status`: `QUEUED | PROCESSING | COMPLETED | NEEDS_REVIEW | VERIFIED | FAILED`
  - `page`: default `1`
  - `limit`: default `20`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "d3f58564-926d-4041-8e36-d262053684e1",
        "original_name": "INV-2026-001_ApexSolutions.pdf",
        "status": "COMPLETED",
        "invoice_number": "INV-2026-001",
        "supplier_name": "Apex Cloud Solutions Inc.",
        "invoice_date": "2026-02-15",
        "total": 1650.00,
        "currency": "USD",
        "is_valid": 1,
        "requires_manual_review": 0
      }
    ],
    "pagination": { "total": 12, "page": 1, "limit": 20, "totalPages": 1 }
  }
  ```

### `GET /documents/:id`
Retrieves full document inspection metadata, raw text, extracted invoice JSON, validation report, and audit logs.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "document": { ... },
      "extraction": {
        "invoice_number": "INV-2026-001",
        "invoice_date": "2026-02-15",
        "supplier_name": "Apex Cloud Solutions Inc.",
        "customer_name": "Global Logistics Corp",
        "subtotal": 1500.00,
        "tax": 150.00,
        "total": 1650.00,
        "currency": "USD",
        "line_items": [
          { "description": "Enterprise Cloud Hosting", "quantity": 1, "unit_price": 1200.00, "total_price": 1200.00 },
          { "description": "Dedicated SSL Certificate", "quantity": 2, "unit_price": 150.00, "total_price": 300.00 }
        ],
        "confidence_scores": { "invoice_number": 0.95, "total": 0.98 }
      },
      "validation": {
        "isValid": true,
        "requiresManualReview": false,
        "mathErrors": [],
        "missingFields": [],
        "duplicateFlags": []
      },
      "auditLogs": []
    }
  }
  ```

### `PUT /documents/:id/corrections`
Applies manual corrections by an auditor. Updates fields, creates an immutable audit trail entry, re-evaluates validation rules, and transitions status to `VERIFIED`.
- **Requires Role:** `ADMIN` or `ANALYST`
- **Request Body (JSON):**
  ```json
  {
    "total": 1650.00,
    "tax": 150.00,
    "reason": "Corrected tax calculation error identified during financial review."
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Manual correction saved and document re-validated successfully.",
    "data": { ... }
  }
  ```

---

## 3. Cross-Verification Endpoints

### `POST /documents/cross-verify`
Cross-verifies two documents (e.g. PDF vs PDF, or PDF vs Excel Purchase Order).
- **Request Body (JSON):**
  ```json
  {
    "docAId": "c17d335c-6de5-4ac9-b1a8-9be741597120",
    "docBId": "4b2c5d65-bf6b-4301-a153-0301e6f615b8"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "status": "MATCHED",
      "matchScore": 100,
      "discrepancies": [],
      "summary": "Verification Passed: Documents match with 100% confidence."
    }
  }
  ```

---

## 4. Search & Analytics Endpoints

### `GET /search`
Performs hybrid keyword and semantic vector search.
- **Query Params:** `q=cloud+hosting&mode=hybrid`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "d3f58564-926d-4041-8e36-d262053684e1",
        "original_name": "INV-2026-001_ApexSolutions.pdf",
        "supplier_name": "Apex Cloud Solutions Inc.",
        "total": 1650.00,
        "semanticScore": 0.88
      }
    ]
  }
  ```

### `GET /analytics/metrics`
Returns system performance KPI metrics (success rate, average processing speed, financial volumes).

