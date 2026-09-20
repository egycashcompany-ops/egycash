// The inactivity rule, decided by arithmetic rather than by a timer.
//
// There is no jsdom in this suite, so the dialog and the listeners cannot be exercised by
// clicking. What CAN be pinned exhaustively is every decision they make, and this file is that:
// when the warning appears, when the session is over, and — the one that matters most — when the
// browser is allowed to tell the server that somebody is still here.
import { describe, expect, it } from 'vitest';
import {
  idleStateAt,
  renewEveryMs,
  secondsLeft,
  shouldRenew,
  warningWindowMs,
  RENEW_AT_MOST_EVERY_MS,
  WARN_BEFORE_MS,
} from './idle-session';

const MINUTE = 60_000;
const TEN_MINUTES = 10 * MINUTE;
const NOW = 1_800_000_000_000;

describe('where a session stands', () => {
  it('is active while somebody has touched it inside the window', () => {
    const state = idleStateAt({ lastActivityAt: NOW - MINUTE, now: NOW, idleMs: TEN_MINUTES });
    expect(state.phase).toBe('active');
    expect(state.msLeft).toBe(9 * MINUTE);
  });

  it('warns for the last minute, and not a second before', () => {
    // 61 seconds left is still ordinary use — no dialog.
    expect(
      idleStateAt({ lastActivityAt: NOW - (TEN_MINUTES - 61_000), now: NOW, idleMs: TEN_MINUTES })
        .phase,
    ).toBe('active');
    // 60 seconds left is the warning, exactly.
    expect(
      idleStateAt({
        lastActivityAt: NOW - (TEN_MINUTES - WARN_BEFORE_MS),
        now: NOW,
        idleMs: TEN_MINUTES,
      }).phase,
    ).toBe('warning');
  });

  it('is over the moment the window has passed, and stays over', () => {
    for (const age of [TEN_MINUTES + 1, TEN_MINUTES + MINUTE, TEN_MINUTES * 100]) {
      const state = idleStateAt({ lastActivityAt: NOW - age, now: NOW, idleMs: TEN_MINUTES });
      expect(state.phase, `${String(age)}ms of silence`).toBe('expired');
      expect(state.msLeft).toBe(0);
    }
  });

  it('never expires when the deployment has no window', () => {
    for (const idleMs of [0, -1, Number.NaN]) {
      const state = idleStateAt({ lastActivityAt: NOW - 10 * TEN_MINUTES, now: NOW, idleMs });
      expect(state.phase, `idleMs=${String(idleMs)}`).toBe('active');
      expect(state.msLeft).toBe(Number.POSITIVE_INFINITY);
    }
  });

  it('will not let a clock from the future extend a session past one whole window', () => {
    // A sibling tab writing while this machine's clock is being corrected, or a laptop waking
    // with a jumped clock. Unclamped this reads as "active for the next three hours", which is
    // the one answer that would quietly switch the control off.
    const state = idleStateAt({
      lastActivityAt: NOW + 3 * 60 * MINUTE,
      now: NOW,
      idleMs: TEN_MINUTES,
    });
    expect(state.phase).toBe('active');
    expect(state.msLeft).toBe(TEN_MINUTES);
  });

  it('keeps the warning meaningful however short the window is set', () => {
    // A minute of warning inside a one-minute window would be on screen from the first second.
    expect(warningWindowMs(MINUTE)).toBe(MINUTE / 2);
    expect(warningWindowMs(TEN_MINUTES)).toBe(WARN_BEFORE_MS);
    // And a 90-second window still gets a real countdown rather than an instant one.
    const justOpened = idleStateAt({ lastActivityAt: NOW, now: NOW, idleMs: 90_000 });
    expect(justOpened.phase).toBe('active');
  });
});

describe('telling the server somebody is here', () => {
  const base = { now: NOW, idleMs: TEN_MINUTES };

  it('renews when there has been activity since the last renewal, on cadence', () => {
    expect(
      shouldRenew({ ...base, lastRenewAt: NOW - 6 * MINUTE, lastActivityAt: NOW - MINUTE }),
    ).toBe(true);
  });

  it('REFUSES to renew an abandoned screen, however long it has been', () => {
    // The whole control rests on this. A timer that renewed regardless of activity would hold
    // every unattended session open for ever and make the window decoration.
    for (const hours of [1, 5, 24]) {
      const lastTouch = NOW - hours * 60 * MINUTE;
      expect(
        shouldRenew({ ...base, lastRenewAt: lastTouch, lastActivityAt: lastTouch }),
        `${String(hours)}h abandoned`,
      ).toBe(false);
    }
  });

  it('does not renew on every tick — only once the cadence has passed', () => {
    expect(shouldRenew({ ...base, lastRenewAt: NOW - 1_000, lastActivityAt: NOW })).toBe(false);
    expect(shouldRenew({ ...base, lastRenewAt: NOW - 5 * MINUTE, lastActivityAt: NOW })).toBe(true);
  });

  it('never renews when the window is switched off', () => {
    expect(shouldRenew({ now: NOW, idleMs: 0, lastRenewAt: NOW - 60 * MINUTE, lastActivityAt: NOW }))
      .toBe(false);
  });

  it('proves activity well inside the window, whatever the window is', () => {
    // The cadence has to keep `lastUsedAt` comfortably fresher than the server's deadline, or an
    // active person would be cut off by the very rule that is supposed to spare them.
    for (const minutes of [2, 10, 30, 120, 1440]) {
      const idleMs = minutes * MINUTE;
      expect(renewEveryMs(idleMs), `${String(minutes)}m window`).toBeLessThan(idleMs);
      expect(renewEveryMs(idleMs)).toBeLessThanOrEqual(RENEW_AT_MOST_EVERY_MS);
    }
    expect(renewEveryMs(TEN_MINUTES)).toBe(5 * MINUTE);
  });
});

describe('the countdown as it is read out', () => {
  it('counts whole seconds and never goes below zero', () => {
    expect(secondsLeft(59_800)).toBe(60);
    expect(secondsLeft(1_200)).toBe(2);
    expect(secondsLeft(0)).toBe(0);
    expect(secondsLeft(-5_000)).toBe(0);
    expect(secondsLeft(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
