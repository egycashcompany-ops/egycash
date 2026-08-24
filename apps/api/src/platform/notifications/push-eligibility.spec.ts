// The Web Push channel's decisions, exercised as the real functions the adapter and `notify()`
// call — not as a restatement of them.
//
// Two carry consequences that are invisible where they are taken:
//
//   • WHEN A PUSH CHANNEL EXISTS AT ALL. Push is the first channel with a CAPABILITY question. Get
//     it wrong and every notification to a recipient with no registered device carries a push row
//     that delivers nothing, retries five times over a minute, and settles on `failed` — a red
//     delivery record and a `deliveryFailed` event for something they read in the app an hour
//     earlier. Across a company-wide announcement, thousands of them.
//
//   • WHEN A REGISTRATION IS DELETED. Treating a timeout as "gone" deletes a live phone that was
//     merely switched off, and the owner's only clue is that notifications quietly stopped.
//     Treating a 410 as retryable keeps a dead row forever, failing a little on every later send.
import { describe, expect, it } from 'vitest';
import { isGoneEndpoint, pushDeliverySucceeded, shouldOfferPush } from './push-eligibility';
import { MAX_PUSH_FAILURES } from './push-subscription.repository';

describe('an endpoint a push service has disowned', () => {
  it.each([404, 410])('treats %i as gone for good', (status) => {
    expect(isGoneEndpoint(status)).toBe(true);
  });

  it.each([undefined, 400, 401, 413, 429, 500, 502, 503, 504])(
    'does not treat %s as gone — the device may simply be unreachable',
    (status) => {
      expect(isGoneEndpoint(status)).toBe(false);
    },
  );

  it('forgives a device several soft failures before dropping it', () => {
    // A phone off for a weekend has to survive; an endpoint that quietly stopped answering must
    // not accumulate for ever.
    expect(MAX_PUSH_FAILURES).toBeGreaterThan(1);
    expect(MAX_PUSH_FAILURES).toBeLessThanOrEqual(10);
  });
});

describe('whether a notification gets a push channel at all', () => {
  it('does not, on a deployment with no VAPID pair', () => {
    expect(shouldOfferPush({ configured: false, hasDevice: true, preference: true })).toBe(false);
  });

  it('does not, for a recipient who has registered no device', () => {
    expect(shouldOfferPush({ configured: true, hasDevice: false, preference: null })).toBe(false);
  });

  it('does not, even when a stale preference row says they want push', () => {
    // The exact regression asking capability FIRST prevents: they enabled push on a laptop, then
    // removed that browser. The row survives; the destination does not.
    expect(shouldOfferPush({ configured: true, hasDevice: false, preference: true })).toBe(false);
  });

  it('does not, for a registered recipient who opted out', () => {
    // Having a device is capability, not consent — the opt-out still decides.
    expect(shouldOfferPush({ configured: true, hasDevice: true, preference: false })).toBe(false);
  });

  it('does, for a configured deployment and a registered recipient with no opinion', () => {
    // No preference row means the platform default, which is to allow — as for every channel.
    expect(shouldOfferPush({ configured: true, hasDevice: true, preference: null })).toBe(true);
  });

  it('does, when they have asked for it explicitly', () => {
    expect(shouldOfferPush({ configured: true, hasDevice: true, preference: true })).toBe(true);
  });
});

describe('fanning out to one person’s devices', () => {
  it('counts as delivered when any device took it', () => {
    // The laptop buzzed. Retrying for the phone that has been off since Friday would re-push to
    // the laptop, five times, at widening intervals.
    expect(pushDeliverySucceeded([false, true])).toBe(true);
    expect(pushDeliverySucceeded([true, false, false])).toBe(true);
  });

  it('fails only when none did', () => {
    expect(pushDeliverySucceeded([false, false])).toBe(false);
  });

  it('fails when there were no devices to try', () => {
    // Not reachable through `notify()` — the capability check keeps the channel off — but the
    // adapter can still meet it if the last device is removed between creation and delivery.
    expect(pushDeliverySucceeded([])).toBe(false);
  });
});
