// When the board fires the descent by itself, and what it then says.
//
// The decision is pure so it can be pinned exactly: an auto-fire that is wrong in either direction
// is bad in a different way. Firing when it should not writes a plan nobody asked for; not firing
// when it should leaves the operator dragging a crew that was already decided.
import { describe, expect, it } from 'vitest';
import { type OperationsCrewSeedReportDto } from '@ecms/contracts';
import { seedSummary, shouldAutoSeed, type AutoSeedInput } from './crew-seed';

const ready = (over: Partial<AutoSeedInput> = {}): AutoSeedInput => ({
  canPlan: true,
  boardDay: null,
  standingRowCount: 3,
  attempted: new Set<string>(),
  date: '2026-08-20',
  busy: false,
  ...over,
});

describe('shouldAutoSeed', () => {
  it('fires on a date nobody has planned yet', () => {
    expect(shouldAutoSeed(ready())).toBe(true);
  });

  it('never fires for a viewer — navigating must not write the board', () => {
    expect(shouldAutoSeed(ready({ canPlan: false }))).toBe(false);
  });

  it('does not fire once the day exists — somebody has already planned this date', () => {
    // `day === null` is the precise test. Anything looser ("the board looks empty") would re-fire
    // on a day somebody had deliberately emptied.
    expect(shouldAutoSeed(ready({ boardDay: { id: 'd1' } }))).toBe(false);
  });

  it('does not fire when the standing crew is empty — nothing to descend', () => {
    expect(shouldAutoSeed(ready({ standingRowCount: 0 }))).toBe(false);
  });

  it('does not fire while anything is still loading or in flight', () => {
    expect(shouldAutoSeed(ready({ busy: true }))).toBe(false);
  });

  it('does not fire without a resolved date', () => {
    expect(shouldAutoSeed(ready({ date: '' }))).toBe(false);
  });

  it('fires at most ONCE per date, whatever the outcome was', () => {
    // Retrying a failure automatically turns one bad response into a loop; and a seed that
    // legitimately found nothing would otherwise re-fire on every render, since nothing about the
    // board would have changed.
    expect(shouldAutoSeed(ready({ attempted: new Set(['2026-08-20']) }))).toBe(false);
  });

  it('still fires for a DIFFERENT date in the same session', () => {
    expect(shouldAutoSeed(ready({ attempted: new Set(['2026-08-19']) }))).toBe(true);
  });
});

const report = (over: Partial<OperationsCrewSeedReportDto> = {}): OperationsCrewSeedReportDto => ({
  date: '2026-08-20T00:00:00.000Z',
  seededVehicleIds: [],
  skipped: [],
  dropped: [],
  ...over,
});

describe('seedSummary', () => {
  it('counts what was seeded', () => {
    expect(seedSummary(report({ seededVehicleIds: ['v1', 'v2'] })).seeded).toBe(2);
  });

  it('separates the three skip reasons rather than lumping them together', () => {
    const summary = seedSummary(
      report({
        skipped: [
          { vehicleId: 'v1', reason: 'alreadyPlanned' },
          { vehicleId: 'v2', reason: 'notRostered' },
          { vehicleId: 'v3', reason: 'notRostered' },
          { vehicleId: 'v4', reason: 'noCrewToSeed' },
        ],
      }),
    );
    expect(summary.alreadyPlanned).toBe(1);
    expect(summary.notRostered).toBe(2);
    expect(summary.noCrew).toBe(1);
  });

  it('counts people dropped from rows that were still seeded', () => {
    const summary = seedSummary(
      report({
        seededVehicleIds: ['v1'],
        dropped: [{ employeeId: 'e1', vehicleId: 'v1', reason: 'exited' }],
      }),
    );
    expect(summary.dropped).toBe(1);
    expect(summary.quiet).toBe(false);
  });

  it('is QUIET when nothing happened and nothing was declined', () => {
    expect(seedSummary(report()).quiet).toBe(true);
  });

  it('stays quiet when every vehicle was already planned — that is the veto working', () => {
    // The normal state of a board somebody has already worked on. Announcing it on every visit
    // would train the operator to dismiss the message that matters.
    const summary = seedSummary(
      report({ skipped: [{ vehicleId: 'v1', reason: 'alreadyPlanned' }] }),
    );
    expect(summary.alreadyPlanned).toBe(1);
    expect(summary.quiet).toBe(true);
  });

  it('is NOT quiet when a vehicle was left unplanned for a reason the operator can act on', () => {
    for (const reason of ['notRostered', 'noCrewToSeed'] as const) {
      expect(seedSummary(report({ skipped: [{ vehicleId: 'v1', reason }] })).quiet).toBe(false);
    }
  });
});
