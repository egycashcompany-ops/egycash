// The bell's poll cadence under ADR-029: primary while the socket is down, safety net while it
// is up — never off, because a silent socket failure must degrade to today's behaviour.
import { describe, expect, it } from 'vitest';
import { badgePollInterval } from './NotificationBell';
import { realtimeStatus, setRealtimeConnected } from '../realtime/realtime-status';

describe('badge poll interval', () => {
  it('polls every minute while the realtime socket is down', () => {
    expect(badgePollInterval(false)).toBe(60_000);
  });

  it('drops to a five-minute safety net while pushes are live', () => {
    expect(badgePollInterval(true)).toBe(300_000);
  });
});

describe('realtime status store', () => {
  it('answers a server snapshot — without one, every static render of the bell throws', () => {
    // The whole web suite renders through renderToStaticMarkup. `useSyncExternalStore` demands a
    // server snapshot there, and the bell renders on every authenticated page, so omitting it
    // does not fail one test — it fails every test that renders the topbar.
    expect(realtimeStatus.getServerSnapshot()).toBe(false);
  });

  it('notifies subscribers exactly on change', () => {
    const seen: boolean[] = [];
    const unsubscribe = realtimeStatus.subscribe(() => seen.push(realtimeStatus.getSnapshot()));
    setRealtimeConnected(true);
    setRealtimeConnected(true); // no change — no notification
    setRealtimeConnected(false);
    unsubscribe();
    setRealtimeConnected(true);
    expect(seen).toEqual([true, false]);
    setRealtimeConnected(false); // leave the module state as found
  });
});
