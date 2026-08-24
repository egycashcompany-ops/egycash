// What a rule decides, without a database, a bus or a notification.
//
// A rule engine fails in ways nobody reports. It fires when it should not (noise nobody traces
// back to a rule), it stays silent when it should fire (a notification that simply never came),
// or it names the wrong people. None of those raises anything, and all of them are decided by the
// pure functions here.
//
// The one that must never happen is an exception. A rule is evaluated INSIDE an event's delivery,
// downstream of a business transaction that already committed — a throw here would travel into an
// event the rest of the platform is still trying to deliver. So every way a payload can disappoint
// has to resolve to "this rule tells nobody this time".
import { describe, expect, it } from 'vitest';
import { isRuleTriggerable, RULE_FORBIDDEN_EVENT_PREFIX } from '@ecms/contracts';
import {
  flattenPayload,
  renderRuleText,
  ruleFires,
  subjectEmployeeIds,
  valueAt,
} from './rule-matching';

const id = (n: number): string => n.toString(16).padStart(24, '0');
const rule = (over: Partial<Parameters<typeof ruleFires>[0]> = {}) => ({
  enabled: true,
  event: 'hr.leave.decided',
  filters: [],
  ...over,
});

describe('a rule that must never exist', () => {
  it('cannot trigger on a notification event', () => {
    // The loop is one dropdown selection away: a rule sends a notification, creating one emits
    // `platform.notification.created`, and a rule on THAT answers its own output for ever — at
    // machine speed, on real people's phones.
    expect(isRuleTriggerable('platform.notification.created')).toBe(false);
    expect(isRuleTriggerable('platform.notification.deliveryFailed')).toBe(false);
    expect(RULE_FORBIDDEN_EVENT_PREFIX).toBe('platform.notification.');
  });

  it('but may trigger on everything else the platform emits', () => {
    for (const name of ['hr.leave.decided', 'hr.contract.expired', 'platform.user.created']) {
      expect(isRuleTriggerable(name), name).toBe(true);
    }
  });
});

describe('whether a rule fires', () => {
  it('does not, when it is switched off', () => {
    expect(ruleFires(rule({ enabled: false }), 'hr.leave.decided', {})).toBe(false);
  });

  it('stays off even when its conditions would have matched', () => {
    // The state somebody deliberately chose beats the state the data happens to be in.
    const disabled = rule({
      enabled: false,
      filters: [{ field: 'status', op: 'eq' as const, value: 'approved' }],
    });
    expect(ruleFires(disabled, 'hr.leave.decided', { status: 'approved' })).toBe(false);
  });

  it('does not, for a different event', () => {
    expect(ruleFires(rule(), 'hr.leave.requested', {})).toBe(false);
  });

  it('does, for its own event with no conditions', () => {
    expect(ruleFires(rule(), 'hr.leave.decided', { status: 'rejected' })).toBe(true);
  });

  it('honours the conditions when there are some', () => {
    const approved = rule({ filters: [{ field: 'status', op: 'eq' as const, value: 'approved' }] });
    expect(ruleFires(approved, 'hr.leave.decided', { status: 'approved' })).toBe(true);
    expect(ruleFires(approved, 'hr.leave.decided', { status: 'rejected' })).toBe(false);
  });

  it('requires EVERY condition, not any of them', () => {
    const both = rule({
      filters: [
        { field: 'status', op: 'eq' as const, value: 'approved' },
        { field: 'kind', op: 'eq' as const, value: 'annual' },
      ],
    });
    expect(ruleFires(both, 'hr.leave.decided', { status: 'approved', kind: 'annual' })).toBe(true);
    expect(ruleFires(both, 'hr.leave.decided', { status: 'approved', kind: 'sick' })).toBe(false);
  });
});

describe('the message the payload fills in', () => {
  it('flattens a payload to the paths the event catalogue names', () => {
    // The placeholder somebody types has to be the field name the picker showed them.
    expect(flattenPayload({ entityRef: { entityId: 'x' }, status: 'approved' })).toEqual({
      'entityRef.entityId': 'x',
      status: 'approved',
    });
  });

  it('renders scalars only — an object has no place in a sentence', () => {
    // `[object Object]` in a notification is worse than the placeholder left standing.
    expect(flattenPayload({ list: [1, 2], when: 3, ok: true })).toEqual({ when: '3', ok: 'true' });
  });

  it('leaves an unmatched placeholder standing rather than blanking it', () => {
    // A typo has to be visible in the one place somebody will look — the notification itself.
    expect(renderRuleText('عقد {{employeeNam}} انتهى', { employeeName: 'أحمد' })).toBe(
      'عقد {{employeeNam}} انتهى',
    );
  });

  it('fills the ones it knows', () => {
    expect(renderRuleText('{{name}} — {{status}}', { name: 'أحمد', status: 'approved' })).toBe(
      'أحمد — approved',
    );
  });

  it('reads a nested value by its dotted path', () => {
    expect(valueAt({ a: { b: { c: 7 } } }, 'a.b.c')).toBe(7);
    expect(valueAt({ a: 1 }, 'a.b.c')).toBeUndefined();
  });
});

describe('the person an event is about', () => {
  it('reads an employee id out of the payload', () => {
    expect(subjectEmployeeIds({ employeeId: id(1) }, 'employeeId')).toEqual([id(1)]);
  });

  it('takes every id when the field holds several', () => {
    expect(subjectEmployeeIds({ ids: [id(1), id(2)] }, 'ids')).toEqual([id(1), id(2)]);
  });

  it.each([
    ['an absent path', {}, 'employeeId'],
    ['a null value', { employeeId: null }, 'employeeId'],
    ['an object', { employeeId: { id: 1 } }, 'employeeId'],
    ['a number', { employeeId: 42 }, 'employeeId'],
    ['a string that is not an id', { employeeId: 'nobody' }, 'employeeId'],
    ['a path into a scalar', { employeeId: 'x' }, 'employeeId.deeper'],
  ])('tells nobody, quietly, for %s', (_what, payload, path) => {
    // Every one of these is a rule pointed at the wrong field. It must mean "nobody this time" —
    // never a throw, which would travel into an event the platform is still delivering.
    expect(() => subjectEmployeeIds(payload, path)).not.toThrow();
    expect(subjectEmployeeIds(payload, path)).toEqual([]);
  });
});
