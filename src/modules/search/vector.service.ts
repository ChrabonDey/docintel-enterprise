import crypto from 'node:crypto';
import { getDatabase } from '../../config/database';

/**
 * High-performance 32-bit FNV-1a non-cryptographic hash for instant token dimension mapping.
 * Avoids expensive cryptographic MD5 context creation on millions of tokens.
 */
function fastTokenHash(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class VectorService {
  private static VOCAB_SIZE = 128; // Dimension of lightweight fast semantic embedding vector
  private static cachedVectors: Array<{ documentId: string; vector: number[]; preview: string }> | null = null;

  /**
   * Generates a normalized semantic term frequency hash vector for text.
   * Enables 100% local, ultra-fast cosine similarity semantic search without large external model weights.
   */
  static generateEmbedding(text: string): number[] {
    const vector = new Float32Array(this.VOCAB_SIZE);
    const tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/);

    let validTokenCount = 0;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.length > 2) {
        const bucket = fastTokenHash(token) % this.VOCAB_SIZE;
        vector[bucket] += 1;
        validTokenCount++;
      }
    }

    if (validTokenCount === 0) return Array.from(vector);

    // L2 Normalize the vector in a single pass
    let sumSquares = 0;
    for (let i = 0; i < this.VOCAB_SIZE; i++) {
      sumSquares += vector[i] * vector[i];
    }

    const norm = Math.sqrt(sumSquares);
    if (norm === 0) return Array.from(vector);

    const result = new Array(this.VOCAB_SIZE);
    const invNorm = 1 / norm;
    for (let i = 0; i < this.VOCAB_SIZE; i++) {
      result[i] = Math.round(vector[i] * invNorm * 10000) / 10000;
    }

    return result;
  }

  /**
   * Computes cosine similarity between two normalized vectors.
   */
  static cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) return 0;
    let dotProduct = 0;
    const len = vecA.length;
    for (let i = 0; i < len; i++) {
      dotProduct += vecA[i] * vecB[i];
    }
    return Math.max(0, Math.min(1, dotProduct));
  }

  /**
   * Indexes a document for semantic retrieval and updates in-memory vector cache.
   */
  static indexDocument(documentId: string, text: string): void {
    const db = getDatabase();
    const vector = this.generateEmbedding(text);
    const preview = text.slice(0, 300).trim();

    const insertQuery = db.prepare(`
      INSERT OR REPLACE INTO document_vectors (id, document_id, vector_json, text_preview)
      VALUES (?, ?, ?, ?)
    `);

    insertQuery.run(crypto.randomUUID(), documentId, JSON.stringify(vector), preview);

    // Invalidate vector cache
    this.cachedVectors = null;
  }

  /**
   * Performs semantic vector search matching a query string with in-memory vector cache.
   */
  static searchSimilar(
    query: string,
    limit = 10,
    minScore = 0.15
  ): Array<{ documentId: string; score: number; preview: string }> {
    const db = getDatabase();
    const queryVector = this.generateEmbedding(query);

    // Load and cache vectors if not already cached
    if (!this.cachedVectors) {
      const rows = db.prepare('SELECT document_id, vector_json, text_preview FROM document_vectors').all() as any[];
      this.cachedVectors = rows.map((r) => ({
        documentId: r.document_id,
        vector: JSON.parse(r.vector_json),
        preview: r.text_preview,
      }));
    }

    const scored: Array<{ documentId: string; score: number; preview: string }> = [];

    for (let i = 0; i < this.cachedVectors.length; i++) {
      const item = this.cachedVectors[i];
      const score = this.cosineSimilarity(queryVector, item.vector);
      if (score >= minScore) {
        scored.push({
          documentId: item.documentId,
          score: Math.round(score * 100) / 100,
          preview: item.preview,
        });
      }
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
