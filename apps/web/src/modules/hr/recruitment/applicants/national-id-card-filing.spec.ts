// The scanned card has to become a FILED card, checked by source.
//
// Three links in a chain that no runtime test in this package can observe end to end, and each one
// silently produced nothing before:
//
//   1. THE SCAN IS FILED BY KIND. It used to go to whichever category happened to allow an image
//      first — which could be the applicant-source ICON category — so nothing downstream could
//      tell a scanned card from any other picture.
//   2. THE IDS REACH THE REGISTER CALL. The scan runs before the applicant exists, so its uploads
//      land on a scratch reference; unless the ids travel with the registration, nothing ever
//      connects them to the person they were read from.
//   3. THE CATEGORY IS THE ONE THE PACKAGE READS. A card filed under any other key is a card the
//      security-check form will never print.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APPLICANT_NATIONAL_ID_FILE_CATEGORY } from '@ecms/contracts';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
/** Prose may describe the old behaviour; only CODE may still perform it. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const OCR = code(read('./components/ApplicantNationalIdOcr.tsx'));
const FORM = code(read('./components/ApplicantForm.tsx'));

describe('the scan is filed by kind', () => {
  it('picks the National-ID category by key, not by "first one allowing an image"', () => {
    expect(OCR).toContain('APPLICANT_NATIONAL_ID_FILE_CATEGORY');
    expect(OCR).toContain('c.key === APPLICANT_NATIONAL_ID_FILE_CATEGORY');
  });

  it('keeps a fallback so a database seeded before the category still scans', () => {
    expect(OCR).toContain("m.startsWith('image/')");
  });
});

describe('the ids reach the registration', () => {
  it('the scanner reports what it uploaded', () => {
    expect(OCR).toContain('onScanned?.(');
    // Only the ids that exist — a card scanned front-only must not report an undefined.
    expect(OCR).toContain('id !== undefined');
  });

  it('the form holds them and sends them with the register body', () => {
    expect(FORM).toContain('onScanned={setCardFileIds}');
    expect(FORM).toContain('nationalIdCardFileIds: cardFileIds');
    // …and sends nothing at all when no card was scanned, rather than an empty array.
    expect(FORM).toContain('cardFileIds.length === 0 ? {} :');
  });
});

describe('the category is the one the package reads', () => {
  it('is the shared constant, so the writer and the reader cannot drift apart', () => {
    expect(APPLICANT_NATIONAL_ID_FILE_CATEGORY).toBe('hr-applicant-national-id');
  });
});
