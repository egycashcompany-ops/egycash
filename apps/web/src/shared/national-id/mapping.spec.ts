import { describe, expect, it } from 'vitest';
import { mapMaritalStatus } from './mapping';

describe('mapMaritalStatus', () => {
  it("takes an unmarried woman's 'آنسة' as single, however its letters were read", () => {
    for (const read of ['آنسة', 'آنسه', 'انسة', 'انسه', 'أنسة']) {
      expect(mapMaritalStatus(read)).toBe('single');
    }
  });

  it('keeps the other words as they were', () => {
    expect(mapMaritalStatus('أعزب')).toBe('single');
    expect(mapMaritalStatus('عزباء')).toBe('single');
    expect(mapMaritalStatus('متزوجة')).toBe('married');
    expect(mapMaritalStatus('مطلق')).toBe('divorced');
    expect(mapMaritalStatus('أرملة')).toBe('widowed');
    expect(mapMaritalStatus('ستدم T')).toBe('');
  });
});
