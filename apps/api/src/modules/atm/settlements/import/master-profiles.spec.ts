// The bank import profiles (docs/12-planning/atm-settlements-phase1.md §5.2): Al Baraka only in
// phase 1 (S-10), every other bank refused rather than read with Al Baraka's layout.
import { describe, expect, it } from 'vitest';
import { ATM_BANK_CODES, ErrorCodes } from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';
import { ATM_MASTER_PROFILES, columnNumber, headerKey, masterProfileOf } from './master-profiles';

describe('masterProfileOf', () => {
  it('answers the Al Baraka profile', () => {
    expect(masterProfileOf('BRK')).toBe(ATM_MASTER_PROFILES.BRK);
    expect(masterProfileOf('BRK').standardLoads.counts).toEqual({ E: 200, F: 100, G: 50 });
  });

  it('refuses every bank without a profile with 422 ATM_LAYOUT_IMPORT_UNSUPPORTED_BANK', () => {
    for (const bank of ATM_BANK_CODES.filter((code) => code !== 'BRK')) {
      let thrown: unknown;
      try {
        masterProfileOf(bank);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).code).toBe(ErrorCodes.ATM_LAYOUT_IMPORT_UNSUPPORTED_BANK);
      expect((thrown as AppError).httpStatus).toBe(422);
    }
  });
});

describe('header and column helpers', () => {
  it('binds headers trimmed with inner spaces collapsed', () => {
    expect(headerKey('  Total  cash\nfill ')).toBe('Total cash fill');
  });

  it('turns letters into 1-based column numbers', () => {
    expect(['A', 'B', 'E', 'K', 'Z', 'AA', 'AW'].map(columnNumber)).toEqual([
      1, 2, 5, 11, 26, 27, 49,
    ]);
  });
});
