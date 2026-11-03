// When the browser tells the server «somebody is working here» — the «وشغال» half of the active
// users page.
//
// At most once a minute, and only when all three hold:
//   • the page is in front of the person (a tab in the background is not somebody working);
//   • somebody has used it — pointer, keys, scroll — since the last heartbeat, as the idle
//     tracker records it (shared by every tab, so working in one tab never counts another);
//   • that use was within the last minute: the server credits the minute the heartbeat lands in.
//
// The server stores the MINUTE, as a set: two tabs or two devices in the same minute are one
// minute, so nothing here has to coordinate with anything else.

/** One heartbeat per minute at most — the server counts whole minutes. */
export const HEARTBEAT_EVERY_MS = 60_000;

/** How often the decision is checked; a heartbeat is due at most this late. */
export const HEARTBEAT_CHECK_MS = 15_000;

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
  now - lastActivityAt < HEARTBEAT_EVERY_MS &&
  now - lastBeatAt >= HEARTBEAT_EVERY_MS;
