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

## Decision

1. **The window is the organization setting `auth.session.idleMinutes`.** It sits under «عام» →
   «الدخول وكلمات المرور», beside the password and lockout settings. Changing it is audited
   (`settingChanged`, old and new value) like any other setting.
2. **The default is 30 minutes.** It applies wherever no value has been saved, production included.
3. **The range is 10 to 1440 minutes.** There is no value that switches the rule off.
4. **It is read at every sign-in and every renewal.** The renewal judges the session by the value
   it read, and sends the browser that same value. The settings cache holds a value for at most a
   minute, so a change reaches open screens at their next renewal after that, with no deploy.
5. **The deployment variable is retired.** `SESSION_IDLE_MINUTES` is no longer read; if an
   environment still sets it, it is ignored.

## Why the floor is ten minutes

A browser learns a new window only at its next renewal. Until then it renews on the cadence of the
window it was last told. That cadence is half the window, but never slower than every five minutes
(`RENEW_AT_MOST_EVERY_MS` in `idle-session.ts`).

So when the setting is lowered, the server can see a working session whose last renewal is up to
five minutes old, and it judges that session by the new window. Any window of ten minutes or more
is still open at that point, whatever the old value was. A smaller one could sign out someone who
is working, at their first renewal after the change. A web test reads the floor from the API's
declaration and checks it against the cadence, so the two cannot drift apart.

## Alternatives considered

- **Keep the variable and add the setting on top of it.** Two places for one number. A reader of
  either one could not tell which is in force.
- **Allow `0` to switch the rule off.** A settings page is open to every holder of `setting.edit`,
  and this is a security control. The lockout settings already have floors above zero for the same
  reason. 1440 minutes is the longest allowed window.
- **Allow windows under ten minutes, and record on each session the window it was last told.** The
  server would then judge each renewal by the longer of the two windows. That is a new session
  field and a second rule for something nobody asked for. Ten minutes was the old default.

## Consequences

- After the deploy, every session runs at 30 minutes. A screen that last renewed under the old
  10-minute window renews on the same five-minute cadence and learns 30 at that renewal.
- Sessions that the 10-minute window would have closed between 10 and 30 minutes of inactivity now
  stay open. The owner chose that.
- A test environment can no longer switch the rule off with a variable. Tests move `lastUsedAt`
  instead, as they already did.
