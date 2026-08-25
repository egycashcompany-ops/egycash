// Where a notification takes you when you act on it.
//
// SHARED ON PURPOSE, and it is the whole reason this is a contract rather than a helper on either
// side. The same notification is actionable from two places — the push on a lock screen and the
// bell inside the app — and a person who taps one and clicks the other expects to arrive at the
// same screen. Two implementations of "where does this go?" is how they start to differ, and the
// difference is invisible to whoever writes either one.
//
// A notification names its subject as an `entityRef`, which is a STORAGE fact: module, type, id.
// A route is a UI fact. This is the one place that maps between them, so adding a screen for an
// entity means changing one table rather than hunting for every place that links to it.
import { type EntityRef } from '../common/index.js';

/**
 * The inbox — where a notification is readable as itself.
 *
 * Not a fallback in the apologetic sense. For an announcement or a rule's message the text IS the
 * content: there is no record behind it to open, and sending somebody to a list of announcements
 * they cannot read their own copy in would be worse than the inbox, not better.
 */
export const NOTIFICATIONS_INBOX_PATH = '/notifications';

/** The inbox, scrolled to one notification. */
export const notificationInboxPath = (notificationId: string): string =>
  `${NOTIFICATIONS_INBOX_PATH}?focus=${encodeURIComponent(notificationId)}`;

/**
 * Entities with a screen of their own, and the route that shows one.
 *
 * Keyed `moduleId/entityType` because neither half is unique alone — `platform/user` and a future
 * `hr/user` are different things, and the pair is exactly what an `entityRef` carries.
 *
 * Every route here is one the client actually declares. An entry pointing at a path no router
 * matches sends people to a blank page, which is worse than the inbox in every case.
 */
const ENTITY_ROUTES: Readonly<Record<string, (entityId: string) => string>> = {
  'hr/employee': (id) => `/employees/${id}`,
  'hr/contract': (id) => `/contracts/${id}`,
  'platform/user': (id) => `/system/users/${id}`,
  // The day record has no page of its own; the daily board is where somebody would go to act on it.
  'hr/attendanceDay': () => '/attendance/daily',
};

/**
 * Where acting on this notification should land.
 *
 * Falls back to the inbox rather than to the home page. "It opened the app" is not an answer to
 * "what was that about?" — the person tapped a specific notification and the least they are owed
 * is that notification, readable, with the rest of it in view.
 */
export const notificationTargetPath = (
  entityRef: EntityRef | null | undefined,
  notificationId: string,
): string => {
  if (entityRef === null || entityRef === undefined) return notificationInboxPath(notificationId);
  const route = ENTITY_ROUTES[`${entityRef.moduleId}/${entityRef.entityType}`];
  if (route === undefined) return notificationInboxPath(notificationId);

  // An id that is not one cannot build a route — a seeded ref, a signal name where an id belongs
  // (`platform/security` carries one). The inbox is a real destination; `/employees/undefined` is not.
  const entityId = entityRef.entityId;
  if (typeof entityId !== 'string' || entityId.trim() === '') {
    return notificationInboxPath(notificationId);
  }
  return route(encodeURIComponent(entityId));
};
