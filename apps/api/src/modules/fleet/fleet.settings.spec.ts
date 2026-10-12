// The Fleet settings as the registry holds them — here, «مبلغ العهدة»: «عاوز ازود اجمالى العهده فى
// الاحصايات و تكون فى الداس بورد». Declared like every other «إعدادات الحركة» value: the
// organization's alone, a plain number the settings screens can edit, 0 until it is set.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FleetSettingKeys } from '@ecms/contracts';
import {
  clearSettingRegistry,
  getSettingDeclaration,
} from '../../platform/settings/settings.registry';
import { settingsService } from '../../platform/settings/settings.service';
import { registerFleetSettings } from './fleet.settings';

beforeEach(() => {
  clearSettingRegistry();
  registerFleetSettings();
});
afterEach(() => {
  clearSettingRegistry();
});

describe('«مبلغ العهدة» — the custody fund', () => {
  it('is declared for the organization only, 0 («not set») by default', () => {
    const declaration = getSettingDeclaration(FleetSettingKeys.CustodyFundTotal);
    expect(declaration).toBeDefined();
    expect(declaration?.defaultValue).toBe(0);
    expect(declaration?.allowedScopes).toEqual(['organization']);
    expect(declaration?.description.trim()).not.toBe('');
  });

  it('takes an amount to the piastre, never below zero, and refuses a third decimal', () => {
    const schema = getSettingDeclaration(FleetSettingKeys.CustodyFundTotal)?.schema;
    for (const ok of [0, 0.5, 250_000, 250_000.75]) {
      expect(schema?.safeParse(ok).success, String(ok)).toBe(true);
    }
    for (const bad of [-1, 1.005, '250000', true, null]) {
      expect(schema?.safeParse(bad).success, String(bad)).toBe(false);
    }
    // A sliver JavaScript writes in exponent form («1e-7») has no decimals for `multipleOf` to
    // count — refused all the same, whichever screen typed it.
    for (const bad of [1e-7, 5e-7, 1e-10, Number.MIN_VALUE]) {
      expect(schema?.safeParse(bad).success, String(bad)).toBe(false);
    }
  });

  it('reaches the settings screens as a number, so it stays editable there', () => {
    const definition = settingsService
      .listDefinitions()
      .find((d) => d.key === FleetSettingKeys.CustodyFundTotal);
    expect(definition).toMatchObject({ type: 'number', defaultValue: 0 });
  });
});
