// I14 — lifecycle ≠ workflow. These tests pin the boundary: which stage transitions constitute a
// business outcome, and — more importantly — which deliberately do not.
import { describe, expect, it } from 'vitest';
import {
  LIFECYCLE_EVENTS,
  LIFECYCLE_RULES,
  RETURN_TO_STAGE_LIFECYCLE_EFFECT,
  lifecycleEffectOf,
  validateLifecycleEvent,
} from './workflow-lifecycle';
import { STAGE_OBJECTS, type StageObject, type WorkflowStatus } from './workflow-transitions';

describe('the closed set of lifecycle events', () => {
  it('is exactly hire, permanent rejection, withdrawal and reactivation', () => {
    expect([...LIFECYCLE_EVENTS].sort()).toEqual(
      ['hire', 'permanentRejection', 'reactivation', 'withdrawal'].sort(),
    );
  });

  it('only ever lands on one of the four outcome states', () => {
    for (const event of LIFECYCLE_EVENTS) {
      expect(['new', 'hired', 'rejected', 'withdrawn']).toContain(LIFECYCLE_RULES[event].to);
    }
  });

  it('demands a reason for everything except the hire', () => {
    expect(LIFECYCLE_RULES.hire.requiresReason).toBe(false);
    expect(LIFECYCLE_RULES.permanentRejection.requiresReason).toBe(true);
    expect(LIFECYCLE_RULES.withdrawal.requiresReason).toBe(true);
    expect(LIFECYCLE_RULES.reactivation.requiresReason).toBe(true);
  });
});

describe('which stage transitions raise a lifecycle event', () => {
  it('treats a stage rejection as a permanent rejection', () => {
    expect(lifecycleEffectOf('screening', 'rejected')).toBe('permanentRejection');
    expect(lifecycleEffectOf('evaluation', 'rejected')).toBe('permanentRejection');
    expect(lifecycleEffectOf('interview', 'completed', 'failed')).toBe('permanentRejection');
  });

  it('treats forward progress as no lifecycle event at all', () => {
    expect(lifecycleEffectOf('screening', 'accepted')).toBeNull();
    expect(lifecycleEffectOf('interview', 'scheduled')).toBeNull();
    expect(lifecycleEffectOf('interview', 'inProgress')).toBeNull();
    expect(lifecycleEffectOf('interview', 'completed', 'passed')).toBeNull();
    expect(lifecycleEffectOf('evaluation', 'approved')).toBeNull();
    expect(lifecycleEffectOf('offer', 'draft')).toBeNull();
    expect(lifecycleEffectOf('offer', 'sent')).toBeNull();
  });

  it('does NOT reject the person when they decline the offer', () => {
    // Declining a package says nothing about the candidate — HR may revise and re-offer.
    expect(lifecycleEffectOf('offer', 'rejected')).toBeNull();
  });

  it('leaves the lifecycle alone for every other terminal offer state', () => {
    for (const to of ['withdrawn', 'expired', 'superseded', 'accepted'] as WorkflowStatus[]) {
      expect(lifecycleEffectOf('offer', to), to).toBeNull();
    }
  });

  it('never hires as a side effect of a stage transition — the hire is its own event', () => {
    for (const object of STAGE_OBJECTS) {
      for (const to of ['waiting', 'accepted', 'approved', 'completed', 'sent'] as WorkflowStatus[]) {
        expect(lifecycleEffectOf(object as StageObject, to, 'passed')).not.toBe('hire');
      }
    }
  });

  it('never reactivates as a side effect — reactivation is always explicit', () => {
    for (const object of STAGE_OBJECTS) {
      for (const to of ['waiting', 'accepted', 'approved', 'completed'] as WorkflowStatus[]) {
        expect(lifecycleEffectOf(object as StageObject, to, 'passed')).not.toBe('reactivation');
      }
    }
  });

  it('an interview completed with an undecided outcome is not a rejection', () => {
    expect(lifecycleEffectOf('interview', 'completed', 'pending')).toBeNull();
    expect(lifecycleEffectOf('interview', 'completed', null)).toBeNull();
  });
});

describe('returning between stages', () => {
  it('is never a lifecycle event — the guarantee I14 exists for', () => {
    expect(RETURN_TO_STAGE_LIFECYCLE_EFFECT).toBeNull();
  });

  it('materializing a waiting record raises nothing either', () => {
    for (const object of STAGE_OBJECTS) {
      expect(lifecycleEffectOf(object as StageObject, 'waiting')).toBeNull();
    }
  });
});

describe('validateLifecycleEvent', () => {
  it('hires only a live candidate', () => {
    expect(validateLifecycleEvent('hire', 'new').ok).toBe(true);
    expect(validateLifecycleEvent('hire', 'rejected').ok).toBe(false);
    expect(validateLifecycleEvent('hire', 'withdrawn').ok).toBe(false);
    expect(validateLifecycleEvent('hire', 'hired').ok).toBe(false);
  });

  it('rejects or withdraws only from the live state', () => {
    expect(validateLifecycleEvent('permanentRejection', 'new', 'failed security').ok).toBe(true);
    expect(validateLifecycleEvent('permanentRejection', 'hired', 'x').ok).toBe(false);
    expect(validateLifecycleEvent('withdrawal', 'new', 'took another job').ok).toBe(true);
  });

  it('reactivates only someone who left the pipeline, and only with a reason', () => {
    expect(validateLifecycleEvent('reactivation', 'rejected', 'decision corrected').ok).toBe(true);
    expect(validateLifecycleEvent('reactivation', 'withdrawn', 'candidate returned').ok).toBe(true);
    expect(validateLifecycleEvent('reactivation', 'new', 'nonsense').ok).toBe(false);
    expect(validateLifecycleEvent('reactivation', 'rejected').ok).toBe(false);
  });

  it('never reactivates someone already hired', () => {
    expect(validateLifecycleEvent('reactivation', 'hired', 'reason').ok).toBe(false);
  });

  it('distinguishes an illegal transition from a missing reason', () => {
    const illegal = validateLifecycleEvent('hire', 'withdrawn');
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.code).toBe('ILLEGAL_LIFECYCLE_TRANSITION');

    const noReason = validateLifecycleEvent('withdrawal', 'new');
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.code).toBe('REASON_REQUIRED');
  });
});
