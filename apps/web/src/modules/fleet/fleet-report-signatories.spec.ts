// Who signs a printed Fleet report, and where those names live.
//
// «في إعدادات الحركة» — the six lines on the signature block are people, not template literals.
// Three things have to hold for that to stay true, and none of them fails loudly: the settings
// screen has to OFFER the six boxes, the print path has to READ them, and the template must never
// name one itself. A miss on any of them shows up as a document printed without a signature — or
// worse, printed with the wrong person's name on it after they have moved on.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FleetSettingKeys } from '@ecms/contracts';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(join(HERE, file), 'utf8');

/**
 * The six lines, each with the constant the screens name it by and the label they print.
 *
 * Spelled out rather than derived from the key: a rule that turns `fleet.report.preparedByTitle`
 * into `ReportPreparedByTitle` is a rule the next key breaks, and a test that quietly stops
 * checking anything is worse than no test.
 */
const SIGNATORIES = [
  ['ReportPreparedByTitle', FleetSettingKeys.ReportPreparedByTitle],
  ['ReportPreparedByName', FleetSettingKeys.ReportPreparedByName],
  ['ReportApprovedByTitle', FleetSettingKeys.ReportApprovedByTitle],
  ['ReportApprovedByName', FleetSettingKeys.ReportApprovedByName],
  ['ReportEndorsementNote', FleetSettingKeys.ReportEndorsementNote],
  ['ReportEndorsedByName', FleetSettingKeys.ReportEndorsedByName],
] as const;

describe('the signature block is edited from Fleet settings', () => {
  it('offers all six as free-text boxes on the settings screen', () => {
    const page = read('pages/FleetSettingsPage.tsx');
    for (const [constant, key] of SIGNATORIES) {
      expect(page, `${key} is offered`).toContain(`FleetSettingKeys.${constant}`);
    }
  });

  it('labels every one of them, rather than printing a raw key at an administrator', () => {
    const page = read('pages/FleetSettingsPage.tsx');
    const i18n = read('../../platform/localization/i18n.ts');
    for (const [constant, key] of SIGNATORIES) {
      const label = `fleet.settings.keys.${constant.charAt(0).toLowerCase()}${constant.slice(1)}`;
      expect(page, `${key} has a label key`).toContain(label);
      // Twice: English and Arabic. A label present in one locale only is a raw key in the other.
      expect((i18n.match(new RegExp(`'${label}':`, 'g')) ?? []).length, label).toBe(2);
    }
  });

  it('reads them through the platform resolver, not from a literal anywhere', () => {
    const hook = read('lib/use-report-signatories.ts');
    expect(hook, 'resolved user → branch → organization').toContain('useMySettings');
    for (const [constant, key] of SIGNATORIES) {
      expect(hook, key).toContain(`FleetSettingKeys.${constant}`);
    }
  });

  it('is what BOTH halves print with — neither panel builds its own', () => {
    for (const panel of ['components/CompanyViolationsPanel.tsx', 'components/DriverViolationsPanel.tsx']) {
      const source = read(panel);
      expect(source, `${panel} reads the settings`).toContain('useReportSignatories()');
      expect(source, `${panel} prints the company form`).toContain('printFleetReport({');
      expect(source, `${panel} passes them on`).toContain('signatories,');
    }
  });

  it('leaves the old plain-table print and the CSV behind entirely', () => {
    // They were the thing being replaced: a bare table with no letterhead and no signature, and a
    // CSV the button called «Excel». A file still importing either is a half-migrated screen.
    for (const panel of ['components/CompanyViolationsPanel.tsx', 'components/DriverViolationsPanel.tsx']) {
      const source = read(panel);
      expect(source, panel).not.toContain('violations-print');
      expect(source, panel).not.toContain('violations-export');
      expect(source, `${panel} writes a workbook`).toContain('buildXlsx({');
    }
  });
});
