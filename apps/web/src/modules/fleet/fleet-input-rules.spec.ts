// What each Fleet box may hold — «اى مكان هكتب بس رقم يبقى مينفعش غير رقم هكتب بس عربى يبقى عربي
// مينفعش انجليزي واى مكان انجليزي يبقى انجليزي مينفعش يبقى عربى».
//
// The approved table, pinned per file: how many boxes of each kind every Fleet screen carries, and
// how many amounts go through `MoneyInput`. A box that loses its rule, a new box that never got
// one and a screen that is not in the table all fail here. The rules themselves are tested in
// `shared/lib/input-rules.spec.ts`; this file only says WHERE they apply.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../');

/** Comments explain the rule; they must not be able to satisfy it. */
const code = (rel: string): string =>
  readFileSync(join(SRC, rel), 'utf8')
    .split('\n')
    .filter((line) => {
      const t = line.trimStart();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');

/** The Fleet screens (not specs) whose source matches `pattern`; grep's «no match» is an answer. */
const grep = (pattern: string): string[] => {
  const run = spawnSync('grep', ['-rlE', pattern, 'modules/fleet'], { cwd: SRC, encoding: 'utf8' });
  if (run.status !== 0 && run.status !== 1) throw new Error(run.stderr);
  return run.stdout.split('\n').filter((file) => file.endsWith('.tsx') && !file.includes('.spec.'));
};

type Kind = 'integer' | 'decimal' | 'digits' | 'phone' | 'arabic' | 'english' | 'plate' | 'money';

/** A file's boxes, by kind. */
const census = (rel: string): Partial<Record<Kind, number>> => {
  const source = code(rel);
  const found: Partial<Record<Kind, number>> = {};
  for (const match of source.matchAll(/\brule(?:="|: ')([a-z]+)["']/gu)) {
    const kind = match[1] as Kind;
    found[kind] = (found[kind] ?? 0) + 1;
  }
  const money = source.match(/<MoneyInput\b/gu)?.length ?? 0;
  if (money > 0) found.money = money;
  return found;
};

const TABLE: Record<string, Partial<Record<Kind, number>>> = {
  // Accident costs: company cost, collected, paid.
  'modules/fleet/components/AccidentFormDialog.tsx': { money: 3 },
  // Catalog and vehicle-type names: Arabic and English halves; the type's service interval.
  'modules/fleet/components/CatalogDialogs.tsx': { arabic: 2, english: 2, integer: 1 },
  // The company line: unit value × count.
  'modules/fleet/components/CompanyViolationsPanel.tsx': { money: 1, integer: 1 },
  // A reading's out and in.
  'modules/fleet/components/CorrectOdometerDialog.tsx': { integer: 2 },
  'modules/fleet/components/DealershipInvoiceDialog.tsx': { money: 1 },
  'modules/fleet/components/DriverFormDialog.tsx': { phone: 1 },
  // The per-type counters, each fine's amount, and the amount filter.
  'modules/fleet/components/DriverViolationsPanel.tsx': { integer: 1, money: 1, decimal: 1 },
  // The card number, read in its groups of digits.
  'modules/fleet/components/FuelCardDialog.tsx': { digits: 1 },
  'modules/fleet/components/FuelCardHistoryDialog.tsx': { money: 1 },
  'modules/fleet/components/FuelTransferDialog.tsx': { money: 1 },
  // The odometer on check-in, on check-out and on edit.
  'modules/fleet/components/MaintenanceDialogs.tsx': { integer: 3 },
  // The driver's name, and the receipt's amount.
  'modules/fleet/components/ReceiptDialog.tsx': { arabic: 1, money: 1 },
  'modules/fleet/components/RecordOdometerDialog.tsx': { integer: 1 },
  // The reason.
  'modules/fleet/components/UnavailabilityDialog.tsx': { arabic: 1 },
  // Plate; chassis, motor and Motorola SN; ISSI.
  'modules/fleet/components/VehicleFormDialog.tsx': { plate: 1, english: 3, integer: 1 },
  // Year and count; unit value and the grievance total.
  'modules/fleet/components/ViolationDialogs.tsx': { integer: 2, money: 3 },
  // The driver filter.
  'modules/fleet/pages/CustodyPage.tsx': { arabic: 1 },
  // Governorate; phone. (The address left the bar with its column.)
  'modules/fleet/pages/DriversListPage.tsx': { arabic: 1, phone: 1 },
  // The numbers, the fuel prices and balances, and the signatories' names and titles.
  'modules/fleet/pages/FleetSettingsPage.tsx': { integer: 1, money: 1, arabic: 1 },
  'modules/fleet/pages/FuelCardsPage.tsx': { digits: 1 },
  'modules/fleet/pages/FuelChargingPage.tsx': { money: 1 },
  // Each item's counter and each card's count; each card's amount.
  'modules/fleet/pages/LicenseExpenseEditorPage.tsx': { integer: 2, money: 1 },
  // Plate and chassis filters.
  'modules/fleet/pages/LicensingPage.tsx': { plate: 1, english: 1 },
  // The form's mobiles, phones and national ids.
  'modules/fleet/pages/NoticeEditorPage.tsx': { phone: 1 },
  'modules/fleet/pages/ReceiptsPage.tsx': { arabic: 1 },
  // Plate; chassis and motor filters.
  'modules/fleet/pages/VehiclesListPage.tsx': { plate: 1, english: 2 },
};

describe('every Fleet box keeps the rule it was given', () => {
  it.each(Object.entries(TABLE).map(([file, kinds]) => ({ file, kinds })))(
    '$file',
    ({ file, kinds }) => {
      expect(census(file)).toEqual(kinds);
    },
  );

  it('the table covers every Fleet screen that has a ruled box or an amount', () => {
    const files = grep(`rule=|rule: '|<MoneyInput`)
      .filter((file) => Object.keys(census(file)).length > 0)
      .sort();
    expect(files).toEqual(Object.keys(TABLE).sort());
  });

  it('no Fleet box is a bare number input — it would empty itself on a letter, not refuse it', () => {
    expect(grep('type="number"')).toEqual([]);
  });
});
