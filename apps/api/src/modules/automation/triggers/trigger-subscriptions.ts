// One subscription per cataloged event, all pointing at the trigger bridge (design §3.1).
//
// Generated from the event catalogue rather than hand-listed, so automation stays subscribed to
// exactly what the platform can emit — no more (a name nobody publishes), no less (a new event
// that would otherwise be un-automatable until someone remembered to add it here). When Fleet or
// Treasury lands, its events become automatable with no change to this file.
import { eventCatalogNames } from '@ecms/contracts';
import { type EventSubscription } from '../../../platform/kernel/module-registry';
import { handleTriggerEvent } from './trigger-bridge';

export const triggerEventSubscriptions = (): EventSubscription[] =>
  eventCatalogNames().map((event) => ({
    event,
    // Same handlerId across every event: the bus dedups reliable delivery on `${eventId}:${handlerId}`,
    // and one logical consumer ("the trigger bridge") is what this is.
    handlerId: 'triggers.dispatch',
    handler: handleTriggerEvent,
  }));
