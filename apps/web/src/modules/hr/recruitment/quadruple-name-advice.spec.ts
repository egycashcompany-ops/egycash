// The quadruple-name advice, checked by source.
//
// It is ADVICE in two places and blocking in neither, which is the whole point and the thing a
// later edit is most likely to get wrong:
//
//   1. AT ENTRY, on the applicant's Arabic name — the source. A form that leaves the building with
//      a two-part name comes back refused, and this is where that is cheap to prevent.
//   2. BEFORE ISSUING a batch — the last cheap moment, because issuing freezes membership and puts
//      the paper on somebody else's desk.
//
// Never a validation error: a three-part name is somebody's real name, and neither of these
// screens is the place to adjudicate that.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { countNameParts, isQuadrupleName } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const FORM = code(read('./applicants/components/ApplicantForm.tsx'));
const BATCH = code(read('./evaluation-batches/pages/EvaluationBatchDetailPage.tsx'));

describe('the advice at entry', () => {
  it('warns on the Arabic name, and does not error', () => {
    expect(FORM).toContain('!isQuadrupleName(f.fullNameAr)');
    expect(FORM).toContain("t('applicants.form.fullNameArNotQuadruple')");
    // The warning slot, never the error slot: an error would read as "this save is refused".
    expect(FORM).toContain('warning={');
  });

  it('says nothing about an empty field — that is the required check’s job', () => {
    expect(FORM).toContain("f.fullNameAr.trim() !== '' && !isQuadrupleName");
  });
});

describe('the advice before issuing', () => {
  it('lists the short names while the batch is still a draft', () => {
    expect(BATCH).toContain('shortNames');
    expect(BATCH).toContain('!isQuadrupleName(i.applicantName)');
    expect(BATCH).toContain('isDraft && shortNames.length > 0');
  });

  it('ignores voided members — they are not going out on the sheet', () => {
    expect(BATCH).toContain("i.result !== 'voided'");
  });

  it('never disables the issue button over a name', () => {
    const issue = BATCH.slice(BATCH.indexOf("t('batches.actions.issue')") - 400);
    expect(issue).not.toContain('shortNames.length > 0}');
    expect(BATCH).toContain('disabled={batch.counts.total === 0}');
  });
});

describe('the rule itself is shared, not re-implemented per screen', () => {
  it('both screens call the same contract helper', () => {
    expect(FORM).toContain('isQuadrupleName');
    expect(BATCH).toContain('isQuadrupleName');
    // …and nobody counts words on their own, which is what gets a compound name wrong.
    expect(FORM).not.toContain("split(' ').length");
    expect(BATCH).not.toContain("split(' ').length");
  });

  it('the helper is the one that understands compound parts', () => {
    expect(countNameParts('محمد عبد الله علي')).toBe(3);
    expect(isQuadrupleName('عبد الرحمن محمد علي حسن')).toBe(true);
  });
});

describe('translations', () => {
  it('has both new keys in both languages, and they differ', () => {
    for (const key of ['applicants.form.fullNameArNotQuadruple', 'batches.shortNames.warning']) {
      const en = translate('en', key);
      const ar = translate('ar', key);
      expect(en).not.toBe(key);
      expect(ar).not.toBe(key);
      expect(ar).not.toBe(en);
    }
  });
});
