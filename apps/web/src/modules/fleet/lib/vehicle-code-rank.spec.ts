import { describe, expect, it } from 'vitest';
import { rankVehicleCodes } from './vehicle-code-rank';

const CODES = ['101', '121', '150', '210', '215', '219', '221', '321', 'تويوتا1'];

describe('rankVehicleCodes — «اكتب الكود»', () => {
  it('offers every car when nothing is typed', () => {
    expect(rankVehicleCodes(CODES, '')).toEqual(CODES);
    expect(rankVehicleCodes(CODES, '   ')).toEqual(CODES);
  });

  it('puts the codes that START with what was typed first, then the ones that contain it', () => {
    expect(rankVehicleCodes(CODES, '21')).toEqual(['210', '215', '219', '121', '221', '321']);
  });

  it('finds an exact code', () => {
    expect(rankVehicleCodes(CODES, '215')).toEqual(['215']);
  });

  it('finds an old-book code by its letters', () => {
    expect(rankVehicleCodes(CODES, 'تويوتا')).toEqual(['تويوتا1']);
  });

  it('offers nothing for a fragment no car carries', () => {
    expect(rankVehicleCodes(CODES, '999')).toEqual([]);
  });
});
