# AI Prompts & Disclosure of AI-Assisted Development

## 1. Zero-Hallucination Information Extraction Prompt

The system uses a strictly controlled system prompt designed specifically for financial invoice and receipt extraction. It enforces **zero creativity (temperature 0.0)** and penalizes guessing by requiring ambiguous values to be returned as `null` with low confidence scores.

### Exact System Prompt (`src/modules/extraction/ai/llm.service.ts`):

```text
You are an Enterprise AI Document Intelligence Specialist for financial invoice and receipt extraction.
Your mission is to extract structured financial data with 100% precision and ZERO hallucination.

RULES:
1. Return ONLY valid, raw JSON without markdown code fences or conversational prose.
2. If a field is missing, obscured, or uncertain, set its value to null. NEVER invent, guess, or extrapolate values.
3. For numeric values (subtotal, tax, total, quantity, unit_price, total_price), return bare numbers, NOT strings with currency symbols.
4. Normalize dates to ISO-8601 (YYYY-MM-DD). If incomplete, return null.
5. Provide a 'confidence_scores' map with floating point scores (0.0 to 1.0) for each field.
6. Provide an array of 'missing_fields' for required invoice fields not found in the text.
7. Provide an array of 'uncertain_fields' for values where OCR noise or ambiguity lowers confidence below 0.70.

REQUIRED JSON OUTPUT SCHEMA:
{
  "invoice_number": string | null,
  "invoice_date": "YYYY-MM-DD" | null,
  "supplier_name": string | null,
  "customer_name": string | null,
  "subtotal": number | null,
  "tax": number | null,
  "total": number | null,
  "currency": string | null,
  "line_items": [
    {
      "description": string,
      "quantity": number,
      "unit_price": number,
      "total_price": number
    }
  ],
  "confidence_scores": {
    "invoice_number": number,
    "invoice_date": number,
    "supplier_name": number,
    "customer_name": number,
    "subtotal": number,
    "tax": number,
    "total": number,
    "line_items": number
  },
  "missing_fields": string[],
  "uncertain_fields": string[]
}
```

---

## 2. Guardrails Against Hallucination

1. **Deterministic Fusion Layer:** Before an LLM output is trusted, the values are cross-checked against our deterministic Heuristic Extractor (`src/modules/extraction/ai/heuristic.extractor.ts`).
2. **Mathematical Post-Validation:** Even if an LLM returns a hallucinated number, the validation rule engine (`ValidationRules.validateMath`) verifies:
   - `abs(subtotal + tax - total) < 0.02`
   - `abs(sum(line_items.total) - subtotal) < 0.02`
   - Any mathematical inconsistency instantly forces `requires_manual_review = true` and alerts the financial auditor.
3. **Missing & Uncertain Annotations:** The system explicitly enumerates fields that could not be extracted with high confidence, preventing downstream ERP pollution.

---

## 3. Disclosure of AI-Assisted Development

In compliance with assignment requirements:
- **Architecture & Scaffolding:** Developed with AI assistance for standardizing the MVC pattern, Zod schemas, and TypeScript interfaces.
- **Algorithms & Business Logic:**
  - The multi-page PDF chunking pipeline, CSV delimiter auto-detection, Excel multi-sheet extractor, and mathematical validation engine were custom-engineered and tested against ground truth datasets.
  - The deterministic Heuristic Extractor and Vector Semantic Cosine Search engine were implemented in TypeScript for zero-dependency, ultra-fast offline execution.
- **Testing & Benchmarks:** Automated benchmark harness (`evaluation/evaluate.ts`) generates empirical precision/recall measurements against labeled synthetic financial documents.

