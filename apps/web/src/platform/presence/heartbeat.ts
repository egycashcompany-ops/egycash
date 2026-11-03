// When the browser tells the server «somebody is working here» — the «وشغال» half of the active
// users page.
//
// Once in each MINUTE of the clock, and only when all three hold:
//   • the page is in front of the person (a tab in the background is not somebody working);
//   • somebody has used it — pointer, keys, scroll — since the last heartbeat, as the idle
//     tracker records it (shared by every tab, so working in one tab never counts another);
//   • that use was within the last minute: the server credits the minute the heartbeat lands in.
//
// By the clock's minute, not by «sixty seconds since the last one»: the server counts the minute a
// heartbeat lands in, and a check every 15 s that waited a full 60 000 ms would, with a timer a
// millisecond early, wait 75 s instead — and skip a whole minute of somebody's work.
//
// The server stores the MINUTE, as a set: two tabs or two devices in the same minute are one
// minute, so nothing here has to coordinate with anything else.

const MINUTE_MS = 60_000;

/** How often the decision is checked; a minute's heartbeat lands within this of the minute turning. */
export const HEARTBEAT_CHECK_MS = 15_000;

/** The minute of the clock an instant falls in. Cairo's offset is whole hours, so it is Cairo's. */
const minuteOf = (instant: number): number => Math.floor(instant / MINUTE_MS);

export const shouldBeat = ({
  lastActivityAt,
  lastBeatAt,
  now,
  visible,
}: {
  lastActivityAt: number;
  lastBeatAt: number;
  now: number;
  visible: boolean;
}): boolean =>
  visible &&
  lastActivityAt > lastBeatAt &&
  now - lastActivityAt < MINUTE_MS &&
  minuteOf(now) !== minuteOf(lastBeatAt);
