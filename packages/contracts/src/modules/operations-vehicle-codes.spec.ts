// Round 32 — «دى مشكلة بيظهر عربيات ايه الاصفار دى»: which Fleet codes name a car, and the order the
// two van pickers («لوحة التشغيلة»'s «بدون سيارة», «الطاقم الثابت»'s «إضافة سيارة») list codes in.
import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '../errors/index.js';
import { OPERATIONS_CREW_FREE_VEHICLE_GROUPS } from './operations.js';
import {
  compareVehicleCodesNaturally,
  compareVehiclesForPicker,
  vehicleCodeNamesNothing,
} from './operations-vehicle-codes.js';

describe('vehicleCodeNamesNothing — a code (or a plate) that names no car', () => {
  it.each([
    '0',
    '00',
    '000',
    '0000',
    '00000',
    ' 0 ',
    '٠',
    '٠٠٠',
    '۰۰',
    '0-0',
    '0 0',
    '-',
    '—',
    '',
    '   ',
    '​',
  ])('«%s» names nothing', (code) => expect(vehicleCodeNamesNothing(code)).toBe(true));

  it('neither does no code at all', () => {
    expect(vehicleCodeNamesNothing(null)).toBe(true);
    expect(vehicleCodeNamesNothing(undefined)).toBe(true);
  });

  it.each(['61', '150', '0061', '10', '100', 'P0', 'MG 1', 'ملاكى 0', 'كوستر 2', '٦١', 'س ص 150'])(
    '«%s» names a car — a digit or a letter besides its zeros',
    (code) => expect(vehicleCodeNamesNothing(code)).toBe(false),
  );
});

describe('compareVehicleCodesNaturally — the pickers’ order', () => {
  const sorted = (codes: readonly string[]): string[] =>
    [...codes].sort(compareVehicleCodesNaturally);

  it('orders numbers by their value, not as text: 61, 101, 150, 213 — never «101» before «61»', () => {
    expect(sorted(['213', '150', '61', '101', '9', '1000'])).toEqual([
      '9',
      '61',
      '101',
      '150',
      '213',
      '1000',
    ]);
  });

  it('a number inside a word too: «MG 2» before «MG 10»', () => {
    expect(sorted(['MG 10', 'MG 2', 'MG 1'])).toEqual(['MG 1', 'MG 2', 'MG 10']);
  });

  it('puts every code that names nothing AFTER every one that does — the owner’s screenshots, reordered', () => {
    // «لوحة التشغيلة» listed «00000», «0000», «000», «00», «0», then «61»; «الطاقم الثابت» «0» … «00000».
    const board = sorted(['00000', '0000', '000', '00', '0', '61', '150', '101']);
    expect(board.slice(0, 3)).toEqual(['61', '101', '150']);
    expect(board.slice(3).every((code) => vehicleCodeNamesNothing(code))).toBe(true);
    const standing = sorted(['0', '00', '000', '0000', '00000', '213', '61']);
    expect(standing.slice(0, 2)).toEqual(['61', '213']);
  });

  it('is the same order however the list arrived (ties broken by the text)', () => {
    const a = sorted(['0', '00', '000', '61', '٠']);
    const b = sorted(['٠', '000', '61', '00', '0']);
    expect(a).toEqual(b);
  });
});

describe('compareVehiclesForPicker — the uncoded by their PLATE (Round 32 critic)', () => {
  const sorted = (
    cars: readonly { vehicleCode: string; plateNumber?: string | null }[],
  ): string[] => [...cars].sort(compareVehiclesForPicker).map((car) => car.vehicleCode);

  it('orders two cars whose codes name nothing by their plate — not by their count of zeros', () => {
    // «0» is «ن ق ل 4521» and «00» is «ب ط 118»: by plate «ب» comes before «ن».
    expect(
      sorted([
        { vehicleCode: '0', plateNumber: 'ن ق ل 4521' },
        { vehicleCode: '00', plateNumber: 'ب ط 118' },
      ]),
    ).toEqual(['00', '0']);
    expect(
      sorted([
        { vehicleCode: '00', plateNumber: 'ب ط 118' },
        { vehicleCode: '0', plateNumber: 'ن ق ل 4521' },
      ]),
    ).toEqual(['00', '0']);
  });

  it('a plate’s numbers in number order, and the codes break a tie of plates', () => {
    expect(
      sorted([
        { vehicleCode: '000', plateNumber: 'ر ع 1200' },
        { vehicleCode: '0', plateNumber: 'ر ع 999' },
        { vehicleCode: '00', plateNumber: 'ر ع 999' },
      ]),
    ).toEqual(['0', '00', '000']);
  });

  it('coded cars by code naturally, before every uncoded one — whatever their plates', () => {
    expect(
      sorted([
        { vehicleCode: '0', plateNumber: 'أ 1' },
        { vehicleCode: '150', plateNumber: 'ي 9' },
        { vehicleCode: '61', plateNumber: 'ي 8' },
      ]),
    ).toEqual(['61', '150', '0']);
  });
});

describe('the wire', () => {
  it('lists the uncoded group LAST among the board’s free-vehicle groups', () => {
    expect(OPERATIONS_CREW_FREE_VEHICLE_GROUPS.at(-1)).toBe('uncoded');
    expect(OPERATIONS_CREW_FREE_VEHICLE_GROUPS.slice(0, 4)).toEqual([
      'roster',
      'cashTransfer',
      'standing',
      'other',
    ]);
  });

  it('names the crew board’s past-day refusal', () => {
    expect(ErrorCodes.OPERATIONS_CREW_DAY_IN_PAST).toBe('OPERATIONS_CREW_DAY_IN_PAST');
  });
});
