// The issue's two in-memory promises (docs/12-planning/atm-settlements-phase1.md §10.2, DS-11):
// the serials go to the lines in (run, time — nulls last — position) order, whatever order the
// request lists them in; and a transaction callback that `withTransaction` runs again does not
// record its audits twice — they are built fresh on each attempt and recorded once, after the
// commit. The database is mocked; the integration suite proves the same against a real mongod.
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AtmPlanSlot } from '@ecms/contracts';
import { type AuthContext } from '../../../../shared/types';
import type * as NoteCounterModule from './note-counter.model';
import type * as PlanDtoModule from './plan-dto';
import { type AtmPlanLineDoc } from './plan-line.model';
import { type AtmReplenishmentPlanDoc } from './plan.model';

const record = vi.hoisted(() => vi.fn(async () => undefined));
const attempts = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../../../platform/audit', () => ({ auditService: { record } }));
vi.mock('../../../../platform/organization', () => ({
  branchRepository: { list: vi.fn(), findByIdsSystem: vi.fn(async () => []) },
}));
vi.mock('../../../../platform/settings', () => ({
  settingsService: { resolve: vi.fn(async () => ['BRK']) },
}));
// `withTransaction` may run the callback more than once: this one always does, keeping the last.
vi.mock('../../../../platform/kernel/unit-of-work', () => ({
  unitOfWork: async <T>(fn: (session: unknown) => Promise<T>): Promise<T> => {
    attempts.count += 1;
    await fn({});
    return fn({});
  },
}));
vi.mock('../shared/day-signals', () => ({
  signalPreparationDay: vi.fn(),
  signalControlDay: vi.fn(),
}));
vi.mock('./note-counter.model', async (importOriginal) => ({
  ...(await importOriginal<typeof NoteCounterModule>()),
  ensureNoteCounter: vi.fn(async () => undefined),
  takeNoteSerials: vi.fn(async () => 101),
}));
// The machines' current state: every machine live, active, of the plan's bank, at revision 1.
vi.mock('./plan-dto', async (importOriginal) => {
  const actual = await importOriginal<typeof PlanDtoModule>();
  return {
    ...actual,
    loadPlanWorld: vi.fn(async (lines: readonly AtmPlanLineDoc[]) => ({
      today: '2026-01-01',
      machines: new Map(
        lines.map((l) => [String(l.machineId), { _id: l.machineId, isActive: true }]),
      ),
      layouts: new Map(lines.map((l) => [String(l.machineId), { revision: 1 }])),
      banks: new Map(lines.map((l) => [String(l.machineId), { bank: 'BRK', reason: null }])),
    })),
    toPlanDto: vi.fn(async () => ({ id: 'plan' })),
  };
});

const { atmSettlementPlanService } = await import('./plan.service');
const { AtmPlanLineModel } = await import('./plan-line.model');
const { AtmReplenishmentPlanModel } = await import('./plan.model');
const { AtmLinePreparationModel } = await import('../preparation/line-preparation.model');

const ctx: AuthContext = {
  userId: String(new Types.ObjectId()),
  sessionId: 's',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'en',
  permissions: {
    'atmSettlementPlan.view': 'organization',
    'atmSettlementPlan.manage': 'organization',
  },
  permissionVersion: 1,
  isPrivileged: false,
};

const branchId = new Types.ObjectId();
const plan = {
  _id: new Types.ObjectId(),
  branchId,
  bankCode: 'BRK',
  replenishDate: '2026-02-01',
  lastPosition: 5,
  receiptPrint: null,
  handoverPrint: null,
  __v: 0,
} as unknown as AtmReplenishmentPlanDoc;

const slots: AtmPlanSlot[] = [
  { slot: 1, kind: 'withdrawal', denomination: 200, currency: 'EGP', notes: 2000, bag: null },
  { slot: 2, kind: 'withdrawal', denomination: 100, currency: 'EGP', notes: 1000, bag: null },
  { slot: 3, kind: 'withdrawal', denomination: 50, currency: 'EGP', notes: 1000, bag: null },
  { slot: 4, kind: 'withdrawal', denomination: 50, currency: 'EGP', notes: 1000, bag: null },
];

const draft = (run: number, scheduleTime: string | null, position: number): AtmPlanLineDoc =>
  ({
    _id: new Types.ObjectId(),
    planId: plan._id,
    branchId,
    bankCode: 'BRK',
    replenishDate: plan.replenishDate,
    kind: 'machine',
    machineId: new Types.ObjectId(),
    machineCode: `BRKN90${String(position).padStart(2, '0')}`,
    machineName: 'ماكينة اختبار',
    area: null,
    typeLabel: null,
    featuresLabel: null,
    hubLabel: null,
    layoutRevision: 1,
    spareCode: null,
    spareUse: null,
    run,
    scheduleTime,
    position,
    status: 'draft',
    serial: null,
    voidedSerials: [],
    slots,
    countsSource: 'standard',
    standardLoadId: null,
    standardNotes: null,
    egpTotalMinor: 0,
    notePrintCount: 0,
    notePrintedAt: null,
    __v: 3,
  }) as unknown as AtmPlanLineDoc;

/** A query chain whose every link returns itself and whose `exec` resolves `value`. */
const chain = (value: unknown) => {
  const query: Record<string, unknown> = {};
  for (const link of ['lean', 'session', 'sort']) query[link] = () => query;
  query.exec = async () => value;
  return query as never;
};

describe('issue (S18)', () => {
  // Listed out of order on purpose: the request's order must not matter.
  const lines = [
    draft(2, '08:00', 1), // run 2
    draft(1, null, 2), // run 1, no time: after every timed line of the run
    draft(1, '21:00', 3),
    draft(1, '08:00', 4),
    draft(1, '08:00', 5), // same run and time: position decides
  ];
  let updates: { _id: Types.ObjectId; serial: number }[];

  beforeEach(() => {
    attempts.count = 0;
    record.mockClear();
    updates = [];
    vi.spyOn(AtmReplenishmentPlanModel, 'findOne').mockReturnValue(chain(plan));
    vi.spyOn(AtmPlanLineModel, 'find').mockReturnValue(chain(lines));
    vi.spyOn(AtmPlanLineModel, 'findOne').mockReturnValue(chain(null));
    vi.spyOn(AtmPlanLineModel, 'updateOne').mockImplementation(((
      filter: { _id: Types.ObjectId },
      update: { $set: { serial: number } },
    ) => {
      updates.push({ _id: filter._id, serial: update.$set.serial });
      return chain({ matchedCount: 1 });
    }) as never);
    vi.spyOn(AtmLinePreparationModel, 'create').mockResolvedValue([] as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('orders the serials by run, time (nulls last) and position', async () => {
    await atmSettlementPlanService.issue(
      String(plan._id),
      { lines: lines.map((l) => ({ id: String(l._id), version: l.__v })) },
      ctx,
    );
    // The last attempt's writes: one per line, the counter's first number onwards.
    const last = updates.slice(-lines.length);
    const serialOf = (line: AtmPlanLineDoc): number | undefined =>
      last.find((u) => String(u._id) === String(line._id))?.serial;
    expect(
      [lines[3], lines[4], lines[2], lines[1], lines[0]].map((l) => serialOf(l as AtmPlanLineDoc)),
    ).toEqual([101, 102, 103, 104, 105]);
  });

  it("a retried transaction callback records each line's audit once", async () => {
    await atmSettlementPlanService.issue(
      String(plan._id),
      { lines: lines.map((l) => ({ id: String(l._id), version: l.__v })) },
      ctx,
    );
    expect(attempts.count).toBe(1);
    // The callback ran twice (10 line writes), the audits once per line.
    expect(updates).toHaveLength(2 * lines.length);
    expect(record).toHaveBeenCalledTimes(lines.length);
    const audited = record.mock.calls.map(
      (call) => (call as unknown as [{ entityRef: { entityId: string } }])[0].entityRef.entityId,
    );
    expect(new Set(audited)).toEqual(new Set(lines.map((l) => String(l._id))));
  });
});
