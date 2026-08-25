// Where a notification takes you — the one question two surfaces must answer identically.
//
// A person taps a push on their lock screen, and later clicks the same notification in the bell.
// Arriving at two different screens is the defect this file exists to prevent, and it is one
// nobody reports: each half looks correct to whoever wrote it.
//
// The other property under test is that there is ALWAYS a destination. "It opened the app" is not
// an answer to "what was that about?" — every path here has to land somewhere the notification is
// actually readable.
import { describe, expect, it } from 'vitest';
import {
  NOTIFICATIONS_INBOX_PATH,
  notificationInboxPath,
  notificationTargetPath,
} from './notification-target.js';

const ID = '65b0000000000000000000ff';

describe('a notification about a record with a screen', () => {
  it.each([
    ['hr', 'employee', '/employees/'],
    ['hr', 'contract', '/contracts/'],
    ['platform', 'user', '/system/users/'],
  ])('opens the %s/%s record itself', (moduleId, entityType, prefix) => {
    expect(notificationTargetPath({ moduleId, entityType, entityId: ID }, 'n1')).toBe(
      `${prefix}${ID}`,
    );
  });

  it('opens the board for a record that has no page of its own', () => {
    expect(
      notificationTargetPath({ moduleId: 'hr', entityType: 'attendanceDay', entityId: ID }, 'n1'),
    ).toBe('/attendance/daily');
  });
});

describe('a notification whose text IS the content', () => {
  it.each([
    ['hr', 'announcement'],
    ['hr', 'notificationRule'],
  ])('opens the inbox at itself for %s/%s', (moduleId, entityType) => {
    // There is no record behind an announcement or a rule's message to open. Sending somebody to
    // a list they cannot read their own copy in would be worse than the inbox, not better.
    expect(notificationTargetPath({ moduleId, entityType, entityId: ID }, 'n7')).toBe(
      `${NOTIFICATIONS_INBOX_PATH}?focus=n7`,
    );
  });
});

describe('the destination is never the front door', () => {
  it.each([
    ['an unmapped entity', { moduleId: 'fleet', entityType: 'vehicle', entityId: ID }],
    ['a missing ref', null],
    ['an undefined ref', undefined],
    ['an empty id', { moduleId: 'hr', entityType: 'employee', entityId: '' }],
    ['a whitespace id', { moduleId: 'hr', entityType: 'employee', entityId: '   ' }],
  ])('falls back to the inbox for %s', (_what, ref) => {
    // `/` would be the easy answer and it is the one the user actually complained about: the app
    // opens, and the thing that buzzed is nowhere.
    const target = notificationTargetPath(ref as never, 'n9');
    expect(target).toBe(`${NOTIFICATIONS_INBOX_PATH}?focus=n9`);
    expect(target.startsWith(NOTIFICATIONS_INBOX_PATH)).toBe(true);
  });

  it('never builds a route around an id it does not have', () => {
    // `/employees/undefined` renders a blank page and looks like a broken record rather than a
    // missing link — worse than the inbox in every case.
    const target = notificationTargetPath(
      { moduleId: 'hr', entityType: 'employee', entityId: '' },
      'n9',
    );
    expect(target).not.toContain('undefined');
    expect(target).not.toMatch(/\/employees\/?$/);
  });
});

describe('the path is safe to put in a URL', () => {
  it('escapes an id that would otherwise change the route', () => {
    const target = notificationTargetPath(
      { moduleId: 'hr', entityType: 'employee', entityId: '../../system/users' },
      'n1',
    );
    expect(target).toBe('/employees/..%2F..%2Fsystem%2Fusers');
  });

  it('escapes the focused id in the query', () => {
    expect(notificationInboxPath('a b&c=d')).toBe(
      `${NOTIFICATIONS_INBOX_PATH}?focus=a%20b%26c%3Dd`,
    );
  });

  it('always returns an app-relative path', () => {
    // The service worker refuses anything that does not start with `/` and silently falls back to
    // the base — so a resolver that returned an absolute URL would be quietly ignored.
    for (const ref of [
      { moduleId: 'hr', entityType: 'employee', entityId: ID },
      { moduleId: 'hr', entityType: 'announcement', entityId: ID },
      { moduleId: 'nope', entityType: 'nope', entityId: ID },
    ]) {
      expect(notificationTargetPath(ref, 'n1').startsWith('/')).toBe(true);
    }
  });
});
