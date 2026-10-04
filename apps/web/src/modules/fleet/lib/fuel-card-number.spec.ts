import { describe, expect, it } from 'vitest';
import { groupCardNumber, ungroupCardNumber } from './fuel-card-number';

describe('a card number in groups of four', () => {
  it('groups the digits by four from the start, and ungroups back to the bare digits', () => {
    expect(groupCardNumber('5485640006436766')).toBe('5485 6400 0643 6766');
    expect(groupCardNumber('548564000643676')).toBe('5485 6400 0643 676');
    expect(groupCardNumber('5485 64000 6436766')).toBe('5485 6400 0643 6766');
    expect(groupCardNumber('1234')).toBe('1234');
    expect(groupCardNumber('')).toBe('');
    expect(ungroupCardNumber('5485 6400 0643 6766')).toBe('5485640006436766');
  });
});
