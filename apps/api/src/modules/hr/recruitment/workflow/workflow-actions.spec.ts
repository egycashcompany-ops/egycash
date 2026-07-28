// I6/I10 — capability lives in `availableActions` and nowhere else. The load-bearing test is the
// exhaustiveness one: a transition added to the rulebook without naming its permission fails here,
// so the engine can never offer a move the UI cannot gate (or gate one the server does not check).
import { describe, expect, it } from 'vitest';
import { availableActions, permissionForAction, unmappedActions } from './workflow-actions';

describe('the action → permission mapping is total', () => {
  it('names a permission for every action the rulebook declares', () => {
    expect(unmappedActions()).toEqual([]);
  });

  it('mirrors the permission each route actually enforces', () => {
    expect(permissionForAction('screening', 'accept')).toBe('screening.decide');
    expect(permissionForAction('interview', 'cancel')).toBe('interview.cancel');
    expect(permissionForAction('offer', 'send')).toBe('jobOffer.send');
    expect(permissionForAction('offer', 'accept')).toBe('jobOffer.respond');
    expect(permissionForAction('applicant', 'withdraw')).toBe('applicant.edit');
  });

  it('answers null for a pair the table does not declare', () => {
    expect(permissionForAction('screening', 'schedule')).toBeNull();
  });
});

describe('availableActions', () => {
  const holder = { 'screening.decide': 'organization' };

  it('lists the moves the rulebook allows from the current status', () => {
    const actions = availableActions('screening', 'waiting', holder);
    expect(actions.map((a) => a.key).sort()).toEqual(['accept', 'close', 'reject']);
  });

  it('lists what the caller may NOT do, with the permission as the reason', () => {
    const actions = availableActions('screening', 'waiting', {});
    const accept = actions.find((a) => a.key === 'accept');
    expect(accept).toMatchObject({
      enabled: false,
      permission: 'screening.decide',
      reason: 'requires screening.decide',
    });
  });

  it('enables what the caller holds', () => {
    const accept = availableActions('screening', 'waiting', holder).find((a) => a.key === 'accept');
    expect(accept).toMatchObject({ enabled: true, reason: null });
  });

  // `accepted → rejected` and `rejected → accepted` are both `redecide`; a screen wants one button.
  it('collapses two edges that are the same action into one entry', () => {
    const keys = availableActions('screening', 'accepted', holder).map((a) => a.key);
    expect(keys.filter((k) => k === 'redecide')).toHaveLength(1);
  });

  it('carries the non-transition moves a candidate screen also offers', () => {
    const actions = availableActions('screening', 'waiting', holder, [
      { key: 'reassign', permission: 'applicant.reassign', enabled: false, reason: 'requires applicant.reassign' },
    ]);
    expect(actions.map((a) => a.key)).toContain('reassign');
  });

  it('is empty for a terminal state — a closed record offers nothing', () => {
    expect(availableActions('screening', 'cancelled', holder)).toEqual([]);
  });
});
