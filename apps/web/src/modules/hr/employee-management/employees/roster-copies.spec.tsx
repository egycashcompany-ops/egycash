// The preview names the repeated rows it had to choose between.
//
// «لو فى بيانات متكرره خد واحد منهم وضيفه .. لكن متمنعش البيانات كلها إنها تتحط». The importer no
// longer refuses a person over a repeated row: it keeps one copy and lets them in. When the copies
// agreed there was nothing to choose; when they did NOT — row 15 «انقطاع», row 51 «استقالة» — the
// pick is shown here, before anything is written, so a wrong one is caught on this screen rather
// than found later on somebody's file.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Locale } from '@ecms/contracts';
import { translate } from '../../../../platform/localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROSTER = readFileSync(join(HERE, 'components/RosterImportDialog.tsx'), 'utf8');
const LOCALES: Locale[] = ['en', 'ar'];

describe('repeated rows the importer chose between', () => {
  it('lists them on the preview', () => {
    expect(ROSTER).toContain('report.disagreeingCopies.length > 0');
    expect(ROSTER).toContain("t('employees.roster.copiesTitle')");
  });

  /**
   * AMBER, NOT ROSE. Nobody was refused: the person went in. Painting the line the colour of the
   * «could not be read» list would tell the reader the opposite of what happened.
   */
  it('reads as a note, not as a refusal', () => {
    const start = ROSTER.indexOf('report.disagreeingCopies.length > 0');
    const section = ROSTER.slice(start, ROSTER.indexOf('</Section>', start));
    expect(section).toContain('text-amber-800');
    expect(section).not.toContain('text-rose');
  });

  it('says it in both locales, with every blank filled', () => {
    for (const locale of LOCALES) {
      for (const key of ['copiesTitle', 'copiesHint', 'copiesLine', 'copiesJoin']) {
        expect(translate(locale, `employees.roster.${key}`)).not.toBe(`employees.roster.${key}`);
      }
      const line = translate(locale, 'employees.roster.copiesLine', {
        name: 'كريم حسن محمد سليمان',
        code: '0101845',
        kept: 'K',
        dropped: 'D',
      });
      expect(line).not.toContain('{{');
      expect(line).toContain('0101845');
      expect(line).toContain('K');
      expect(line).toContain('D');
    }
  });
});
