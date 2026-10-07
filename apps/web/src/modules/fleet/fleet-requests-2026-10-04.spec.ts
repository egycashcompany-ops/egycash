// The owner's batch of 2026-10-04, pinned where it lives in the source:
//   • the reading form swaps its two drivers with one press;
//   • a dealership bill starts with «لا يوجد» for the insurer, and «ملاكي» sits on the car code's
//     own label line;
//   • the vehicle form refuses a م↔ت class change on the old expiry date, and flips the letter
//     itself when only the date moved.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { translate } from '../../platform/localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');

describe('the reading form — «زرار ابدل بين اتنين سواقيين»', () => {
  it('one press puts the morning driver in the evening slot and back', () => {
    const source = read('components/RecordOdometerDialog.tsx');
    expect(source).toContain('data-odometer-swap-drivers="true"');
    expect(source).toContain('setDriver1(driver2);');
    expect(source).toContain('setDriver2(driver1);');
    expect(translate('ar', 'fleet.odometer.swapDrivers')).toBe('تبديل السائقين');
  });
});

describe('the dealership bill', () => {
  const source = read('components/DealershipInvoiceDialog.tsx');

  it('starts with «لا يوجد», which is the absence of an insurer, not a company of that name', () => {
    expect(source).toContain('setInsurer(row.insuranceCompanyName ?? noInsurer);');
    expect(source).toContain("const typedInsurer = typedRaw === noInsurer ? '' : typedRaw;");
    expect(source).toContain('<option value={noInsurer} />');
    expect(translate('ar', 'fleet.dealership.noInsurer')).toBe('لا يوجد');
    expect(read('pages/DealershipPage.tsx')).toContain(
      "row.insuranceCompanyName ?? t('fleet.dealership.noInsurer')",
    );
  });

  it('«ملاكي» is a switch on the car code’s label line, not a field of its own', () => {
    const label = source.indexOf("label={t('fleet.odometer.columns.vehicle')}");
    const tick = source.indexOf('data-dealership-private="true"');
    expect(label).toBeGreaterThan(-1);
    expect(tick, 'on the car tile').toBeGreaterThan(label);
    // The tile draws its `aside` on the label line, above the code itself.
    const fact = source.slice(source.indexOf('const Fact = ('), source.indexOf('export const'));
    expect(fact.indexOf('{aside}'), 'beside the label').toBeGreaterThan(fact.indexOf('{label}'));
    expect(fact.indexOf('{aside}'), 'above the value').toBeLessThan(fact.indexOf('{value}'));
    expect(source).not.toContain("label={t('fleet.dealership.privateCar')}\n              hint=");
  });
});

describe('the vehicle form — the licence letter moves with its date', () => {
  const source = read('components/VehicleFormDialog.tsx');

  it('refuses a م↔ت class change on the old expiry date', () => {
    expect(source).toContain("ok: form.licenseExpiresAt !== '' && !classFlippedOnOldDate");
    expect(source).toContain("t('fleet.vehicles.licenseClassNeedsDate')");
  });

  it('flips the letter itself when only the date moved, and leaves a hand-picked class alone', () => {
    expect(source).toContain('onChange={(e) => pickExpiry(e.target.value)}');
    expect(source).toContain('onChange={pickClass}');
    expect(source).toContain('if (vehicle === null || classTouched)');
    expect(source).toContain('counterpartClass(classItems, initialClassId)');
  });

  it('the server refuses the same half-renewal', () => {
    const service = readFileSync(
      join(HERE, '../../../../api/src/modules/fleet/vehicles/vehicle.service.ts'),
      'utf8',
    );
    expect(service).toContain(
      'if (asPerson) await this.assertLicenseLetterMovesWithDate(before, input);',
    );
    const controller = readFileSync(
      join(HERE, '../../../../api/src/modules/fleet/vehicles/vehicle.controller.ts'),
      'utf8',
    );
    expect(controller, 'the screen’s edit is a person’s').toContain('{ asPerson: true }');
    expect(service).toContain('fleetLicenseLetter(');
  });
});
