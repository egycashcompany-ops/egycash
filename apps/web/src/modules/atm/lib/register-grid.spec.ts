// The register grid's geometry (spec §8.3): the owner's column order, the group header row, the
// frozen panes and the widths — pinned as data, because a grid that put AV after AU or froze the
// panes one column short would still render and would still look like a spreadsheet.
import { describe, expect, it } from 'vitest';
import { ATM_REGISTER_COLUMNS, type AtmRegisterEntryDto } from '@ecms/contracts';
import {
  REGISTER_FROZEN_FIELDS,
  REGISTER_FROZEN_WIDTH,
  REGISTER_GRID_COLUMNS,
  REGISTER_MIN_SCROLL_WINDOW,
  isRegisterHttpUrl,
  nextRegisterSort,
  parseRegisterPageSize,
  parseRegisterSort,
  registerActionSlots,
  registerActionsWidth,
  registerColumnWidth,
  registerWidthOf,
  REGISTER_BRANCH_MIN_WIDTH,
  registerFieldText,
  registerFrozenOffsets,
  registerGroupSpans,
  registerHeaderTitle,
  registerPanesFreeze,
} from './register-grid';

const letters = (from: string, to: string): string[] => {
  const all = ATM_REGISTER_COLUMNS.map((c) => c.excel);
  return all.slice(all.indexOf(from), all.indexOf(to) + 1);
};

describe('the column order', () => {
  it('is the owner’s layout: A..AO, then AP and AV together, then AQ..AU, then AW', () => {
    expect(REGISTER_GRID_COLUMNS.map((c) => c.excel)).toEqual([
      ...letters('A', 'AO'),
      'AP',
      'AV',
      ...letters('AQ', 'AU'),
      'AW',
    ]);
  });

  it('shows every one of the 49 columns exactly once', () => {
    expect(REGISTER_GRID_COLUMNS).toHaveLength(49);
    expect(new Set(REGISTER_GRID_COLUMNS.map((c) => c.excel)).size).toBe(49);
  });
});

describe('the group header row', () => {
  it('has one cell per group, each a contiguous run of the §8.3 width', () => {
    expect(registerGroupSpans().map(({ group, span, first }) => [group, span, first])).toEqual([
      ['identity', 9, 'A'], // A..I
      ['keys', 8, 'J'], // J..Q
      ['cassettes', 19, 'R'], // R..AJ
      ['hours', 4, 'AK'], // AK..AN
      ['secret', 1, 'AO'],
      ['location', 2, 'AP'], // AP, AV
      ['lifecycle', 5, 'AQ'], // AQ..AU
      ['hub', 1, 'AW'],
    ]);
  });

  it('covers the whole row', () => {
    expect(registerGroupSpans().reduce((sum, s) => sum + s.span, 0)).toBe(49);
  });
});

describe('the widths', () => {
  it('turns the sheet’s character widths into pixels, never under 72', () => {
    expect(registerColumnWidth(42.57)).toBe(303); // Name
    expect(registerColumnWidth(11.71)).toBe(87); // Branch
    expect(registerColumnWidth(16.57)).toBe(121); // Area
    expect(registerColumnWidth(9.14)).toBe(72); // 69 → the floor
    expect(registerColumnWidth(0)).toBe(72);
  });

  // Review finding LIVE-3: 87 px left 70 px for text, and «EGYCASH-4» measures 70.3 px at 12 px.
  it('gives the Branch column room for its nine-character codes', () => {
    const branch = ATM_REGISTER_COLUMNS.find((c) => c.field === 'branchCode');
    expect(branch === undefined ? 0 : registerWidthOf(branch)).toBe(REGISTER_BRANCH_MIN_WIDTH);
    expect(REGISTER_BRANCH_MIN_WIDTH - 16 - 1).toBeGreaterThanOrEqual(76);
    const name = ATM_REGISTER_COLUMNS.find((c) => c.field === 'name');
    expect(name === undefined ? 0 : registerWidthOf(name), 'the others follow the sheet').toBe(303);
  });
});

describe('the frozen panes', () => {
  it('are Branch, Area, Bank, ATM ID and Name — the first five columns', () => {
    expect(REGISTER_FROZEN_FIELDS).toEqual(REGISTER_GRID_COLUMNS.slice(0, 5).map((c) => c.field));
  });

  it('stick at 0, w(A), w(A)+w(B), … from the inline start', () => {
    const offsets = registerFrozenOffsets();
    const w = (letter: string): number => {
      const column = ATM_REGISTER_COLUMNS.find((c) => c.excel === letter);
      return column === undefined ? 0 : registerWidthOf(column);
    };
    expect([...offsets.entries()]).toEqual([
      ['branchCode', 0],
      ['area', w('A')],
      ['bankCode', w('A') + w('B')],
      ['machineCode', w('A') + w('B') + w('C')],
      ['name', w('A') + w('B') + w('C') + w('D')],
    ]);
    expect([...offsets.values()]).toEqual([0, 96, 217, 289, 386]);
    expect(REGISTER_FROZEN_WIDTH).toBe(689);
  });

  it('freeze only on a board that still leaves a window onto the other columns', () => {
    expect(registerPanesFreeze(null, 160), 'not measured yet').toBe(true);
    expect(registerPanesFreeze(689 + 160 + REGISTER_MIN_SCROLL_WINDOW, 160)).toBe(true);
    expect(registerPanesFreeze(689 + 160 + REGISTER_MIN_SCROLL_WINDOW - 1, 160)).toBe(false);
    // 1024 px with the sidebar open leaves a 718 px board: the panes alone would fill it.
    expect(registerPanesFreeze(718, 160)).toBe(false);
  });
});

describe('the headers', () => {
  it('carry the sheet’s exact header as their tooltip, line breaks read as spaces', () => {
    const ao = ATM_REGISTER_COLUMNS.find((c) => c.excel === 'AO');
    expect(ao === undefined ? '' : registerHeaderTitle(ao)).toBe('Combination Safe Door  P.W');
    const r = ATM_REGISTER_COLUMNS.find((c) => c.excel === 'R');
    expect(r === undefined ? '' : registerHeaderTitle(r)).toBe('Withdrawall Cassettes ');
  });
});

describe('the sort', () => {
  it('reads field:dir, and reads anything the server would not sort by as the sheet’s order', () => {
    expect(parseRegisterSort('machineCode:desc')).toEqual({ by: 'machineCode', dir: 'desc' });
    expect(parseRegisterSort('startDate')).toEqual({ by: 'startDate', dir: 'asc' });
    expect(parseRegisterSort('keys.supervisorCode:asc')).toBeNull();
    expect(parseRegisterSort(null)).toBeNull();
  });

  it('turns ascending, then descending, then back to the sheet’s order', () => {
    expect(nextRegisterSort(null, 'name')).toBe('name:asc');
    expect(nextRegisterSort({ by: 'name', dir: 'asc' }, 'name')).toBe('name:desc');
    expect(nextRegisterSort({ by: 'name', dir: 'desc' }, 'name')).toBeNull();
    expect(nextRegisterSort({ by: 'name', dir: 'desc' }, 'area')).toBe('area:asc');
  });

  it('offers 25, 50 and 100 rows a page, 25 by default', () => {
    expect(parseRegisterPageSize('50')).toBe(50);
    expect(parseRegisterPageSize('100')).toBe(100);
    expect(parseRegisterPageSize('500')).toBe(25);
    expect(parseRegisterPageSize(null)).toBe(25);
  });
});

describe('the cells', () => {
  const entry = {
    name: 'Synthetic branch ATM',
    keys: null,
    cassettes: { withdrawal1: '4' },
    startDate: '2026-01-12',
    safeCombinationSet: true,
  } as unknown as AtmRegisterEntryDto;

  it('reads a field by its dotted path', () => {
    expect(registerFieldText(entry, 'name')).toBe('Synthetic branch ATM');
    expect(registerFieldText(entry, 'cassettes.withdrawal1')).toBe('4');
    expect(registerFieldText(entry, 'startDate')).toBe('2026-01-12');
  });

  it('reads nothing for a hidden key and nothing, ever, for the combination', () => {
    expect(registerFieldText(entry, 'keys.supervisorCode')).toBeNull();
    expect(registerFieldText(entry, 'safeCombination')).toBeNull();
  });

  it('links a location only when it is plainly a web address', () => {
    expect(isRegisterHttpUrl('https://maps.example/x')).toBe(true);
    expect(isRegisterHttpUrl('http://maps.example/x')).toBe(true);
    expect(isRegisterHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isRegisterHttpUrl('8Q9X+2C Cairo')).toBe(false);
  });
});

describe('the actions column', () => {
  it('is as wide as the most actions one row can show this reader', () => {
    const all = { edit: true, create: true, handover: true, viewSecrets: true, delete: true };
    // Edit, Hand over, Link, Reveal, Delete — an open, unlinked row.
    expect(registerActionSlots(all)).toBe(5);
    expect(registerActionSlots({ ...all, handover: false, edit: false })).toBe(3);
    expect(
      registerActionSlots({
        edit: false,
        create: false,
        handover: false,
        viewSecrets: false,
        delete: false,
      }),
    ).toBe(0);
    expect(registerActionsWidth(0)).toBe(0);
    expect(registerActionsWidth(5)).toBe(5 * 28 + 4 * 2 + 16);
  });
});
