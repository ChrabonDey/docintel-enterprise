import { Database } from 'bun:sqlite';
import { env } from './env.config';
import fs from 'node:fs';
import path from 'node:path';

let dbInstance: Database | null = null;

/**
 * Initializes and returns the SQLite database connection.
 * Configures WAL mode for high-concurrency read/write performance.
 */
export function getDatabase(): Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dbDir = path.dirname(path.resolve(env.DATABASE_PATH));
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  dbInstance = new Database(env.DATABASE_PATH);

  // Enable WAL (Write-Ahead Logging) and Foreign Keys for safety & performance
  dbInstance.run('PRAGMA journal_mode = WAL;');
  dbInstance.run('PRAGMA synchronous = NORMAL;');
  dbInstance.run('PRAGMA foreign_keys = ON;');

  initializeTables(dbInstance);
  return dbInstance;
}

/**
 * Executes DDL schema initialization if tables do not exist.
 */
function initializeTables(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT CHECK(role IN ('ADMIN', 'ANALYST', 'OPERATOR')) NOT NULL DEFAULT 'ANALYST',
      api_key TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_hash TEXT NOT NULL,
      page_count INTEGER DEFAULT 1,
      status TEXT CHECK(status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'NEEDS_REVIEW', 'VERIFIED', 'FAILED')) NOT NULL DEFAULT 'QUEUED',
      failure_reason TEXT,
      retry_count INTEGER DEFAULT 0,
      processing_time_ms INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_documents_file_hash ON documents(file_hash);
    CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
    CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS extractions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL UNIQUE,
      raw_text TEXT,
      invoice_number TEXT,
      invoice_date TEXT,
      supplier_name TEXT,
      customer_name TEXT,
      subtotal REAL,
      tax REAL,
      total REAL,
      currency TEXT,
      line_items_json TEXT, -- JSON array of line items
      confidence_scores_json TEXT, -- JSON object of field confidences
      extraction_method TEXT DEFAULT 'HYBRID_AI',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_extractions_invoice_num ON extractions(invoice_number);
    CREATE INDEX IF NOT EXISTS idx_extractions_supplier ON extractions(supplier_name);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS validations (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL UNIQUE,
      is_valid INTEGER NOT NULL DEFAULT 1,
      requires_manual_review INTEGER NOT NULL DEFAULT 0,
      math_errors_json TEXT, -- JSON array of math inconsistency messages
      missing_fields_json TEXT, -- JSON array of missing required field names
      duplicate_flags_json TEXT, -- JSON array of duplicate invoice warnings
      review_reasons_json TEXT, -- JSON array of strings
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      user_id TEXT,
      action TEXT NOT NULL,
      field_changed TEXT,
      old_value TEXT,
      new_value TEXT,
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS cross_verifications (
      id TEXT PRIMARY KEY,
      doc_a_id TEXT NOT NULL,
      doc_b_id TEXT NOT NULL,
      status TEXT CHECK(status IN ('MATCHED', 'DISCREPANCY_FOUND', 'FAILED')) NOT NULL,
      match_score REAL NOT NULL,
      discrepancies_json TEXT NOT NULL,
      summary TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (doc_a_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (doc_b_id) REFERENCES documents(id) ON DELETE CASCADE
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS document_vectors (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL UNIQUE,
      vector_json TEXT NOT NULL,
      text_preview TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
  `);
}

/**
 * Gracefully closes the database connection.
 */
export function closeDatabase(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
      console.log('📦 Database connection closed safely.');
    } catch (err) {
      console.error('Error closing database:', err);
    } finally {
      dbInstance = null;
    }
  }
}

