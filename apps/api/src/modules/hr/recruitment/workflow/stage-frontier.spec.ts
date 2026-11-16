// The read-only rule, as arithmetic — no database, no bindings, no clock.
//
// This is the rule a recruiter meets as «this stage is a read-only record», and the one the API
// enforces so a stale page cannot get round it. It is worth pinning here rather than only through
// HTTP, because the two cases that made the old behaviour wrong are both about COMPARING positions
// and neither needs a server to state: a stage behind the candidate is closed, and two evaluation
// phases at the same position are both open.
import { describe, expect, it } from 'vitest';
import {
  currentOf,
  frontierRank,
  isPassed,
  passedRecordIds,
  stageIdentityOf,
  stageRank,
  type LiveStageRow,
} from './stage-frontier';

const row = (
  over: Partial<LiveStageRow> & Pick<LiveStageRow, 'object' | 'recordId'>,
): LiveStageRow => ({
  key: over.object,
  refId: null,
  name: null,
  status: 'waiting',
  attempt: 1,
  open: true,
  ...over,
  // Last, so a case that states a rank keeps it and one that does not gets the object's own.
  rank: over.rank ?? stageRank(over.object, null),
});

describe('stageRank — the pipeline as positions', () => {
  it('orders the stage objects the way the business does', () => {
    expect(stageRank('screening', null)).toBeLessThan(stageRank('interview', null));
    expect(stageRank('interview', null)).toBeLessThan(stageRank('evaluation', null));
    expect(stageRank('evaluation', null)).toBeLessThan(stageRank('offer', null));
  });

  it('puts the second interview round past the first, and no round past the next object', () => {
    expect(stageRank('interview', 2)).toBeGreaterThan(stageRank('interview', 1));
    // A candidate's eleventh round is still an interview — it must not overtake the checks.
    expect(stageRank('interview', 11)).toBeLessThan(stageRank('evaluation', null));
  });

  it('puts evaluation phases at ONE position, whatever order the catalogue lists them in', () => {
    // Rounds are sequential, phases are not: `openEvaluationPhases` opens every applicable phase
    // together. Counting the phase order would make «الفحص الأمني» (order 1) read-only while it was
    // still waiting, because «الفحص الطبي» (order 2) was open beside it.
    expect(stageRank('evaluation', 1)).toBe(stageRank('evaluation', 2));
    expect(stageRank('evaluation', 3)).toBe(stageRank('evaluation', null));
  });
});

describe('isPassed — has the candidate moved on from this record?', () => {
  it('closes a decided screening once an interview exists', () => {
    const rows = [
      row({ object: 'screening', recordId: 'scr', status: 'accepted', open: false }),
      row({ object: 'interview', recordId: 'iv1', rank: stageRank('interview', 1) }),
    ];
    expect(isPassed(rows, stageRank('screening', null))).toBe(true);
    expect(isPassed(rows, stageRank('interview', 1))).toBe(false);
  });

  it('closes the first round once the second one exists', () => {
    const rows = [
      row({ object: 'interview', recordId: 'iv1', rank: stageRank('interview', 1), status: 'completed', open: false }),
      row({ object: 'interview', recordId: 'iv2', rank: stageRank('interview', 2) }),
    ];
    expect(isPassed(rows, stageRank('interview', 1))).toBe(true);
    expect(isPassed(rows, stageRank('interview', 2))).toBe(false);
  });

  it('leaves BOTH evaluation phases open — they are parallel, not sequential', () => {
    // «فُتح التقييم» twice at one minute is the security check and the medical check, which
    // `openEvaluationPhases` opens together. A rule that picked "the current stage" would close
    // whichever of them it did not pick; comparing positions closes neither.
    const rows = [
      row({ object: 'interview', recordId: 'iv1', rank: stageRank('interview', 1), status: 'completed', open: false }),
      row({ object: 'evaluation', recordId: 'sec', rank: stageRank('evaluation', 1), key: 'evaluation:sec' }),
      row({ object: 'evaluation', recordId: 'med', rank: stageRank('evaluation', 2), key: 'evaluation:med' }),
    ];
    expect(passedRecordIds(rows)).toEqual(['iv1']);
  });

  it('does not let an offer close the checks — the offer runs alongside them', () => {
    // HR starts the offer while the security check and the medical check are still waiting, and
    // those checks go on being decided afterwards. An offer row that set the frontier would have
    // made both of them read-only the moment somebody pressed «نقل لمرحلة عرض العمل».
    const rows = [
      row({ object: 'evaluation', recordId: 'sec', rank: stageRank('evaluation', 1), key: 'evaluation:sec' }),
      row({ object: 'evaluation', recordId: 'med', rank: stageRank('evaluation', 2), key: 'evaluation:med' }),
      row({ object: 'offer', recordId: 'off', status: 'waiting', key: 'jobOffer' }),
    ];
    expect(passedRecordIds(rows)).toEqual([]);
  });

  it('never closes the offer itself — nothing comes after it', () => {
    // The rulebook's deliberate late moves on an offer (withdraw an accepted one and re-offer,
    // RW3/OQ-3) must keep working without an exception written for them.
    const rows = [
      row({ object: 'interview', recordId: 'iv1', rank: stageRank('interview', 1), status: 'completed', open: false }),
      row({ object: 'evaluation', recordId: 'sec', rank: stageRank('evaluation', 1), status: 'approved', open: false, key: 'evaluation:sec' }),
      row({ object: 'offer', recordId: 'off', status: 'accepted', open: false, key: 'jobOffer' }),
    ];
    expect(isPassed(rows, stageRank('offer', null))).toBe(false);
    // The checks are the furthest GATING stage, so the round behind them is closed and they and
    // the offer are not.
    expect(passedRecordIds(rows)).toEqual(['iv1']);
  });

  it('passes nothing when the candidate holds no live record', () => {
    expect(frontierRank([])).toBeNull();
    expect(isPassed([], stageRank('screening', null))).toBe(false);
  });
});

describe('currentOf — where the candidate stands', () => {
  it('is the furthest OPEN record, on its newest attempt', () => {
    const rows = [
      row({ object: 'screening', recordId: 'scr', status: 'accepted', open: false }),
      row({ object: 'interview', recordId: 'iv-a1', rank: stageRank('interview', 1), attempt: 1, status: 'cancelled', open: false }),
      row({ object: 'interview', recordId: 'iv-a2', rank: stageRank('interview', 1), attempt: 2 }),
    ];
    expect(currentOf(rows)?.recordId).toBe('iv-a2');
  });

  it('is null once every record is decided — the candidate stands nowhere', () => {
    const rows = [
      row({ object: 'screening', recordId: 'scr', status: 'accepted', open: false }),
      row({ object: 'evaluation', recordId: 'sec', status: 'approved', open: false, rank: stageRank('evaluation', 1) }),
    ];
    expect(currentOf(rows)).toBeNull();
  });
});


describe('stageIdentityOf — which round or phase an event was about', () => {
  it('reads the round off an interview row', () => {
    expect(
      stageIdentityOf('interview', {
        stageId: 'aaaaaaaaaaaaaaaaaaaaaa11',
        stageOrder: 1,
        stageName: { ar: 'المقابلة الأولى', en: 'First interview' },
      }),
    ).toEqual({
      stageKind: 'interview',
      stageRefId: 'aaaaaaaaaaaaaaaaaaaaaa11',
      stageName: { ar: 'المقابلة الأولى', en: 'First interview' },
      stageOrder: 1,
    });
  });

  it('reads the phase off an evaluation row', () => {
    expect(
      stageIdentityOf('evaluation', {
        phaseId: 'aaaaaaaaaaaaaaaaaaaaaa22',
        phaseOrder: 2,
        phaseName: { ar: 'الفحص الأمني', en: 'Security check' },
      }).stageName,
    ).toEqual({ ar: 'الفحص الأمني', en: 'Security check' });
  });

  it('names the kind alone for a stage that has no round of its own', () => {
    expect(stageIdentityOf('screening', {})).toEqual({
      stageKind: 'screening',
      stageRefId: null,
      stageName: null,
      stageOrder: null,
    });
  });
});
