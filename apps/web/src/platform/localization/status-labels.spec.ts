// Every status a stage record can hold must have a label in BOTH locales.
//
// This exists because of a real regression: I11 added `waiting` and `inProgress` to
// `INTERVIEW_STATUSES`, the locale files were never extended, and `translate()` falls back to
// returning the key — so the interview queues rendered the literal string
// `interviews.status.waiting` to users. Nothing failed: not typecheck, not lint, not a test.
//
// The assertion is deliberately black-box — "a key must not resolve to itself" — because that is
// exactly the failure mode the fallback produces. Driving it from the contracts enums rather than
// a hand-written list is the whole point: adding a value to an enum without translating it is now
// a failing test, in every locale, for every stage.
import { describe, expect, it } from 'vitest';
import {
  APPLICANT_STATUSES,
  EVALUATION_STATUSES,
  INTERVIEW_OUTCOMES,
  INTERVIEW_STATUSES,
  OFFER_STATUSES,
  SCREENING_STATUSES,
  type Locale,
} from '@ecms/contracts';
import { translate } from './i18n';

const LOCALES: Locale[] = ['en', 'ar'];

/** Each stage's status enum and the key prefix its UI translates through. */
const VOCABULARIES: { name: string; prefix: string; values: readonly string[] }[] = [
  { name: 'interview status', prefix: 'interviews.status', values: INTERVIEW_STATUSES },
  { name: 'interview outcome', prefix: 'interviews.outcome', values: INTERVIEW_OUTCOMES },
  { name: 'screening status', prefix: 'screening.status', values: SCREENING_STATUSES },
  { name: 'evaluation status', prefix: 'evaluations.status', values: EVALUATION_STATUSES },
  { name: 'offer status', prefix: 'offers.status', values: OFFER_STATUSES },
  { name: 'applicant status', prefix: 'applicants.status', values: APPLICANT_STATUSES },
];

describe('recruitment status labels are translated in every locale', () => {
  for (const { name, prefix, values } of VOCABULARIES) {
    for (const locale of LOCALES) {
      it(`${name} — ${locale} has a label for every value`, () => {
        const untranslated = values.filter((value) => {
          const key = `${prefix}.${value}`;
          return translate(locale, key) === key;
        });
        expect(untranslated, `missing ${locale} labels under ${prefix}`).toEqual([]);
      });
    }
  }

  it('never renders a raw key: the two statuses the regression exposed', () => {
    for (const locale of LOCALES) {
      expect(translate(locale, 'interviews.status.waiting')).not.toBe('interviews.status.waiting');
      expect(translate(locale, 'interviews.status.inProgress')).not.toBe('interviews.status.inProgress');
    }
  });

  it('ar and en are genuinely different strings, so neither locale is a copy of the other', () => {
    for (const { prefix, values } of VOCABULARIES) {
      for (const value of values) {
        const key = `${prefix}.${value}`;
        expect(translate('ar', key), key).not.toBe(translate('en', key));
      }
    }
  });
});
