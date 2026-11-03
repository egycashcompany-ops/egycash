import { describe, expect, it } from 'vitest';
import { HEARTBEAT_CHECK_MS, shouldBeat } from './heartbeat';

// 10:00:00.000 UTC — the start of a minute.
const MINUTE = Date.parse('2026-11-03T10:00:00.000Z');

describe('shouldBeat — somebody working, in front of the page, once in each minute', () => {
  it('beats on the first use after the page opens', () => {
    expect(
      shouldBeat({
        lastActivityAt: MINUTE + 1_000,
        lastBeatAt: 0,
        now: MINUTE + 2_000,
        visible: true,
      }),
    ).toBe(true);
  });

  it('beats once in a minute however busy the person is', () => {
    const lastBeatAt = MINUTE + 5_000;
    expect(
      shouldBeat({
        lastActivityAt: MINUTE + 40_000,
        lastBeatAt,
        now: MINUTE + 50_000,
        visible: true,
      }),
    ).toBe(false);
    expect(
      shouldBeat({
        lastActivityAt: MINUTE + 61_000,
        lastBeatAt,
        now: MINUTE + 62_000,
        visible: true,
      }),
    ).toBe(true);
  });

  // The case a «60 000 ms since the last beat» rule got wrong: a timer one millisecond early
  // waited another 15 s, and the beat landed two minutes on.
  it('beats in the next minute even when that is less than 60 s after the last beat', () => {
    expect(
      shouldBeat({
        lastActivityAt: MINUTE + 59_000,
        lastBeatAt: MINUTE - 1,
        now: MINUTE + 14_998,
        visible: true,
      }),
    ).toBe(true);
  });

  it('credits every minute of an hour of steady work, whatever the timer jitter', () => {
    const start = MINUTE + 7_000;
    let lastBeatAt = 0;
    const beats = new Set<number>();
    for (let tick = 0; tick * HEARTBEAT_CHECK_MS < 60 * 60_000; tick += 1) {
      // Each check fires up to 40 ms late, unevenly; the person is active every few seconds.
      const now = start + tick * HEARTBEAT_CHECK_MS + ((tick * 37) % 41);
      if (shouldBeat({ lastActivityAt: now - 2_000, lastBeatAt, now, visible: true })) {
        lastBeatAt = now;
        beats.add(Math.floor(now / 60_000));
      }
    }
    expect(beats.size).toBe(60);
  });

  it('does not beat for a page nobody has touched since the last heartbeat', () => {
    const lastBeatAt = MINUTE - 5 * 60_000;
    expect(
      shouldBeat({ lastActivityAt: lastBeatAt - 1, lastBeatAt, now: MINUTE, visible: true }),
    ).toBe(false);
  });

  it('does not credit this minute for use that was minutes ago', () => {
    expect(
      shouldBeat({
        lastActivityAt: MINUTE - 2 * 60_000,
        lastBeatAt: 0,
        now: MINUTE,
        visible: true,
      }),
    ).toBe(false);
  });

  it('never beats from a tab in the background', () => {
    expect(
      shouldBeat({ lastActivityAt: MINUTE - 1_000, lastBeatAt: 0, now: MINUTE, visible: false }),
    ).toBe(false);
  });
});
