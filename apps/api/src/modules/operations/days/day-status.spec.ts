import { describe, expect, it } from 'vitest';
import { canTransitionDay } from './day-status';

describe('operating-day transitions — forward only, planning → open → closed', () => {
  it('walks the approved lifecycle', () => {
    expect(canTransitionDay('planning', 'open')).toBe(true);
    expect(canTransitionDay('open', 'closed')).toBe(true);
  });

  it('refuses skipping and going back — closed is terminal', () => {
    expect(canTransitionDay('planning', 'closed')).toBe(false);
    expect(canTransitionDay('open', 'planning')).toBe(false);
    expect(canTransitionDay('closed', 'open')).toBe(false);
    expect(canTransitionDay('closed', 'planning')).toBe(false);
  });
});
