import { describe, expect, it } from 'vitest';
import { mayReadFolder, viewerChanges } from './folder-rules';

const A = '64b000000000000000000001';
const B = '64b000000000000000000002';
const C = '64b000000000000000000003';

describe('who a new list adds and takes off', () => {
  it('names each change once, whatever the case of the ids', () => {
    expect(viewerChanges([A, B], [B.toUpperCase(), C])).toEqual({ added: [C], removed: [A] });
  });

  it('is empty for the same list in another order', () => {
    expect(viewerChanges([A, B], [B, A])).toEqual({ added: [], removed: [] });
  });
});

describe('who may see a folder', () => {
  it('is the responsible person, always', () => {
    expect(mayReadFolder(true, C, [])).toBe(true);
  });

  it('is a person on its list, and nobody else', () => {
    expect(mayReadFolder(false, A, [A, B])).toBe(true);
    expect(mayReadFolder(false, A.toUpperCase(), [A])).toBe(true);
    expect(mayReadFolder(false, C, [A, B])).toBe(false);
  });
});
