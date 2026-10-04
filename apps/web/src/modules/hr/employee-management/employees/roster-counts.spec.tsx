// The preview's numbers read against the file the owner uploaded.
//
// «المفروض فى النهاية يكون عدد اللى هيتضافوا جداد يكون 76 بس شيل منهم اللى تم إخلاء طرفهم يعني
// هيبقوا 73 + (اللى تم إخلاء طرفهم ومش موجود ليهم بيانات عشان يتسجلوا وبعدين يتم إخلاء طرفهم) بس
// أكتبهم فى رقمين مختلفين — واللي تم إخلاء طرفهم مفروض 60».
//
// The screen said «أُضيفوا 81» against a Master sheet of 76 — new colleagues and people already
// gone in one number — and «تم إخلاء طرفهم 48» against a Resignation sheet of 60, in the past tense,
// under a banner saying nothing had been written. Each number was right; none could be checked.
//
// Pinned at the source and through `translate()`: the dialog reaches its preview only after a
// mutation resolves, which a static render cannot produce.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROSTER_IMPORT_ACTIONS, type Locale } from '@ecms/contracts';
import { translate } from '../../../../platform/localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROSTER = readFileSync(join(HERE, 'components/RosterImportDialog.tsx'), 'utf8');
const LOCALES: Locale[] = ['en', 'ar'];

describe('new people are two numbers, not one', () => {
  it('has a separate kind of write for somebody new who has already left', () => {
    expect(ROSTER_IMPORT_ACTIONS).toContain('addedExited');
  });

  /** `imported` still counts everybody new; the on-duty card must not show it whole. */
  it('shows the newcomers on duty without the new leavers', () => {
    expect(ROSTER).toContain('counts.imported - counts.importedExited');
    expect(ROSTER).toContain('value={onDuty}');
    expect(ROSTER).toContain('value={counts.importedExited}');
  });

  it('gives each of the two its own switch, both on by default', () => {
    expect(ROSTER).toContain("onToggle: () => toggle('added')");
    expect(ROSTER).toContain("onToggle: () => toggle('addedExited')");
    expect(ROSTER).toContain(
      "const DEFAULT_ACTIONS: readonly RosterImportAction[] = ['added', 'addedExited', 'exited'];",
    );
  });
});

describe('the leavers add up to the Resignation sheet', () => {
  it('prints the total with where each of them went, on the preview only', () => {
    expect(ROSTER).toContain('!applied && counts.leavers > 0');
    expect(ROSTER).toContain("t('employees.roster.leaversLine', {");
  });

  it('says it in both locales with every number filled in', () => {
    for (const locale of LOCALES) {
      const line = translate(locale, 'employees.roster.leaversLine', {
        total: 60,
        exits: 48,
        added: 8,
        already: 4,
      });
      expect(line).not.toContain('{{');
      for (const n of ['60', '48', '8', '4']) expect(line).toContain(n);
    }
  });
});

describe('the words on the cards', () => {
  /**
   * NOT «إخلاء طرف». The import records an END OF SERVICE; clearance is a separate process with a
   * column of its own in the very file being uploaded («حالة إخلاء الطرف»).
   */
  it('calls an exit an end of service, not a clearance', () => {
    for (const key of ['exits', 'exitsDone']) {
      expect(translate('ar', `employees.roster.counts.${key}`)).not.toContain('إخلاء');
      expect(translate('ar', `employees.roster.counts.${key}`)).toContain('انتهاء خدمتهم');
    }
  });

  /**
   * A PREVIEW SAYS WHAT WILL HAPPEN. Every card that is a write has a future label for the preview
   * and a past one for after the apply, chosen by `tense()` — «أُضيفوا» under «لم يُكتب شيء بعد»
   * told the reader two opposite things at once.
   */
  it('has a preview label and a done label for every write that changes tense', () => {
    for (const card of ['addedExited', 'exits', 'updated']) {
      expect(ROSTER).toContain(`tense('employees.roster.counts.${card}')`);
      for (const locale of LOCALES) {
        const preview = translate(locale, `employees.roster.counts.${card}`);
        const done = translate(locale, `employees.roster.counts.${card}Done`);
        expect(preview).not.toBe(`employees.roster.counts.${card}`);
        expect(done).not.toBe(`employees.roster.counts.${card}Done`);
        expect(done).not.toBe(preview);
      }
    }
    expect(ROSTER).toContain('t(applied ? `${key}Done` : key)');
  });

  it('labels the on-duty card with the words the owner used', () => {
    expect(translate('ar', 'employees.roster.counts.added')).toBe('جُدد على رأس العمل');
  });
});
