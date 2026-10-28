// The rules of «نقل البيانات» (branch-move.planner.ts), each on its own: what a linked source's
// labels, machine twins, zones, dispatch lines and standard loads become in the target, the branch
// ids inside values, and what refuses the move. The owner (2026-10-28): «أنا عايز كل ماكينه تظهر فى
// الفرع بتاعها طبقاً للفرع المتسجله فيه» — every row of October filed under Mohandessin, with nothing
// of Mohandessin's own overwritten and no unique key keyed by branch broken on the way.
import { describe, expect, it } from 'vitest';
import {
  ATM_MAP_ZONE_NAME_MAX,
  ATM_MAP_ZONE_POINTS_PER_BRANCH_MAX,
  ATM_MAP_ZONES_PER_BRANCH_MAX,
} from '@ecms/contracts';
import {
  BRANCH_MOVE_BATCH_SIZE,
  blockerDetails,
  chunks,
  moveSuffixLabel,
  orderedBlockers,
  planLabelMoves,
  planMachineTwins,
  planRouteMoves,
  planStandardLoadMoves,
  planZoneMoves,
  repointBranchRows,
  repointMailboxBranches,
  suffixedName,
  twinBlockers,
  zoneCapsBlocker,
  type MoveLabelRow,
  type MoveMachineRow,
  type MoveZoneRow,
} from './branch-move.planner';

const OCT = 'a'.repeat(24);
const MOH = 'b'.repeat(24);
const TANTA = 'c'.repeat(24);

describe('the suffix a renamed zone or line carries', () => {
  it('is the source branch’s Arabic name, its English one when there is none', () => {
    expect(moveSuffixLabel({ ar: 'أكتوبر', en: 'October' })).toBe('أكتوبر');
    expect(moveSuffixLabel({ ar: ' ', en: 'October' })).toBe('October');
    expect(moveSuffixLabel(null)).toBe('');
  });

  it('drops control characters and keeps room for the name', () => {
    expect(moveSuffixLabel({ ar: 'أكتوبر\u0007  الجديدة', en: '' })).toBe('أكتوبر الجديدة');
    expect(moveSuffixLabel({ ar: 'ف'.repeat(80), en: '' })).toHaveLength(30);
  });

  it('takes the first free form: the label, then the label numbered', () => {
    const taken = new Set(['قطاع 1 (أكتوبر)']);
    expect(suffixedName('قطاع 1', 'أكتوبر', () => true)).toBe('قطاع 1 (أكتوبر)');
    expect(suffixedName('قطاع 1', 'أكتوبر', (name) => !taken.has(name))).toBe('قطاع 1 (أكتوبر 2)');
  });

  it('numbers from 2 when the source has no name left', () => {
    expect(suffixedName('Route A', '', () => true)).toBe('Route A (2)');
    expect(suffixedName('Route A', '', (name) => name !== 'Route A (2)')).toBe('Route A (3)');
  });

  it('stays within the 60 characters a zone or route name may hold', () => {
    const name = suffixedName('ز'.repeat(60), 'أكتوبر', () => true);
    expect(name.length).toBeLessThanOrEqual(ATM_MAP_ZONE_NAME_MAX);
    expect(name.endsWith(' (أكتوبر)')).toBe(true);
  });
});

const label = (over: Partial<MoveLabelRow> & Pick<MoveLabelRow, 'id' | 'name'>): MoveLabelRow => ({
  kind: 'area',
  nameAr: null,
  nameEn: null,
  formerNames: [],
  bankCode: null,
  isDeleted: false,
  ...over,
});

describe('labels', () => {
  it('a live name in both: the target’s row stays and takes only what it left empty', () => {
    const plan = planLabelMoves(
      [
        label({ id: 's1', kind: 'bank', name: 'NBE FOREX', bankCode: 'NBE' }),
        label({ id: 's2', name: 'الدقي', nameAr: 'الدقي', nameEn: 'Dokki', formerNames: ['دقي'] }),
      ],
      [
        label({ id: 't1', kind: 'bank', name: 'NBE FOREX', bankCode: null }),
        label({ id: 't2', name: 'الدقي', nameAr: 'الدقى', formerNames: ['الدقي القديم'] }),
      ],
    );
    expect(plan.moves.get('s1')).toEqual({ action: 'merge', targetId: 't1' });
    expect(plan.moves.get('s2')).toEqual({ action: 'merge', targetId: 't2' });
    expect(plan.merged).toBe(2);
    expect(plan.fills.get('t1')).toEqual({
      bankCode: 'NBE',
      nameAr: null,
      nameEn: null,
      formerNames: [],
    });
    // The Arabic display name the target set is never overwritten; its English one was empty.
    expect(plan.fills.get('t2')).toEqual({
      bankCode: null,
      nameAr: null,
      nameEn: 'Dokki',
      formerNames: ['دقي'],
    });
  });

  it('never fills a bank mapping the target set, and adds no former name it holds or is', () => {
    const plan = planLabelMoves(
      [label({ id: 's1', kind: 'bank', name: 'CIB', bankCode: 'CIB', formerNames: ['CIB', 'X'] })],
      [label({ id: 't1', kind: 'bank', name: 'CIB', bankCode: 'QNB', formerNames: ['X'] })],
    );
    expect(plan.moves.get('s1')).toEqual({ action: 'merge', targetId: 't1' });
    expect(plan.fills.has('t1')).toBe(false);
  });

  it('a live source name the target renamed away is retired — never brought back (DEC-38)', () => {
    const plan = planLabelMoves(
      [label({ id: 's1', name: 'جيزة' }), label({ id: 's2', name: 'فيصل' })],
      [
        label({ id: 't1', name: 'الجيزة', formerNames: ['جيزة'] }),
        // A renamed-away name a later delete left behind still counts: the boot backfill reads it.
        label({ id: 't2', name: 'شارع فيصل', formerNames: ['فيصل'], isDeleted: true }),
      ],
    );
    expect(plan.moves.get('s1')).toEqual({ action: 'retire' });
    expect(plan.moves.get('s2')).toEqual({ action: 'retire' });
    expect(plan.retired).toBe(2);
    expect(plan.merged).toBe(0);
  });

  it('moves everything else as it is: a name the target lacks, and every deleted row', () => {
    const plan = planLabelMoves(
      [
        label({ id: 's1', name: 'الهرم' }),
        label({ id: 's2', name: 'الدقي', isDeleted: true }),
        // A deleted target row is no live name: the source's live one moves live.
        label({ id: 's3', name: 'العجوزة' }),
      ],
      [label({ id: 't1', name: 'الدقي' }), label({ id: 't2', name: 'العجوزة', isDeleted: true })],
    );
    expect([...plan.moves.values()]).toEqual([
      { action: 'move' },
      { action: 'move' },
      { action: 'move' },
    ]);
    expect(plan.fills.size).toBe(0);
  });

  it('keeps the two lists apart: a bank spelling and an area of one text never merge', () => {
    const plan = planLabelMoves(
      [label({ id: 's1', kind: 'bank', name: 'مصر' })],
      [label({ id: 't1', kind: 'area', name: 'مصر' })],
    );
    expect(plan.moves.get('s1')).toEqual({ action: 'move' });
  });

  it('two live source rows of one name (no unique index built): the second merges into the first', () => {
    const plan = planLabelMoves(
      [label({ id: 's1', name: 'المعادي' }), label({ id: 's2', name: 'المعادي', nameEn: 'Maadi' })],
      [],
    );
    expect(plan.moves.get('s1')).toEqual({ action: 'move' });
    expect(plan.moves.get('s2')).toEqual({ action: 'merge', targetId: 's1' });
    expect(plan.fills.get('s1')?.nameEn).toBe('Maadi');
  });
});

const machine = (
  over: Partial<MoveMachineRow> & Pick<MoveMachineRow, 'id' | 'side'>,
): MoveMachineRow => ({
  machineCode: '27720226',
  isActive: true,
  holdsOpenEntry: false,
  holdsOpenOperation: false,
  ...over,
});

describe('machine twins — one code held by a live master in each branch', () => {
  it('(b) active in the source, archived in the target: the target’s twin is retired', () => {
    const plan = planMachineTwins([
      machine({ id: 's', side: 'source' }),
      machine({ id: 't', side: 'target', isActive: false }),
    ]);
    expect(plan.retire).toEqual([{ id: 't', machineCode: '27720226', side: 'target' }]);
    expect(twinBlockers(plan)).toEqual([]);
  });

  it('(c) archived in the source, active in the target: the source’s twin is retired', () => {
    const plan = planMachineTwins([
      machine({ id: 's', side: 'source', isActive: false }),
      machine({ id: 't', side: 'target' }),
    ]);
    expect(plan.retire).toEqual([{ id: 's', machineCode: '27720226', side: 'source' }]);
  });

  it('(d) archived in both: the target’s stays', () => {
    const plan = planMachineTwins([
      machine({ id: 's', side: 'source', isActive: false }),
      machine({ id: 't', side: 'target', isActive: false }),
    ]);
    expect(plan.retire.map((twin) => twin.id)).toEqual(['s']);
  });

  it('(a) active in both: the one holding the code’s open register period stays (D2)', () => {
    const plan = planMachineTwins([
      machine({ id: 's', side: 'source', holdsOpenEntry: true }),
      machine({ id: 't', side: 'target' }),
    ]);
    expect(plan.retire.map((twin) => twin.id)).toEqual(['t']);
  });

  it('(a) active in both and the register does not decide: refused, the code listed', () => {
    const neither = planMachineTwins([
      machine({ id: 's', side: 'source', machineCode: '101' }),
      machine({ id: 't', side: 'target', machineCode: '101' }),
    ]);
    // DEC-11: two exempt open periods, one on each twin.
    const both = planMachineTwins([
      machine({ id: 's', side: 'source', machineCode: '102', holdsOpenEntry: true }),
      machine({ id: 't', side: 'target', machineCode: '102', holdsOpenEntry: true }),
    ]);
    expect(neither.activeInBoth).toEqual(['101']);
    expect(both.activeInBoth).toEqual(['102']);
    expect(neither.retire).toEqual([]);
    expect(twinBlockers(neither)).toEqual([{ kind: 'machineActiveInBoth', codes: ['101'] }]);
  });

  it('a twin to retire that still holds an open entry or operation refuses instead', () => {
    const entry = planMachineTwins([
      machine({ id: 's', side: 'source' }),
      machine({ id: 't', side: 'target', isActive: false, holdsOpenEntry: true }),
    ]);
    const operation = planMachineTwins([
      machine({ id: 's', side: 'source', holdsOpenEntry: true }),
      machine({ id: 't', side: 'target', holdsOpenOperation: true }),
    ]);
    expect(entry.twinOpen).toEqual(['27720226']);
    expect(operation.twinOpen).toEqual(['27720226']);
    expect(entry.retire).toEqual([]);
    expect(twinBlockers(operation)).toEqual([{ kind: 'machineTwinOpen', codes: ['27720226'] }]);
  });

  it('a code only one branch holds is no twin, and the codes come back in their natural order', () => {
    const plan = planMachineTwins([
      machine({ id: 's1', side: 'source', machineCode: '1001' }),
      machine({ id: 't1', side: 'target', machineCode: '1001' }),
      machine({ id: 's2', side: 'source', machineCode: '99' }),
      machine({ id: 't2', side: 'target', machineCode: '99' }),
      machine({ id: 's3', side: 'source', machineCode: '500' }),
    ]);
    expect(plan.activeInBoth).toEqual(['99', '1001']);
  });

  it('retires only what would meet the survivor: a duplicate the target already had stays', () => {
    const plan = planMachineTwins([
      machine({ id: 's', side: 'source', isActive: false }),
      machine({ id: 't1', side: 'target', isActive: false }),
      machine({ id: 't2', side: 'target', isActive: false }),
    ]);
    expect(plan.retire.map((twin) => twin.id)).toEqual(['s']);
  });
});

const zone = (id: string, name: string, order: number, points = 4): MoveZoneRow => ({
  id,
  name,
  order,
  points,
});

describe('map zones', () => {
  it('follow the target’s in their own order, a name the target uses suffixed', () => {
    const plan = planZoneMoves(
      [zone('s2', 'قطاع 3', 1), zone('s1', 'قطاع 1', 0)],
      [zone('t1', 'قطاع 1', 0), zone('t2', 'قطاع 2', 1)],
      'أكتوبر',
    );
    expect(plan.zones).toEqual([
      { id: 's1', name: 'قطاع 1 (أكتوبر)', order: 2, renamed: true },
      { id: 's2', name: 'قطاع 3', order: 3, renamed: false },
    ]);
    expect(plan.renamed).toBe(1);
  });

  it('compares names as the zone service does — spaces and case folded (DM-8)', () => {
    const plan = planZoneMoves(
      [zone('s1', '  north  zone ', 0)],
      [zone('t1', 'North Zone', 4)],
      '',
    );
    expect(plan.zones).toEqual([{ id: 's1', name: 'north  zone (2)', order: 5, renamed: true }]);
  });

  it('a suffixed name avoids every name either branch holds, and two source zones of one name part', () => {
    const plan = planZoneMoves(
      [zone('s1', 'A', 0), zone('s2', 'A (أكتوبر)', 1), zone('s3', 'B', 2), zone('s4', 'B', 3)],
      [zone('t1', 'A', 0)],
      'أكتوبر',
    );
    expect(plan.zones.map((z) => z.name)).toEqual([
      'A (أكتوبر 2)',
      'A (أكتوبر)',
      'B',
      'B (أكتوبر)',
    ]);
    expect(plan.renamed).toBe(2);
  });

  it('start at 0 in a target with no zones', () => {
    expect(planZoneMoves([zone('s1', 'A', 7)], [], 'x').zones).toEqual([
      { id: 's1', name: 'A', order: 0, renamed: false },
    ]);
  });
});

describe('the map caps on the target', () => {
  const many = (n: number, points = 3): MoveZoneRow[] =>
    Array.from({ length: n }, (_, i) => zone(`z${String(i)}`, `Z${String(i)}`, i, points));

  it('refuse past 200 zones, naming the totals after the move', () => {
    expect(zoneCapsBlocker(many(1), many(ATM_MAP_ZONES_PER_BRANCH_MAX))).toEqual({
      kind: 'zoneCaps',
      zones: ATM_MAP_ZONES_PER_BRANCH_MAX + 1,
      points: (ATM_MAP_ZONES_PER_BRANCH_MAX + 1) * 3,
    });
    expect(zoneCapsBlocker(many(100), many(100))).toBeNull();
  });

  it('refuse past 20,000 points', () => {
    const blocker = zoneCapsBlocker(many(2, 6_000), many(2, 4_001));
    expect(blocker).toEqual({ kind: 'zoneCaps', zones: 4, points: 20_002 });
    expect(zoneCapsBlocker(many(2, 5_000), many(2, 5_000))).toBeNull();
    expect(ATM_MAP_ZONE_POINTS_PER_BRANCH_MAX).toBe(20_000);
  });

  it('never refuse a source with no zones', () => {
    expect(zoneCapsBlocker([], many(ATM_MAP_ZONES_PER_BRANCH_MAX + 5))).toBeNull();
  });
});

describe('dispatch lines', () => {
  const route = (id: string, replenishDate: string, name: string, order: number) => ({
    id,
    replenishDate,
    name,
    nameKey: name.trim().replace(/\s+/g, ' ').toLowerCase(),
    order,
  });

  it('per day: a name the target uses that day suffixed, the order after the target’s', () => {
    const plan = planRouteMoves(
      [
        route('s1', '2026-10-28', 'Route A', 0),
        route('s2', '2026-10-28', 'Route B', 1),
        route('s3', '2026-10-29', 'Route A', 0),
      ],
      [route('t1', '2026-10-28', 'route a', 0)],
      'أكتوبر',
    );
    expect(plan.routes).toEqual([
      {
        id: 's1',
        name: 'Route A (أكتوبر)',
        nameKey: 'route a (أكتوبر)',
        order: 1,
        renamed: true,
      },
      { id: 's2', name: 'Route B', nameKey: 'route b', order: 2, renamed: false },
      // The target has no line on the 29th: nothing clashes, the order starts at 0.
      { id: 's3', name: 'Route A', nameKey: 'route a', order: 0, renamed: false },
    ]);
    expect(plan.renamed).toBe(1);
  });
});

describe('standard loads', () => {
  const load = (id: string, bankCode: string, isDefault: boolean, order: number) => ({
    id,
    bankCode,
    isDefault,
    order,
  });

  it('the target’s default stays the default; the source’s is switched off', () => {
    const plan = planStandardLoadMoves(
      [load('s1', 'BRK', true, 0), load('s2', 'BRK', false, 1)],
      [load('t1', 'BRK', true, 0), load('t2', 'BRK', false, 3)],
    );
    expect(plan.loads).toEqual([
      { id: 's1', order: 4, unsetDefault: true },
      { id: 's2', order: 5, unsetDefault: false },
    ]);
    expect(plan.defaultsUnset).toBe(1);
  });

  it('a bank the target has no default for keeps the source’s — one only', () => {
    const plan = planStandardLoadMoves(
      [load('s1', 'NBE', true, 0), load('s2', 'NBE', true, 1), load('s3', 'BRK', true, 0)],
      [load('t1', 'NBE', false, 0)],
    );
    expect(plan.loads).toEqual([
      { id: 's1', order: 1, unsetDefault: false },
      { id: 's2', order: 2, unsetDefault: true },
      { id: 's3', order: 0, unsetDefault: false },
    ]);
  });
});

describe('branch ids inside values', () => {
  it('a setting’s source row re-pointed to the target — the case of an id never mattering', () => {
    expect(
      repointBranchRows(
        [
          { code: 'EGYCASH-5', branchId: OCT.toUpperCase() },
          { code: 'EGYCASH-2', branchId: TANTA },
        ],
        OCT,
        MOH,
      ),
    ).toEqual({
      rows: [
        { code: 'EGYCASH-5', branchId: MOH },
        { code: 'EGYCASH-2', branchId: TANTA },
      ],
      repointed: 1,
    });
  });

  it('nothing changes when the target has a row of its own, or the source has none', () => {
    const both = [
      { branchId: OCT, category: 'Orange' },
      { branchId: MOH, category: 'Green' },
    ];
    expect(repointBranchRows(both, OCT, MOH)).toBeNull();
    expect(repointBranchRows([{ branchId: TANTA, category: 'Red' }], OCT, MOH)).toBeNull();
  });

  it('the mailbox list: the source’s row becomes the target’s, its category kept', () => {
    expect(
      repointMailboxBranches(
        [
          { branchId: TANTA, category: null },
          { branchId: OCT, category: 'Orange' },
        ],
        OCT,
        MOH,
      ),
    ).toEqual([
      { branchId: TANTA, category: null },
      { branchId: MOH, category: 'Orange' },
    ]);
  });

  it('the mailbox list: the source’s row dropped when the target is switched on already', () => {
    expect(
      repointMailboxBranches(
        [
          { branchId: OCT, category: 'Orange' },
          { branchId: MOH, category: 'Green' },
        ],
        OCT,
        MOH,
      ),
    ).toEqual([{ branchId: MOH, category: 'Green' }]);
    expect(repointMailboxBranches([{ branchId: MOH, category: null }], OCT, MOH)).toBeNull();
  });
});

describe('blockers', () => {
  it('come back in the contract’s order, each a detail with its kind as the code', () => {
    const blockers = orderedBlockers([
      { kind: 'moveRunning' },
      { kind: 'planSameDay', items: [{ bankCode: 'BRK', replenishDate: '2026-10-28' }] },
      { kind: 'machineActiveInBoth', codes: ['101'] },
    ]);
    expect(blockers.map((blocker) => blocker.kind)).toEqual([
      'machineActiveInBoth',
      'planSameDay',
      'moveRunning',
    ]);
    expect(blockerDetails(blockers)).toEqual([
      {
        field: 'blockers',
        code: 'machineActiveInBoth',
        message: 'machine codes active in both branches: 101',
      },
      {
        field: 'blockers',
        code: 'planSameDay',
        message: 'plans of one bank and day in both branches: BRK 2026-10-28',
      },
      { field: 'blockers', code: 'moveRunning', message: 'another move is running' },
    ]);
  });

  it('shorten a long list in the message', () => {
    const codes = Array.from({ length: 13 }, (_, i) => String(100 + i));
    const [detail] = blockerDetails([{ kind: 'machineTwinOpen', codes }]);
    expect(detail?.message).toBe(
      'machine twins still holding open work: 100, 101, 102, 103, 104, 105, 106, 107, 108, 109 and 3 more',
    );
  });
});

describe('batches', () => {
  it('cut a list into runs of 200, the register import’s transaction size', () => {
    expect(BRANCH_MOVE_BATCH_SIZE).toBe(200);
    const runs = chunks(Array.from({ length: 401 }, (_, i) => i));
    expect(runs.map((run) => run.length)).toEqual([200, 200, 1]);
    expect(chunks([])).toEqual([]);
  });
});
