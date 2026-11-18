# ADR-039: The inactivity sign-out window is a setting, from 10 to 1440 minutes

**Status:** Accepted · **Date:** 2026-11-18 · **Relates to:**
[security architecture](../06-security/security-architecture.md) §1 (inactivity timeout),
[ADR-015](ADR-015-single-organization-model.md) (settings hierarchy)

## Context

Sessions that nobody uses are closed at their next renewal (security architecture §1). The window
was the deployment variable `SESSION_IDLE_MINUTES`: 10 minutes by default, `0` to switch the rule
off. Production never set it, so it ran at 10 minutes. To change it, someone had to edit the
service's variables on Railway and wait for a redeploy.

The owner looked for it on the settings page and did not find it: «فين أقدر أتحكم فى المدة اللى
بعدها بيحصل تسجيل خروج لو محدش بيستخدم الحساب الخاص بيه؟ دورت هنا ملقيتش /system/settings?dept=general».
They then decided: «ضيفها في صفحة الإعدادات وخليها 30 دقيقة» (2026-11-18).

Two things that were safe with a fixed 10-minute window are not safe with a value anyone holding
`setting.edit` can change, or with a window longer than the 15-minute access token. An independent
review of the first version of this change found both:

- **A lowered value would close a screen that is still counting down.** A screen learns the window
  only at a renewal, and it renews only after activity. Suppose a screen was told 30 and has been
  idle for 15 minutes when the value drops to 10. The server would close the session at the next
  renewal, while the screen still shows 15 minutes left. There would be no warning, and an unsaved
  form would be lost.
- **Background requests would hold an abandoned screen open.** A request that meets an expired
  access token renews the session silently, for example the notification badge polling every
  minute. Every renewal moved `lastUsedAt`, the clock the rule reads. With a window longer than the
  token's 15 minutes, those renewals came in time, so the server never closed the session by itself.

## Decision

1. **The window is the organization setting `auth.session.idleMinutes`.** It sits under «عام» →
   «الدخول وكلمات المرور», beside the password and lockout settings. Changing it is audited
   (`settingChanged`, old and new value) like any other setting.
2. **The default is 30 minutes.** It applies wherever no value has been saved, production included.
3. **The range is 10 to 1440 minutes.** There is no value that switches the rule off.
4. **It is read at every sign-in and every renewal, and sent back with it.** Saving the setting
   clears its cache entry, so the next sign-in or renewal anywhere reads the new value, with no
   deploy.
5. **A renewal is judged by the window its screen was last told, when that is the longer one.**
   The session stores that value (`sessions.idleMinutesTold`) at sign-in and at every renewal, so
   the server judges a renewal by `max(current, told)`.
   - A raised value applies at once.
   - A lowered value applies to a session from the renewal that tells its screen.

   So the countdown on screen and the server's rule are the same number again from that renewal
   on. Sessions from before the field are judged by the current value: they were told 10, which
   is the floor.
6. **Only a person moves the inactivity clock.** `POST /auth/refresh` takes
   `{ presence: boolean }` (`RefreshSessionSchema`).
   - **Presence renewals:** the browser's activity renewal, «stay signed in», and a page load.
   - **`presence: false`:** a renewal that a request needed after it met an expired token.
   - **No body:** counts as a person. This is what every browser sent before the field, so a page
     left open across the deploy keeps its session while it is used.

   All of them rotate the token and tell the window. Only a person's renewal moves `lastUsedAt`.
   In the browser, a person's renewal that is asked for while a request's renewal is in flight
   waits for it and then runs. It never shares that flight, and the two never run side by side.
7. **The deployment variable is retired.** `SESSION_IDLE_MINUTES` is no longer read; if an
   environment still sets it, it is ignored.

## Why the floor is ten minutes

A working browser renews every half window, but never less often than every five minutes
(`RENEW_AT_MOST_EVERY_MS` in `idle-session.ts`). At ten minutes or more, every allowed window
renews on that same five-minute cadence. The server's clock for a person at work is then never
more than half the window old. Ten was also the old default, and below it the one-minute warning
would take up a large part of the window. A web test reads the floor from the API's declaration
and checks it against the cadence, so the two cannot drift apart.

Lowering the value is made safe by decision 5, not by the floor.

## Alternatives considered

- **Keep the variable and add the setting on top of it.** Two places for one number. A reader of
  either one could not tell which is in force.
- **Allow `0` to switch the rule off.** A settings page is open to every holder of `setting.edit`,
  and this is a security control. The lockout settings already have floors above zero for the same
  reason. 1440 minutes is the longest allowed window.
- **Judge every renewal by the current value only.** This is simpler, and it is what the first
  version of this change did. It closes a screen before its countdown ends (see Context).
- **Report the time since the last activity on every renewal, and set `lastUsedAt` from it.** The
  server's clock would then follow real activity exactly. But the server's deadline would fall on
  the browser's own deadline, so a «stay signed in» pressed in the last second could race it and
  lose. Today `lastUsedAt` is the time of the last renewal, which is a little later than the last
  activity, and the browser always reaches its deadline first.
- **Stop background requests from renewing at all.** A screen in use would then have to wait for
  the next activity renewal before a request could carry on after its token expired.

## Consequences

- After the deploy, every session runs at 30 minutes. A screen that last renewed under the old
  10-minute window renews on the same five-minute cadence and learns 30 at that renewal.
- Sessions that the 10-minute window would have closed between 10 and 30 minutes of inactivity now
  stay open. The owner chose that.
- A screen already left idle when the value is **raised** learns the new value only at its next
  renewal. If nobody comes back and no request renews it first, it still closes at the shorter
  value it was shown, with the usual warning.
- A test environment can no longer switch the rule off with a variable. Tests move `lastUsedAt`
  instead, as they already did.
