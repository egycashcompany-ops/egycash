import { describe, expect, it } from 'vitest';
import { HEARTBEAT_EVERY_MS, shouldBeat } from './heartbeat';

const NOW = 1_800_000_000_000;

describe('shouldBeat — somebody working, in front of the page, once a minute', () => {
  it('beats on the first use after the page opens', () => {
    expect(
      shouldBeat({ lastActivityAt: NOW - 1_000, lastBeatAt: 0, now: NOW, visible: true }),
    ).toBe(true);
  });

  it('beats at most once a minute however busy the person is', () => {
    const lastBeatAt = NOW - HEARTBEAT_EVERY_MS + 1_000;
    expect(shouldBeat({ lastActivityAt: NOW, lastBeatAt, now: NOW, visible: true })).toBe(false);
    expect(
      shouldBeat({
        lastActivityAt: NOW,
        lastBeatAt: NOW - HEARTBEAT_EVERY_MS,
        now: NOW,
        visible: true,
      }),
    ).toBe(true);
  });

  it('does not beat for a page nobody has touched since the last heartbeat', () => {
    const lastBeatAt = NOW - 5 * HEARTBEAT_EVERY_MS;
    expect(
      shouldBeat({ lastActivityAt: lastBeatAt - 1, lastBeatAt, now: NOW, visible: true }),
    ).toBe(false);
  });

  it('does not credit this minute for use that was minutes ago', () => {
    expect(
      shouldBeat({
        lastActivityAt: NOW - 2 * HEARTBEAT_EVERY_MS,
        lastBeatAt: 0,
        now: NOW,
        visible: true,
      }),
    ).toBe(false);
  });

  it('never beats from a tab in the background', () => {
    expect(
      shouldBeat({ lastActivityAt: NOW - 1_000, lastBeatAt: 0, now: NOW, visible: false }),
    ).toBe(false);
  });
});
