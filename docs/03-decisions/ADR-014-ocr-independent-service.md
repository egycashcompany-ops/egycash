# ADR-014: OCR as an independent, provider-pluggable service

**Status:** Proposed · **Date:** 2026-07-08

## Context

Applicant intake requires Egyptian National ID OCR. OCR technology choices change fast
(external APIs, self-hosted models, future AI document intelligence), accuracy is never 100%,
and other modules will need OCR later (contracts, fleet documents). Embedding OCR in the
Recruitment feature would couple a volatile technology to a business module.

## Decision

- OCR is a **Platform Core service** (`platform/ai/ocr`), independent of any module.
- **Provider pattern**: `OcrProvider` interface (`extract(file, documentType) → ExtractionResult`);
  concrete providers (external OCR API first; self-hosted later) are configuration, registered in
  the Integrations connector registry with credentials in encrypted settings.
- **Document-type schemas**: each supported document type (first: `egyptian-national-id`)
  declares a Zod schema of extractable fields (name, national number, address, birth date, …).
  Results return per-field values **with confidence scores**.
- **Async by design**: extraction runs as a BullMQ job (`ocr` queue); the UI shows progress and
  receives results via job status/socket push.
- **Human-in-the-loop**: OCR results **pre-fill forms; a human confirms**. Extracted values are
  never committed to a record without user confirmation. Manual entry is always available.
- The Egyptian national number is additionally validated structurally (14 digits; embedded birth
  date and governorate code cross-checked against extracted fields).

## Alternatives considered

- **OCR inside the Recruitment feature** — rejected: couples volatile tech to a module; blocks reuse.
- **Synchronous OCR in the request path** — rejected: multi-second external calls in HTTP requests.
- **Trusting OCR output directly** — rejected: identity data errors in this industry are unacceptable.

## Consequences

- ✅ Swapping OCR vendors is configuration; new document types are schema additions.
- ✅ Any future module gets OCR by calling the platform service.
- ⚠️ Confidence thresholds and field-level review UX must be designed in the applicant form
  (low-confidence fields highlighted for verification).
