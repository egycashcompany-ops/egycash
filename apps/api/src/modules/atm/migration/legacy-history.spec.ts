// The legacy history import's rules (docs/12-planning/atm-legacy-history-import.md §4): which row
// is imported, why the others are not, the time mode, the machine, the suggested cutover.
//
// Every id, code and name below is synthetic.
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  chooseLegacyTimeMode,
  classifyLegacyRow,
  legacyTimeModeClear,
  legacyMachineIndex,
  resolveLegacyMachine,
  suggestLegacyCutoverAt,
  type LegacyRowRules,
} from './legacy-history';
import { type LegacyOperation } from './legacy-transform';

const LIVE = new Types.ObjectId('64b7f9c2e13b4a0012345601');
const GONE_OLD = new Types.ObjectId('64b7f9c2e13b4a0012345602');
const GONE_NEW = new Types.ObjectId('64b7f9c2e13b4a0012345603');
const SPACED = new Types.ObjectId('64b7f9c2e13b4a0012345604');
const LIVE_OF_GONE = new Types.ObjectId('64b7f9c2e13b4a0012345605');

const index = legacyMachineIndex([
  { _id: LIVE, machineCode: '9001', isDeleted: false },
  // Deleted in ECMS twice under one code: the one changed last answers for it.
  { _id: GONE_OLD, machineCode: '9003-D', isDeleted: true, updatedAt: new Date('2026-09-01') },
  { _id: GONE_NEW, machineCode: '9003-D', isDeleted: true, updatedAt: new Date('2026-10-01') },
  { _id: SPACED, machineCode: 'HDB-ATM 9501', isDeleted: false },
  // A code deleted once and registered again: the live machine keeps it.
  { _id: new Types.ObjectId(), machineCode: '9004-D', isDeleted: true },
  { _id: LIVE_OF_GONE, machineCode: '9004', isDeleted: false },
]);

const rules = (over: Partial<LegacyRowRules> = {}): LegacyRowRules => ({
  cutoverAt: null,
  resolve: (raw) => resolveLegacyMachine(index, raw),
  ...over,
});

const row = (over: Partial<LegacyOperation> = {}): LegacyOperation => ({
  _id: new Types.ObjectId(),
  mach_id: '9001',
  open_time: new Date('2026-11-05T06:00:00.000Z'),
  close_time: new Date('2026-11-05T07:00:00.000Z'),
  end: 1,
  deleted: 0,
  ...over,
});

/** Shorouk moved on 2026-11-05: its first ECMS row was written at 11:00 Cairo (09:00Z). */
const SWITCH = new Date('2026-11-05T09:00:00.000Z');

describe('which legacy row is imported — the first rule it fails, in order', () => {
  it('imports a closed, live row of a known machine closed before the switch', () => {
    expect(classifyLegacyRow(row(), rules({ cutoverAt: SWITCH }))).toEqual({
      verdict: 'import',
      machineId: LIVE,
    });
  });

  it('a deleted row is counted as deleted whatever else is wrong with it', () => {
    expect(classifyLegacyRow(row({ deleted: 1, open_time: null, mach_id: '' }), rules())).toEqual({
      verdict: 'deleted',
    });
  });

  it('a row with no open time has no lifecycle — skipped, never invented', () => {
    expect(classifyLegacyRow(row({ open_time: '' }), rules()).verdict).toBe('noOpenTime');
  });

  it('only a «Done» row is copied: closed (end 1) with a close time — never an open one', () => {
    expect(classifyLegacyRow(row({ close_time: null, end: 0 }), rules()).verdict).toBe('open');
    // A row only one of the two signals calls closed stays out rather than being guessed at.
    expect(classifyLegacyRow(row({ close_time: null, end: 1 }), rules()).verdict).toBe('open');
    expect(classifyLegacyRow(row({ end: 0 }), rules()).verdict).toBe('open');
    expect(classifyLegacyRow(row({ end: undefined }), rules()).verdict).toBe('open');
    expect(classifyLegacyRow(row({ end: '1' }), rules()).verdict).toBe('import');
  });

  it('a closed row is the branch’s own when it closed at or after the switch — whenever it opened', () => {
    const closedAfter = row({ close_time: new Date('2026-11-05T09:00:00.000Z') });
    expect(classifyLegacyRow(closedAfter, rules({ cutoverAt: SWITCH })).verdict).toBe(
      'afterCutover',
    );
    const closedJustBefore = row({ close_time: new Date('2026-11-05T08:59:59.000Z') });
    expect(classifyLegacyRow(closedJustBefore, rules({ cutoverAt: SWITCH })).verdict).toBe(
      'import',
    );
  });

  it('an open row opened before the switch is still not copied', () => {
    const open = row({ open_time: new Date('2026-11-05T06:00:00.000Z'), close_time: null, end: 0 });
    expect(classifyLegacyRow(open, rules({ cutoverAt: SWITCH })).verdict).toBe('open');
  });

  it('a code the register lacks is skipped and named', () => {
    expect(classifyLegacyRow(row({ mach_id: ' 7777 ' }), rules())).toEqual({
      verdict: 'unresolved',
      code: '7777',
    });
    expect(classifyLegacyRow(row({ mach_id: '' }), rules())).toEqual({
      verdict: 'unresolved',
      code: '—',
    });
  });
});

describe('the machine a legacy code resolves to', () => {
  it('the live machine of the code', () => {
    expect(resolveLegacyMachine(index, '9001')).toBe(LIVE);
  });

  it('normalizes as the live entry points do — leading zeros', () => {
    expect(resolveLegacyMachine(index, '009001')).toBe(LIVE);
    expect(resolveLegacyMachine(index, 'HDB-ATM 9501')).toBe(SPACED);
  });

  it('a machine deleted in ECMS (stored `<code>-D`) still owns its history — the one changed last', () => {
    expect(resolveLegacyMachine(index, '9003')).toBe(GONE_NEW);
  });

  it('a code deleted and registered again belongs to the live machine', () => {
    expect(resolveLegacyMachine(index, '9004')).toBe(LIVE_OF_GONE);
  });

  it('a code the legacy delete renamed tries its base code', () => {
    expect(resolveLegacyMachine(index, '9001-D')).toBe(LIVE);
    expect(resolveLegacyMachine(index, '7777-D')).toBeNull();
  });
});

describe('the time mode a deployment is read in', () => {
  it('Cairo wall clock when the open times sit two to three hours after the rows were written', () => {
    // Alexandria's replenishments, April 2026: 2,615 shifted, none as written.
    expect(chooseLegacyTimeMode({ asWritten: 0, cairoShifted: 2_615 })).toBe('cairo-labelled');
  });

  it('UTC when they sit within minutes of it — a few odd rows change nothing', () => {
    // Alexandria's maintenances, August 2026: 6,882 as written, 17 that look shifted.
    expect(chooseLegacyTimeMode({ asWritten: 6_882, cairoShifted: 17 })).toBe('utc');
  });

  it('a tie, or nothing to read, reads as UTC', () => {
    expect(chooseLegacyTimeMode({ asWritten: 0, cairoShifted: 0 })).toBe('utc');
    expect(chooseLegacyTimeMode({ asWritten: 5, cairoShifted: 5 })).toBe('utc');
  });

  it('is clear only by a margin of ten to one — otherwise the run refuses rather than guesses', () => {
    expect(legacyTimeModeClear({ rows: 7_752, asWritten: 6_658, cairoShifted: 37 })).toBe(true);
    expect(legacyTimeModeClear({ rows: 7_326, asWritten: 0, cairoShifted: 2_615 })).toBe(true);
    expect(legacyTimeModeClear({ rows: 100, asWritten: 30, cairoShifted: 4 })).toBe(false);
    expect(legacyTimeModeClear({ rows: 100, asWritten: 40, cairoShifted: 4 })).toBe(true);
    // Rows that fit neither signature decide nothing.
    expect(legacyTimeModeClear({ rows: 100, asWritten: 0, cairoShifted: 0 })).toBe(false);
    // Nothing to read, nothing to copy.
    expect(legacyTimeModeClear({ rows: 0, asWritten: 0, cairoShifted: 0 })).toBe(true);
  });
});

describe('the cutover the screen suggests', () => {
  it('is the first row of the first day with at least 20 — a few test rows do not count', () => {
    const switched = new Date('2026-11-23T19:57:01.946Z');
    expect(
      suggestLegacyCutoverAt([
        { day: '2026-11-25', rows: 380, firstAt: new Date('2026-11-25T05:00:00Z') },
        { day: '2026-10-19', rows: 2, firstAt: new Date('2026-10-19T07:47:44Z') },
        { day: '2026-11-23', rows: 200, firstAt: switched },
        { day: '2026-11-13', rows: 19, firstAt: new Date('2026-11-13T18:35:30Z') },
      ]),
    ).toBe(switched);
  });

  it('is none for a branch with no such day yet', () => {
    expect(suggestLegacyCutoverAt([])).toBeNull();
    expect(
      suggestLegacyCutoverAt([{ day: '2026-11-01', rows: 3, firstAt: new Date('2026-11-01') }]),
    ).toBeNull();
  });
});
