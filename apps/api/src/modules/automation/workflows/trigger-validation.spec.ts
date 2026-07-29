// Trigger validation (A-3).
//
// Every case here is a way to save a workflow that looks fine and does nothing. That is the class
// of bug this file exists to prevent, and it is the one an automation platform is worst at
// surfacing on its own: no error, no failed run, no log line — just work that never happens.
import { describe, expect, it } from 'vitest';
import { AutomationTriggerSchema } from '@ecms/contracts';
import { canEnableTrigger, triggerErrors, validateTrigger } from './trigger-validation';

const trigger = (input: Record<string, unknown>) => AutomationTriggerSchema.parse(input);

const event = (name: string, filters: Record<string, unknown>[] = []) =>
  trigger({ kind: 'event', event: name, filters });

describe('the event has to exist', () => {
  it('accepts an event the platform really publishes', () => {
    expect(triggerErrors(event('hr.employee.created'))).toEqual([]);
  });

  it('refuses one nobody publishes', () => {
    const [problem] = triggerErrors(event('hr.employee.promoted'));
    expect(problem?.path).toBe('trigger.event');
    expect(problem?.message).toContain('not an event this platform publishes');
  });

  it('refuses a plausible near-miss', () => {
    // `hr.employee.updated` is the name a person would guess; the real one is `statusChanged`.
    // Catching it here is the difference between a typo and a workflow that never fires.
    expect(triggerErrors(event('hr.employee.updated'))).toHaveLength(1);
  });

  it('stops after the event error rather than reporting fields of a non-existent payload', () => {
    const problems = validateTrigger(event('nope.nothing.here', [{ field: 'x', op: 'eq' }]));
    expect(problems).toHaveLength(1);
  });
});

describe('filters are checked against the real payload', () => {
  it('accepts a field the event actually carries', () => {
    expect(
      triggerErrors(event('hr.employee.created', [{ field: 'origin', op: 'eq', value: 'direct' }])),
    ).toEqual([]);
  });

  it('accepts a nested path', () => {
    expect(
      triggerErrors(
        event('platform.file.uploaded', [{ field: 'entityRef.moduleId', op: 'eq', value: 'hr' }]),
      ),
    ).toEqual([]);
  });

  it('refuses a field the event does not carry, and says what it does', () => {
    const [problem] = triggerErrors(
      event('hr.employee.created', [{ field: 'salary', op: 'gt', value: 1000 }]),
    );
    expect(problem?.message).toContain("'salary' is not a field of hr.employee.created");
    expect(problem?.message).toContain('employeeId');
  });

  it('refuses an enum value outside the declared set', () => {
    // `origin` is `recruitment | direct`. A filter on `transfer` matches nothing, forever.
    const [problem] = triggerErrors(
      event('hr.employee.created', [{ field: 'origin', op: 'eq', value: 'transfer' }]),
    );
    expect(problem?.message).toContain('recruitment, direct');
  });

  it('allows any value for a non-enum field', () => {
    expect(
      triggerErrors(event('hr.employee.created', [{ field: 'code', op: 'contains', value: 'EG' }])),
    ).toEqual([]);
  });

  it('allows a filter when the module has declared no payload', () => {
    // Nobody can call a filter wrong against a shape nobody has stated. Refusing here would block
    // real work over a module's omission.
    const problems = triggerErrors(
      trigger({ kind: 'event', event: 'hr.leave.requested', filters: [{ field: 'typeId', op: 'eq' }] }),
    );
    expect(problems).toEqual([]);
  });
});

describe('warnings — saveable, but the user should know', () => {
  it('warns that an event with two publishers will not match every cause', () => {
    // The recruitment engine mirrors `hr.jobOffer.sent` with the transition payload while the
    // offer service emits the entity. A filter on `applicantCode` matches one and not the other.
    const problems = validateTrigger(
      event('hr.jobOffer.sent', [{ field: 'applicantCode', op: 'eq', value: 'A-1' }]),
    );
    expect(problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(problems.map((p) => p.message).join(' ')).toContain('more than one publisher');
  });

  it('warns on an event that is declared but has no publisher', () => {
    const problems = validateTrigger(event('hr.evaluation.opened'));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.severity).toBe('warning');
    expect(problems[0]?.message).toContain('not yet published');
  });
});

describe('non-event triggers', () => {
  it('accepts a cron trigger', () => {
    expect(triggerErrors(trigger({ kind: 'cron', cron: '0 9 * * *' }))).toEqual([]);
  });

  it('refuses filters on a trigger that has no payload to filter', () => {
    // A schedule carries no event, so a filter on one is dead code that reads as a live condition.
    const [problem] = triggerErrors(
      trigger({ kind: 'cron', cron: '0 9 * * *', filters: [{ field: 'x', op: 'eq' }] }),
    );
    expect(problem?.message).toContain('no event payload to filter on');
  });

  it('accepts a manual trigger with nothing else set', () => {
    expect(triggerErrors(trigger({ kind: 'manual' }))).toEqual([]);
  });
});

describe('enabling is stricter than saving', () => {
  it('allows enabling a valid event trigger', () => {
    expect(canEnableTrigger(event('hr.employee.created')).ok).toBe(true);
  });

  it('refuses to enable a workflow on an event nobody publishes yet', () => {
    // Saveable as a draft — a team may be building ahead of the publisher — but enabling it would
    // put a permanently inert workflow into the active list, where it looks like it works.
    const verdict = canEnableTrigger(event('hr.evaluation.opened'));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('would never run');
  });

  it('refuses to enable anything with an outright error', () => {
    expect(canEnableTrigger(event('does.not.exist')).ok).toBe(false);
  });

  it('does not let a warning block enabling', () => {
    // A divergent-payload warning is information, not a defect in the workflow.
    expect(
      canEnableTrigger(event('hr.jobOffer.sent', [{ field: 'applicantCode', op: 'eq', value: 'x' }]))
        .ok,
    ).toBe(true);
  });
});
