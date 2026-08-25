// Whether a rule can ever be reached at all.
//
// Everything else in this feature is downstream of one question: is HR actually listening to the
// event the rule names? A rule saved against `hr.contract.expired` with nothing subscribed to that
// name is a row in a table. It validates, it lists, it shows "never fired", and no amount of
// reading the rule explains why — the fault is here, in a file the rule never mentions.
//
// The subscriptions are generated from the catalogue rather than listed by hand, so what these
// tests pin is the GENERATION: everything the platform can emit, minus exactly one family, all
// pointing at one handler.
import { describe, expect, it } from 'vitest';
import { eventCatalogNames, RULE_FORBIDDEN_EVENT_PREFIX } from '@ecms/contracts';
import { ruleEventSubscriptions } from './rule-subscriptions';
import { handleRuleEvent } from './rule-bridge';

const subscriptions = ruleEventSubscriptions();

describe('what the rules engine listens to', () => {
  it('covers every event the platform can emit, minus the notification family', () => {
    // Generated, not listed: a new event becomes rule-able the moment it is cataloged, with no
    // change to any file here. The count is derived the same way for the same reason — pinning a
    // literal would fail every time an unrelated module added an event.
    const expected = eventCatalogNames().filter(
      (name) => !name.startsWith(RULE_FORBIDDEN_EVENT_PREFIX),
    );
    expect(subscriptions.map((subscription) => subscription.event).sort()).toEqual(expected.sort());
  });

  it('subscribes to no notification event, whatever the save-time check does', () => {
    // Two guards, because they stop different things. The save-time refusal stops somebody
    // CREATING the loop; this stops a rule that predates the check — or one written straight into
    // the database — from finding an event to loop on.
    expect(
      subscriptions.filter((subscription) =>
        subscription.event.startsWith(RULE_FORBIDDEN_EVENT_PREFIX),
      ),
    ).toEqual([]);
    // And the family is not empty, so the filter above is actually excluding something.
    expect(
      eventCatalogNames().filter((name) => name.startsWith(RULE_FORBIDDEN_EVENT_PREFIX)).length,
    ).toBeGreaterThan(0);
  });

  it('routes every event to the one bridge, under one handler id', () => {
    // One logical consumer. The bus dedups reliable delivery on `${eventId}:${handlerId}`, so a
    // second id here would be a second delivery of every event — two notifications per rule.
    expect(new Set(subscriptions.map((subscription) => subscription.handlerId))).toEqual(
      new Set(['notificationRules.dispatch']),
    );
    expect(subscriptions.every((subscription) => subscription.handler === handleRuleEvent)).toBe(true);
  });

  it('names each event once — the bus refuses a duplicate subscription at boot', () => {
    const events = subscriptions.map((subscription) => subscription.event);
    expect(new Set(events).size).toBe(events.length);
  });

  it('does not collide with the automation trigger bridge', () => {
    // Both subscribe to the whole catalogue. Sharing a handler id would make one of them throw at
    // boot — `subscribe()` refuses a duplicate `(event, handlerId)` — and take the platform with it.
    expect(subscriptions.every((s) => s.handlerId !== 'triggers.dispatch')).toBe(true);
  });
});
