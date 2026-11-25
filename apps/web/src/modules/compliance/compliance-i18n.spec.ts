// Every string the Compliance files page asks for must resolve in BOTH locales — `translate()`
// falls back to the key, so a missing translation is invisible to typecheck, lint and every render
// test. Two halves, as Administrative Affairs' guard has: the vocabulary half, for the keys built
// from a contracts enum (a file's kind, an access action); and the source half, every literal
// `'compliance.…'` the module's sources hold.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COMPLIANCE_ACCESS_ACTIONS,
  COMPLIANCE_DOCUMENT_KINDS,
  ErrorCodes,
  type Locale,
} from '@ecms/contracts';
import { translate } from '../../platform/localization/i18n';
import { errorMessage } from '../../shared/lib/errors';
import { ApiError } from '../../shared/lib/api-client';

const LOCALES: Locale[] = ['en', 'ar'];
const HERE = dirname(fileURLToPath(import.meta.url));

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.spec.') ? [full] : [];
  });

const literalKeys = (): string[] => [
  ...new Set(
    sources(HERE).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/'(compliance\.[a-zA-Z]+(?:\.[a-zA-Z]+)+)'/g)].map(
        (match) => match[1] as string,
      ),
    ),
  ),
];

const VOCABULARY = [
  ...COMPLIANCE_DOCUMENT_KINDS.map((kind) => `compliance.kind.${kind}`),
  ...COMPLIANCE_ACCESS_ACTIONS.map((action) => `compliance.seen.action.${action}`),
];

describe('the Compliance files page speaks both languages', () => {
  it('finds the strings it checks — a guard over nothing passes forever', () => {
    expect(literalKeys().length).toBeGreaterThan(60);
  });

  for (const locale of LOCALES) {
    it(`resolves every key it asks for in ${locale}`, () => {
      const missing = [...literalKeys(), ...VOCABULARY].filter(
        (key) => translate(locale, key) === key,
      );
      expect(missing).toEqual([]);
    });

    it(`words each of the module's refusals in ${locale}`, () => {
      for (const code of [
        ErrorCodes.COMPLIANCE_FOLDER_NAME_TAKEN,
        ErrorCodes.COMPLIANCE_VIEWER_INVALID,
        ErrorCodes.COMPLIANCE_FILE_CONTENT_MISMATCH,
      ]) {
        const said = errorMessage(new ApiError(code, 'raw server text', 422), locale);
        expect(said, code).not.toContain('raw server text');
        expect(said, code).not.toBe(code);
      }
    });
  }
});
