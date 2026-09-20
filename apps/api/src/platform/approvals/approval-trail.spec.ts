// What the trail says happened, checked one sentence at a time.
//
// Every rule here is one an auditor reads back off a screen months later, and every way it can be
// wrong is quiet: a rung that vanishes, a dead request that still reads «waiting on somebody», a
// cancelled rung that claims nobody held it. None of them raise.
import { describe, expect, it } from 'vitest';
import { resolveChain, type ChainStep } from './approval-chain';
import {
  buildTrail,
  entriesForDecision,
  progressOf,
  statusOf,
  viewerDecision,
  type DecidedEntry,
} from './approval-trail';

const NOW = new Date('2026-09-20T10:00:00.000Z');
const LATER = new Date('2026-09-20T11:00:00.000Z');

const step = (level: ChainStep['level']): ChainStep => ({
  permissionKey: 'leave.approve',
  level,
  label: null,
});

// 0 مدير حركة الفرع · 1 مدير عام الحركة · 2 الموارد البشرية.
const STEPS: ChainStep[] = [step('unit'), step('department'), step('organization')];
const chain = (staffed: readonly boolean[]) =>
  resolveChain(STEPS, (s) => staffed[STEPS.indexOf(s)] === true);
const FULL = chain([true, true, true]);

const decide = (
  steps: ReturnType<typeof chain>,
  decisions: readonly DecidedEntry[],
  stepIndex: number,
  decision: 'approved' | 'rejected',
  deciderUserId = 'u-decider',
  at: Date = NOW,
): DecidedEntry[] => [
  ...decisions,
  ...entriesForDecision(
    steps,
    decisions,
    { stepIndex, decision, deciderUserId, comment: null, overriddenWith: null },
    at,
  ),
];

describe('how far the chain has got', () => {
  it('is nowhere on a request nobody has touched', () => {
    expect(progressOf([])).toBe(0);
    expect(statusOf(FULL, [])).toBe('pending');
  });

  it('moves one rung per decision, and the request stays pending until the last one', () => {
    const one = decide(FULL, [], 0, 'approved');
    expect(progressOf(one)).toBe(1);
    expect(statusOf(FULL, one)).toBe('pending');
    expect(statusOf(FULL, decide(FULL, one, 1, 'approved'))).toBe('pending');
    expect(statusOf(FULL, decide(FULL, decide(FULL, one, 1, 'approved'), 2, 'approved'))).toBe(
      'approved',
    );
  });

  it('reads one past the highest settled rung, not the number of rows', () => {
    // A migration that left a gap must still move the chain FORWARD — re-asking a rung somebody
    // already answered is the one outcome worse than a gap.
    const gappy: DecidedEntry[] = [
      { stepIndex: 1, outcome: 'approved', deciderUserId: 'u', decidedAt: NOW, comment: null, overriddenWith: null },
    ];
    expect(progressOf(gappy)).toBe(2);
  });

  it('is rejected the moment one rung rejects, and no later yes changes that', () => {
    const no = decide(FULL, [], 0, 'rejected');
    expect(statusOf(FULL, no)).toBe('rejected');
    // Even with a later approval somehow stored above it, the rejection stands.
    expect(statusOf(FULL, decide(FULL, no, 1, 'approved'))).toBe('rejected');
  });
});

describe('what a decision writes down', () => {
  it('writes only its own rung when it is simply that rung’s turn', () => {
    const written = entriesForDecision(
      FULL,
      [],
      { stepIndex: 0, decision: 'approved', deciderUserId: 'u1', comment: 'تمام', overriddenWith: null },
      NOW,
    );
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ stepIndex: 0, outcome: 'approved', deciderUserId: 'u1', comment: 'تمام' });
  });

  it('marks a rung a superior cancelled as COVERED, with nobody’s name on it', () => {
    // «لو المدير العام وافق مش محتاج مدير الفرع» — rung 0 was staffed and was cancelled, which is
    // not the same fact as rung 0 being empty, and the trail must not say it was.
    const written = entriesForDecision(
      FULL,
      [],
      { stepIndex: 1, decision: 'approved', deciderUserId: 'gm', comment: null, overriddenWith: null },
      NOW,
    );
    expect(written.map((e) => [e.stepIndex, e.outcome])).toEqual([
      [0, 'covered'],
      [1, 'approved'],
    ]);
    expect(written[0]?.deciderUserId).toBeNull();
  });

  it('marks a rung nobody could stand on as SKIPPED, in the same pass', () => {
    // Rung 0 is empty and rung 1 was cancelled — two different reasons, two different words, one
    // decision. An engine that used one word for both would answer neither question.
    const noBranchManager = chain([false, true, true]);
    const written = entriesForDecision(
      noBranchManager,
      [],
      { stepIndex: 2, decision: 'approved', deciderUserId: 'hr', comment: null, overriddenWith: null },
      NOW,
    );
    expect(written.map((e) => [e.stepIndex, e.outcome])).toEqual([
      [0, 'skipped'],
      [1, 'covered'],
      [2, 'approved'],
    ]);
  });

  it('closes the empty rungs above an approval that finishes the chain', () => {
    // Nobody holds the two rungs above; the request is finished, and a blank row a year from now
    // would read as an oversight rather than as «مفيش حد على الدرجة دي».
    const onlyTheFirst = chain([true, false, false]);
    const written = entriesForDecision(
      onlyTheFirst,
      [],
      { stepIndex: 0, decision: 'approved', deciderUserId: 'u1', comment: null, overriddenWith: null },
      NOW,
    );
    expect(written.map((e) => [e.stepIndex, e.outcome])).toEqual([
      [0, 'approved'],
      [1, 'skipped'],
      [2, 'skipped'],
    ]);
    expect(statusOf(onlyTheFirst, written)).toBe('approved');
  });

  it('closes nothing above a REJECTION — those rungs were never asked', () => {
    const written = entriesForDecision(
      FULL,
      [],
      { stepIndex: 0, decision: 'rejected', deciderUserId: 'u1', comment: 'مرفوض', overriddenWith: null },
      NOW,
    );
    expect(written).toHaveLength(1);
  });

  it('keeps the override’s reason on the rung it was used on, and nowhere else', () => {
    const written = entriesForDecision(
      FULL,
      [],
      { stepIndex: 1, decision: 'approved', deciderUserId: 'boss', comment: null, overriddenWith: 'approval.override' },
      NOW,
    );
    expect(written[0]?.overriddenWith).toBeNull();
    expect(written[1]?.overriddenWith).toBe('approval.override');
  });
});

describe('what the reader may do', () => {
  it('is his own rung when it is waiting on him', () => {
    expect(viewerDecision(FULL, [], [0])).toEqual({ step: 0, covers: [] });
  });

  it('is his own rung ahead of his turn, cancelling what is below and nothing above', () => {
    expect(viewerDecision(FULL, [], [1])).toEqual({ step: 1, covers: [0] });
  });

  it('is nothing for somebody on no rung of this chain', () => {
    expect(viewerDecision(FULL, [], [])).toBeNull();
  });

  it('is nothing once the request is finished, however senior the reader', () => {
    const done = decide(FULL, decide(FULL, decide(FULL, [], 0, 'approved'), 1, 'approved'), 2, 'approved');
    expect(viewerDecision(FULL, done, [0, 1, 2])).toBeNull();
  });

  it('is nothing once the request is rejected — a later rung does not overturn it', () => {
    const no = decide(FULL, [], 0, 'rejected');
    expect(viewerDecision(FULL, no, [1, 2])).toBeNull();
  });

  it('is nothing for the man who already decided, even though his rung is still his', () => {
    const one = decide(FULL, [], 0, 'approved');
    expect(viewerDecision(FULL, one, [0])).toBeNull();
  });
});

describe('the trail a reader is shown', () => {
  const nameOf = (id: string) => ({ id, name: id === 'gm' ? 'محمد' : id });

  it('has one row per rung, in order, with none left out', () => {
    const trail = buildTrail(FULL, [], nameOf);
    expect(trail).toHaveLength(3);
    expect(trail.map((row) => row.level)).toEqual(['unit', 'department', 'organization']);
    expect(trail.every((row) => row.outcome === 'pending')).toBe(true);
  });

  it('names who decided, and leaves the name off the rungs nobody stood on', () => {
    const trail = buildTrail(FULL, decide(FULL, [], 1, 'approved', 'gm'), nameOf);
    expect(trail[0]).toMatchObject({ outcome: 'covered', decidedBy: null });
    expect(trail[1]).toMatchObject({ outcome: 'approved' });
    expect(trail[1]?.decidedBy).toEqual({ id: 'gm', name: 'محمد' });
    expect(trail[2]?.outcome).toBe('pending');
  });

  it('calls a rung a rejection never reached UNREACHED, not skipped and not pending', () => {
    // Two lies avoided in one row: `skipped` would tell the reader nobody holds that rung, and
    // `pending` would leave a dead request looking like it is still waiting on somebody.
    const trail = buildTrail(FULL, decide(FULL, [], 0, 'rejected'), nameOf);
    expect(trail[0]?.outcome).toBe('rejected');
    expect(trail[1]?.outcome).toBe('unreached');
    expect(trail[2]?.outcome).toBe('unreached');
  });

  it('carries the decision time as an ISO string, per rung', () => {
    const trail = buildTrail(FULL, decide(FULL, [], 0, 'approved', 'u1', LATER), nameOf);
    expect(trail[0]?.decidedAt).toBe(LATER.toISOString());
    expect(trail[1]?.decidedAt).toBeNull();
  });

  it('keeps the rung’s own caption, which is a caption and never the authority', () => {
    const captioned = resolveChain(
      [{ permissionKey: 'leave.approve', level: 'unit', label: { ar: 'مدير الحركة', en: 'Fleet manager' } }],
      () => true,
    );
    expect(buildTrail(captioned, [], nameOf)[0]?.label).toEqual({
      ar: 'مدير الحركة',
      en: 'Fleet manager',
    });
  });
});
