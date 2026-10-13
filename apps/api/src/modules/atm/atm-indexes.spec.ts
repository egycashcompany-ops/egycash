// The boot index builder's report for a collection whose rows stay out of the log — the two
// operation logs since the owner's rule (port doc OD-1). Legacy data may hold two open rows for
// one machine, so their unique index is the likeliest to be reported; the report must name the
// collection and the counts, never a machine code, a row id or a server message quoting a key.
import { describe, expect, it } from 'vitest';
import { duplicateCounts, redactedErrorText } from './atm-indexes';

describe('duplicateCounts', () => {
  it('reduces the duplicate groups to how many and how many rows', () => {
    const groups = [
      { rows: 2, key: { machineCode: '101' }, docIds: ['a', 'b'] },
      { rows: 3, key: { machineCode: '102' }, docIds: ['c', 'd', 'e'] },
    ];
    expect(duplicateCounts(groups)).toEqual({ groups: 2, rows: 5 });
  });

  it('carries nothing else — no key, no id', () => {
    const groups = [{ rows: 2, key: { machineCode: '101' } }];
    const counted = duplicateCounts(groups);
    expect(Object.keys(counted).sort()).toEqual(['groups', 'rows']);
    expect(JSON.stringify(counted)).not.toContain('101');
  });
});

describe('redactedErrorText', () => {
  it('keeps the error’s name and server code, and drops a message that quotes a key', () => {
    const error = Object.assign(
      new Error('E11000 duplicate key error … dup key: { machineCode: "101" }'),
      { name: 'MongoServerError', code: 11000 },
    );
    expect(redactedErrorText(error)).toBe('MongoServerError 11000');
    expect(redactedErrorText(error)).not.toContain('101');
  });

  it('falls back to the name alone, and survives a non-Error', () => {
    expect(redactedErrorText(new TypeError('quoted 101'))).toBe('TypeError');
    expect(redactedErrorText('quoted 101')).toBe('Error');
    expect(redactedErrorText(null)).toBe('Error');
  });
});
