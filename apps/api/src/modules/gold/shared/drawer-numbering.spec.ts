// The gold system's own numbering tests (`backend/src/utils/drawerNumbering.test.js`), carried
// across as a vitest spec. The reference grid is 3 rows × 4 cols and the assertions are the full
// position→number map, so a change to the engine cannot pass unnoticed.
import { describe, expect, it } from 'vitest';
import { generateDrawers, toPositionMap } from './drawer-numbering';

const rows = 3;
const cols = 4;

describe('gold drawer numbering', () => {
  it('horizontal / ltr / ttb — standard reading order', () => {
    expect(
      toPositionMap(
        generateDrawers({
          rows,
          cols,
          orientation: 'horizontal',
          horizontalDirection: 'ltr',
          verticalDirection: 'ttb',
        }),
      ),
    ).toEqual({
      '0,0': 1,
      '0,1': 2,
      '0,2': 3,
      '0,3': 4,
      '1,0': 5,
      '1,1': 6,
      '1,2': 7,
      '1,3': 8,
      '2,0': 9,
      '2,1': 10,
      '2,2': 11,
      '2,3': 12,
    });
  });

  it('horizontal / rtl / ttb — Arabic reading order, top row first', () => {
    expect(
      toPositionMap(
        generateDrawers({
          rows,
          cols,
          orientation: 'horizontal',
          horizontalDirection: 'rtl',
          verticalDirection: 'ttb',
        }),
      ),
    ).toEqual({
      '0,3': 1,
      '0,2': 2,
      '0,1': 3,
      '0,0': 4,
      '1,3': 5,
      '1,2': 6,
      '1,1': 7,
      '1,0': 8,
      '2,3': 9,
      '2,2': 10,
      '2,1': 11,
      '2,0': 12,
    });
  });

  it('horizontal / ltr / btt — bottom row numbered first', () => {
    expect(
      toPositionMap(
        generateDrawers({
          rows,
          cols,
          orientation: 'horizontal',
          horizontalDirection: 'ltr',
          verticalDirection: 'btt',
        }),
      ),
    ).toEqual({
      '2,0': 1,
      '2,1': 2,
      '2,2': 3,
      '2,3': 4,
      '1,0': 5,
      '1,1': 6,
      '1,2': 7,
      '1,3': 8,
      '0,0': 9,
      '0,1': 10,
      '0,2': 11,
      '0,3': 12,
    });
  });

  it('vertical / ltr / ttb — down each column, columns left→right', () => {
    expect(
      toPositionMap(
        generateDrawers({
          rows,
          cols,
          orientation: 'vertical',
          horizontalDirection: 'ltr',
          verticalDirection: 'ttb',
        }),
      ),
    ).toEqual({
      '0,0': 1,
      '1,0': 2,
      '2,0': 3,
      '0,1': 4,
      '1,1': 5,
      '2,1': 6,
      '0,2': 7,
      '1,2': 8,
      '2,2': 9,
      '0,3': 10,
      '1,3': 11,
      '2,3': 12,
    });
  });

  it('vertical / rtl / btt — up each column, columns right→left', () => {
    expect(
      toPositionMap(
        generateDrawers({
          rows,
          cols,
          orientation: 'vertical',
          horizontalDirection: 'rtl',
          verticalDirection: 'btt',
        }),
      ),
    ).toEqual({
      '2,3': 1,
      '1,3': 2,
      '0,3': 3,
      '2,2': 4,
      '1,2': 5,
      '0,2': 6,
      '2,1': 7,
      '1,1': 8,
      '0,1': 9,
      '2,0': 10,
      '1,0': 11,
      '0,0': 12,
    });
  });

  it('produces rows*cols drawers numbered 1..N without gaps or repeats', () => {
    const big = generateDrawers({
      rows: 5,
      cols: 7,
      orientation: 'vertical',
      horizontalDirection: 'rtl',
      verticalDirection: 'btt',
    });
    expect(big).toHaveLength(35);
    expect([...new Set(big.map((d) => d.number))].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 35 }, (_, i) => i + 1),
    );
  });

  it('honours a non-default start number', () => {
    const plan = generateDrawers({ rows: 2, cols: 2, startNumber: 101 });
    expect(plan.map((d) => d.number)).toEqual([101, 102, 103, 104]);
  });

  it('refuses a degenerate grid rather than producing an empty vault', () => {
    expect(() => generateDrawers({ rows: 0, cols: 3 })).toThrow();
  });
});
