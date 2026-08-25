// A push has to land on the thing that buzzed.
//
// This shipped as `url: '/'` — a literal, directly under a comment promising "the entity the
// notification is about, when there is one". The push arrived, the person tapped it, and ECMS
// opened on the home screen with no trace of what had just been announced. Nothing errored;
// nothing was logged; the notification looked delivered because it was.
//
// The regression is one keystroke away at all times, so it is pinned here rather than left to
// review: the assertion is that the payload's URL comes from the SHARED resolver the in-app bell
// uses — not that it happens to be a nice-looking string today.
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { notificationTargetPath, type EntityRef } from '@ecms/contracts';
import { buildPushPayload } from './channel-adapters/push.adapter';
import { type NotificationDoc } from './notification.model';

const notification = (entityRef: EntityRef): NotificationDoc =>
  ({
    _id: new Types.ObjectId(),
    entityRef,
    category: 'hr',
    priority: 'normal',
  }) as NotificationDoc;

const rendered = {
  subject: { ar: 'عنوان', en: 'Title' },
  body: { ar: 'نص', en: 'Body' },
};

describe('where a push lands', () => {
  it('opens the record the notification is about', () => {
    const employeeId = new Types.ObjectId().toHexString();
    const doc = notification({ moduleId: 'hr', entityType: 'employee', entityId: employeeId });
    expect(buildPushPayload(doc, rendered, 'ar').url).toBe(`/employees/${employeeId}`);
  });

  it('opens the inbox when the message IS the content', () => {
    // An announcement has no record behind it to open. The inbox is where it can be read.
    const doc = notification({
      moduleId: 'hr',
      entityType: 'announcement',
      entityId: new Types.ObjectId().toHexString(),
    });
    expect(buildPushPayload(doc, rendered, 'ar').url).toBe(
      `/notifications?focus=${String(doc._id)}`,
    );
  });

  it('is never the front door — that is the bug this file exists for', () => {
    for (const ref of [
      { moduleId: 'hr', entityType: 'announcement', entityId: 'x' },
      { moduleId: 'hr', entityType: 'notificationRule', entityId: 'x' },
      { moduleId: 'platform', entityType: 'security', entityId: 'passwordChanged' },
      { moduleId: 'nothing', entityType: 'mapped', entityId: 'x' },
    ] satisfies EntityRef[]) {
      expect(buildPushPayload(notification(ref), rendered, 'ar').url, ref.entityType).not.toBe('/');
    }
  });

  it('agrees with the in-app bell, for every kind of notification', () => {
    // The property that matters: tapping a push and clicking the same notification inside ECMS
    // arrive at the same screen. Two implementations of that is how they start to differ.
    for (const ref of [
      { moduleId: 'hr', entityType: 'employee', entityId: new Types.ObjectId().toHexString() },
      { moduleId: 'hr', entityType: 'contract', entityId: new Types.ObjectId().toHexString() },
      { moduleId: 'hr', entityType: 'announcement', entityId: 'a1' },
      { moduleId: 'platform', entityType: 'user', entityId: new Types.ObjectId().toHexString() },
      { moduleId: 'unknown', entityType: 'thing', entityId: 'z' },
    ] satisfies EntityRef[]) {
      const doc = notification(ref);
      expect(buildPushPayload(doc, rendered, 'ar').url).toBe(
        notificationTargetPath(ref, String(doc._id)),
      );
    }
  });

  it('sends a url the service worker will actually honour', () => {
    // `sw.js` ignores anything that does not start with `/` and silently falls back to the base —
    // so an absolute URL here would look correct and behave exactly like the bug.
    const doc = notification({ moduleId: 'hr', entityType: 'announcement', entityId: 'a1' });
    expect(buildPushPayload(doc, rendered, 'ar').url.startsWith('/')).toBe(true);
  });
});
