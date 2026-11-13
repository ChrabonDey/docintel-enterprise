# Architectural Blueprint: Async/Sync, Promises, MVC, Zod & Graceful Shutdown

This document outlines the core software engineering principles and design patterns implemented across the **Enterprise Document Intelligence System**.

---

## 1. Synchronous vs Asynchronous Functions

The codebase enforces a rigorous boundary between synchronous and asynchronous operations to maximize throughput and guarantee zero thread starvation.

### A. Synchronous Operations (`@sync`)
Pure, deterministic, CPU-bound computations executed synchronously without event loop hopping or promise overhead:
- **Checksum Calculation:** Cryptographic SHA-256 hash generation of file buffers (`DocumentService.calculateFileHash`) for instant duplicate detection before database writes.
- **Header Magic Byte Verification:** Synchronously inspecting file header bytes (`%PDF-`, `PK\x03\x04`, `\xFF\xD8\xFF`, etc.) to trap corrupted documents before disk parsing.
- **Mathematical Rule Engine:**
  - `abs(subtotal + tax - total) < 0.02`
  - `abs(quantity * unit_price - line_item_total) < 0.02`
  - `abs(sum(line_items) - subtotal) < 0.02`
- **CSV Delimiter Sniffing:** Counting character occurrences across candidate separators (`,`, `;`, `\t`, `|`).
- **Vector Embedding Generation:** Fixed-dimension L2-normalized TF-IDF term hashing.

### B. Asynchronous Operations (`@async`)
I/O-bound, streaming, network, or high-latency operations orchestrated using native Promises and `async/await`:
- **Document Streaming & Chunking:** Multi-page PDF text extraction chunked into bounded page buffers to support documents up to **1,000+ pages** without memory spikes.
- **Spreadsheet Workbook Parsing:** Asynchronous extraction across multiple worksheets (`.xlsx`, `.xls`).
- **Background Worker Queue:** Non-blocking job dispatching with configurable concurrency (`QUEUE_CONCURRENCY=4`), retry limits, and exponential backoff.
- **LLM Inference Network Calls:** Remote API calls to LLM endpoints with HTTP timeouts and fallback heuristics.
- **Database Transaction Management:** SQLite WAL-mode writes, audit logging, and vector indexing.

---

## 2. Promise Patterns & Concurrency Control

- **`Promise.all` / `Promise.allSettled`:** Used during batch uploads and cross-file evaluations so one failing document does not abort the entire batch.
- **Bounded Concurrency Dispatcher (`JobQueue`):** Prevents thread pool exhaustion by maintaining an active worker semaphore pool:
  ```typescript
  while (this.activeJobs.size < this.maxConcurrency && this.queue.length > 0) {
    const job = this.queue.shift();
    this.executeJob(job).finally(() => {
      this.activeJobs.delete(job.documentId);
      this.dispatch(); // Trigger next pending item
    });
  }
  ```
- **Error Boundaries:** Every asynchronous promise chain handles rejection with centralized logging and status updates to `FAILED` with explicit `failure_reason`.

---

## 3. Graceful Shutdown Implementation

In production environments (Docker, Kubernetes, systemd), processes must terminate cleanly without dropping active HTTP requests, corrupting SQLite databases, or leaving orphaned files.

### Lifecycle Sequence:
1. **Signal Interception:** Listens for `SIGINT` (Ctrl+C) and `SIGTERM` (container termination).
2. **Stop Accepting Inbound Requests:** Calls `server.close()`, rejecting new HTTP connections while allowing existing requests to complete.
3. **Queue Draining:** Pauses `JobQueue` from accepting new items and waits for active in-flight worker tasks to finish (with a safety timeout of 10–15 seconds).
4. **Database Connection Teardown:** Executes `PRAGMA wal_checkpoint(TRUNCATE)` and safely closes the database handle.
5. **Clean Exit:** Exits with status code `0`.

**Code Reference:** `src/core/graceful-shutdown.ts`:
```typescript
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
```

---

## 4. Zod Schema Validation Pipeline

Every input entering the backend is strictly validated at runtime against Zod schemas:
- **`envSchema`:** Ensures environment variables (`PORT`, `JWT_SECRET`, `QUEUE_CONCURRENCY`) exist and match required types.
- **`registerSchema` / `loginSchema`:** Validates username alphanumeric format, email syntax, and password minimum length (8 chars).
- **`manualCorrectionSchema`:** Enforces required fields, non-negative financials, and a mandatory audit `reason` string.
- **`crossVerifySchema`:** Validates document IDs before triggering reconciliation.

Middleware implementation (`src/core/middleware/zod.middleware.ts`):
```typescript
export const validateBody = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync(req.body);
      req.body = parsed;
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        return next(new BadRequestError('Validation failed on request body', err.issues));
      }
      next(err);
    }
  };
};
```

---

## 5. Enterprise CORS Configuration

Cross-Origin Resource Sharing is centrally managed in `src/config/cors.config.ts`:
- **Dynamic Origin Whitelist:** Configurable via `env.CORS_ORIGIN` (supports comma-delimited origins or wildcard in development).
- **Allowed HTTP Methods:** `['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']`.
- **Allowed Headers:** `['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-KEY']`.
- **Credentials:** Enabled (`credentials: true`) for secure cookie/token propagation.
- **Preflight Cache:** `maxAge: 86400` (24-hour preflight cache reduces OPTIONS network roundtrips).

---

## 6. Modular MVC Architecture

The codebase strictly adheres to the **Module-Controller-Service-Model** pattern:

```
src/
├── config/                     # Environment, DB, CORS, & Logger setup
├── core/                       # Cross-cutting concerns: errors, middleware, shutdown
└── modules/
    ├── auth/                   # Authentication Module
    │   ├── auth.schema.ts      # Zod validation schemas
    │   ├── auth.model.ts       # Database DDL & queries
    │   ├── auth.service.ts     # Bcrypt, JWT, token logic
    │   ├── auth.controller.ts  # HTTP Request/Response mapping
    │   └── auth.routes.ts      # Route declarations
    │
    ├── documents/              # Document Ingestion & Storage Module
    │   ├── document.schema.ts
    │   ├── document.model.ts
    │   ├── document.service.ts
    │   ├── document.controller.ts
    │   └── document.routes.ts
    │
    ├── extraction/             # Parsing & Extraction Module
    │   ├── parsers/            # PDF (1000-page stream), Image, Excel, CSV
    │   └── ai/                 # LLM Service & Heuristic Extractor
    │
    ├── validation/             # Validation & Cross-Verification Module
    │   ├── validation.rules.ts # Math, required fields, duplicates
    │   └── verification.service.ts # PDF-PDF & PDF-Excel reconciliation
    │
    ├── search/                 # Search Module
    │   ├── vector.service.ts   # Semantic text embeddings & cosine similarity
    │   ├── search.service.ts   # Hybrid FTS + vector search
    │   └── search.routes.ts
    │
    ├── jobs/                   # Background Processing Queue
    │   └── queue.service.ts    # Concurrency semaphore & worker pipeline
    │
    └── analytics/              # Aggregations & Metrics Module
        ├── analytics.service.ts
        └── analytics.routes.ts
```

