// The workflow rulebook (I13). These tests are the executable statement of what the pipeline
// permits: if a future change lets a record move somewhere it should not, one of these fails.
import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_OBJECTS,
  WORKFLOW_TRANSITIONS,
  canTransition,
  findTransition,
  statesOf,
  transitionsFrom,
  validateTransition,
  type WorkflowObject,
  type WorkflowStatus,
} from './workflow-transitions';

describe('the rulebook itself', () => {
  it('declares every workflow object', () => {
    expect(Object.keys(WORKFLOW_TRANSITIONS).sort()).toEqual([...WORKFLOW_OBJECTS].sort());
  });

  it('never declares the same move twice', () => {
    for (const object of WORKFLOW_OBJECTS) {
      const seen = WORKFLOW_TRANSITIONS[object].map((t) => `${t.from}→${t.to}`);
      expect(new Set(seen).size).toBe(seen.length);
    }
  });

  it('only allows a self-transition when it is an audited correction', () => {
    for (const object of WORKFLOW_OBJECTS) {
      for (const t of WORKFLOW_TRANSITIONS[object]) {
        if (t.from === t.to) {
          expect(t.isCorrection, `${object}: ${t.from}→${t.to}`).toBe(true);
          expect(t.requiresReason, `${object}: ${t.from}→${t.to}`).toBe(true);
        }
      }
    }
  });

  it('demands a reason for every destructive or corrective move', () => {
    const destructive = ['rejected', 'cancelled', 'withdrawn', 'superseded'];
    for (const object of WORKFLOW_OBJECTS) {
      for (const t of WORKFLOW_TRANSITIONS[object]) {
        if (destructive.includes(t.to) || t.isCorrection === true) {
          expect(t.requiresReason, `${object}: ${t.from}→${t.to}`).toBe(true);
        }
      }
    }
  });

  it('starts every stage object at waiting', () => {
    for (const object of ['screening', 'interview', 'evaluation', 'offer'] as WorkflowObject[]) {
      expect(statesOf(object)).toContain('waiting');
      expect(transitionsFrom(object, 'waiting').length).toBeGreaterThan(0);
    }
  });
});

describe('interview transitions', () => {
  it('allows the full happy path, including starting straight from the queue', () => {
    expect(canTransition('interview', 'waiting', 'scheduled')).toBe(true);
    expect(canTransition('interview', 'waiting', 'inProgress')).toBe(true);
    expect(canTransition('interview', 'scheduled', 'inProgress')).toBe(true);
    expect(canTransition('interview', 'inProgress', 'completed')).toBe(true);
  });

  it('lets a round held without pressing Start still be decided', () => {
    expect(canTransition('interview', 'scheduled', 'completed')).toBe(true);
  });

  it('refuses to resurrect a cancelled round — progress resumes on a new attempt', () => {
    expect(canTransition('interview', 'cancelled', 'scheduled')).toBe(false);
    expect(canTransition('interview', 'cancelled', 'waiting')).toBe(false);
    expect(canTransition('interview', 'cancelled', 'inProgress')).toBe(false);
  });

  it('refuses to walk backwards', () => {
    expect(canTransition('interview', 'completed', 'scheduled')).toBe(false);
    expect(canTransition('interview', 'inProgress', 'waiting')).toBe(false);
    expect(canTransition('interview', 'scheduled', 'waiting')).toBe(false);
  });

  it('allows a re-decision only as an audited correction with a reason', () => {
    const redecide = findTransition('interview', 'completed', 'completed');
    expect(redecide?.isCorrection).toBe(true);
    expect(validateTransition('interview', 'completed', 'completed', '').ok).toBe(false);
    expect(validateTransition('interview', 'completed', 'completed', 'panel erred').ok).toBe(true);
  });
});

describe('evaluation transitions', () => {
  it('decides from waiting and permits re-opening a decided phase', () => {
    expect(canTransition('evaluation', 'waiting', 'approved')).toBe(true);
    expect(canTransition('evaluation', 'waiting', 'rejected')).toBe(true);
    expect(canTransition('evaluation', 'approved', 'waiting')).toBe(true);
    expect(canTransition('evaluation', 'rejected', 'waiting')).toBe(true);
  });

  it('allows flipping a decision as a reasoned correction', () => {
    expect(validateTransition('evaluation', 'approved', 'rejected', 'result arrived').ok).toBe(true);
    expect(validateTransition('evaluation', 'approved', 'rejected').ok).toBe(false);
  });
});

describe('offer transitions', () => {
  it('walks waiting → draft → sent → accepted', () => {
    expect(canTransition('offer', 'waiting', 'draft')).toBe(true);
    expect(canTransition('offer', 'draft', 'sent')).toBe(true);
    expect(canTransition('offer', 'sent', 'accepted')).toBe(true);
  });

  it('never edits an accepted offer in place — only withdraw or supersede', () => {
    expect(canTransition('offer', 'accepted', 'draft')).toBe(false);
    expect(canTransition('offer', 'accepted', 'sent')).toBe(false);
    expect(canTransition('offer', 'accepted', 'rejected')).toBe(false);
    expect(canTransition('offer', 'accepted', 'withdrawn')).toBe(true);
    expect(canTransition('offer', 'accepted', 'superseded')).toBe(true);
  });

  it('expires only a sent offer', () => {
    expect(canTransition('offer', 'sent', 'expired')).toBe(true);
    expect(canTransition('offer', 'draft', 'expired')).toBe(false);
    expect(canTransition('offer', 'waiting', 'expired')).toBe(false);
  });

  it('lets a return-to-stage supersede any live offer', () => {
    for (const from of ['waiting', 'draft', 'sent'] as WorkflowStatus[]) {
      expect(validateTransition('offer', from, 'superseded', 'returned to interviews').ok).toBe(true);
    }
  });

  it('refuses to revive a terminal offer', () => {
    for (const from of ['rejected', 'expired', 'withdrawn', 'superseded'] as WorkflowStatus[]) {
      expect(transitionsFrom('offer', from)).toHaveLength(0);
    }
  });
});

describe('applicant transitions', () => {
  it('records the hire as a real transition rather than leaving the candidate `new`', () => {
    expect(canTransition('applicant', 'new', 'hired')).toBe(true);
  });

  it('treats hired as terminal', () => {
    expect(transitionsFrom('applicant', 'hired')).toHaveLength(0);
  });

  it('allows reactivation and restoration, each with a reason', () => {
    expect(validateTransition('applicant', 'rejected', 'new', 'decision corrected').ok).toBe(true);
    expect(validateTransition('applicant', 'withdrawn', 'new', 'candidate returned').ok).toBe(true);
    expect(validateTransition('applicant', 'rejected', 'new').ok).toBe(false);
  });
});

describe('validateTransition', () => {
  it('names the object and the states it refused', () => {
    const result = validateTransition('interview', 'completed', 'scheduled');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ILLEGAL_TRANSITION');
      expect(result.message).toContain('interview');
      expect(result.message).toContain('completed');
      expect(result.message).toContain('scheduled');
    }
  });

  it('distinguishes a missing reason from an illegal move', () => {
    const missing = validateTransition('interview', 'scheduled', 'cancelled');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('REASON_REQUIRED');
  });

  it('rejects a whitespace-only reason', () => {
    expect(validateTransition('interview', 'scheduled', 'cancelled', '   ').ok).toBe(false);
  });

  it('returns the matched transition so the engine can dispatch on its action', () => {
    const result = validateTransition('offer', 'draft', 'sent');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.transition.action).toBe('send');
  });
});
