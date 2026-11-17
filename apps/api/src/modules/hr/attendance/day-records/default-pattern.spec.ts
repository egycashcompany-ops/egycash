// The default working pattern's rule: what six settings amount to, and when they amount to
// nothing. Every `null` below is a refusal rather than a guess — a pattern invented out of a
// half-finished edit would quietly make somebody late.
import { describe, expect, it } from 'vitest';
import { patternFrom, type DefaultPatternSettings } from './default-pattern';

const ON: DefaultPatternSettings = {
  enabled: true,
  startTime: '09:00',
  endTime: '17:00',
  breakMinutes: 30,
  graceInMinutes: 15,
  graceOutMinutes: 0,
};

describe('the default working pattern', () => {
  it('ships inert: switched off is no expectation at all', () => {
    expect(patternFrom({ ...ON, enabled: false })).toBeNull();
  });

  it('becomes the shift the engine derives against, field for field', () => {
    expect(patternFrom(ON)).toEqual({
      startTime: '09:00',
      endTime: '17:00',
      crossesMidnight: false,
      breakMinutes: 30,
      graceInMinutes: 15,
      graceOutMinutes: 0,
    });
  });

  it('infers crossing midnight from the hours, so a stored flag cannot contradict them', () => {
    expect(patternFrom({ ...ON, startTime: '22:00', endTime: '06:00' })?.crossesMidnight).toBe(
      true,
    );
    expect(patternFrom({ ...ON, startTime: '09:00', endTime: '17:00' })?.crossesMidnight).toBe(
      false,
    );
    // One minute either side of the boundary, so the comparison is pinned as strict.
    expect(patternFrom({ ...ON, startTime: '09:00', endTime: '09:01' })?.crossesMidnight).toBe(
      false,
    );
    expect(patternFrom({ ...ON, startTime: '09:01', endTime: '09:00' })?.crossesMidnight).toBe(
      true,
    );
  });

  it('refuses a zero-length day rather than reading it as 24 hours', () => {
    // 09:00→09:00 is far likelier to be a half-finished edit than a round-the-clock shift.
    expect(patternFrom({ ...ON, startTime: '09:00', endTime: '09:00' })).toBeNull();
  });

  it('refuses a malformed time instead of repairing it', () => {
    for (const bad of ['9:00', '25:00', '09:60', '0900', '', 'nine']) {
      expect(patternFrom({ ...ON, startTime: bad }), bad).toBeNull();
      expect(patternFrom({ ...ON, endTime: bad }), bad).toBeNull();
    }
  });

  it('refuses a negative minute count anywhere', () => {
    expect(patternFrom({ ...ON, breakMinutes: -1 })).toBeNull();
    expect(patternFrom({ ...ON, graceInMinutes: -1 })).toBeNull();
    expect(patternFrom({ ...ON, graceOutMinutes: -1 })).toBeNull();
  });

  it('takes zero for every optional quantity — a pattern with no break and no grace is valid', () => {
    expect(patternFrom({ ...ON, breakMinutes: 0, graceInMinutes: 0, graceOutMinutes: 0 })).toEqual({
      startTime: '09:00',
      endTime: '17:00',
      crossesMidnight: false,
      breakMinutes: 0,
      graceInMinutes: 0,
      graceOutMinutes: 0,
    });
  });
});
