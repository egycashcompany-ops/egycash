// One subscription per cataloged event, all pointing at the rule bridge.
//
// Generated from the catalogue rather than hand-listed, exactly as automation's is: rules stay
// subscribed to precisely what the platform can emit, so a new event becomes rule-able the moment
// it is cataloged and no name that nobody publishes is ever subscribed to.
//
// The notification family is filtered out here as well as refused at save time. Both, because they
// stop different things: the save-time refusal stops somebody CREATING the loop, and this stops a
// rule that predates the check — or one written straight into the database — from finding an
// event to loop on. A cycle that reaches real phones is worth two guards.
import { eventCatalogNames, isRuleTriggerable } from '@ecms/contracts';
import { type EventSubscription } from '../../../platform/kernel/module-registry';
import { handleRuleEvent } from './rule-bridge';

export const ruleEventSubscriptions = (): EventSubscription[] =>
  eventCatalogNames()
    .filter(isRuleTriggerable)
    .map((event) => ({
      event,
      // The same handlerId on every event: the bus dedups reliable delivery on
      // `${eventId}:${handlerId}`, and one logical consumer ("the rule bridge") is what this is.
      handlerId: 'notificationRules.dispatch',
      handler: handleRuleEvent,
    }));
