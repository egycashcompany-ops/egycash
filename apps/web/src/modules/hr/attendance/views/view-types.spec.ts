// The views' sort vocabulary against the server's.
//
// `view-types.ts` imports nothing on purpose — it is the shape the components draw and the page
// fills — so the one value in it that travels to the server needs a pin rather than a type.
import { describe, expect, it } from 'vitest';
import { ATTENDANCE_SHEET_SORTS } from '@ecms/contracts';
import type { SheetSortKey } from './view-types';

describe('the sheet sort keys', () => {
  it('are exactly the ones the server accepts', () => {
    // Assigning each contract value to the view type is the half TypeScript can check; the runtime
    // assertion is the half it cannot — a key the view offers that the server would reject comes
    // back as a 400 on a click, which no type catches.
    const mirrored: readonly SheetSortKey[] = [
      'checkIn',
      'checkOut',
      'worked',
      'late',
      'shortfall',
      'name',
      'code',
      'status',
    ];
    expect([...mirrored].sort()).toEqual([...ATTENDANCE_SHEET_SORTS].sort());
  });
});
