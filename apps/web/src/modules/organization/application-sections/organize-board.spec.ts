// What a drag MEANS, proven without a DOM.
//
// These are the operations behind every gesture on the organize board, and they are exactly where
// reordering goes subtly wrong: an off-by-one when a row moves down past itself, a drop onto the
// row it started on, a cross-bucket drop that forgets to remove the row from where it came from.
// Each of those is a bug a user would read as "the board lost my page".
import { describe, expect, it } from 'vitest';
import {
  bucketKey,
  dropInto,
  dropSection,
  moveBy,
  moveSection,
  moveWithin,
  type Board,
} from './organize-board';

const board = (): Board => ({
  buckets: { '': ['x1', 'x2'], s1: ['a', 'b', 'c'], s2: ['d'] },
});

describe('moveWithin', () => {
  it('moves an item up and down', () => {
    expect(moveWithin(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveWithin(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('is a no-op for a move onto itself, or out of range', () => {
    const ids = ['a', 'b', 'c'];
    expect(moveWithin(ids, 1, 1)).toBe(ids);
    expect(moveWithin(ids, -1, 0)).toBe(ids);
    expect(moveWithin(ids, 0, 9)).toBe(ids);
  });
});

describe('moveBy — the Up/Down buttons', () => {
  it('walks an item one place at a time', () => {
    expect(moveBy(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveBy(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
  });

  it('refuses to walk past either end, rather than wrapping', () => {
    expect(moveBy(['a', 'b'], 'a', -1)).toEqual(['a', 'b']);
    expect(moveBy(['a', 'b'], 'b', 1)).toEqual(['a', 'b']);
  });

  it('ignores an id the list does not hold', () => {
    expect(moveBy(['a'], 'zz', 1)).toEqual(['a']);
  });
});

describe('dropInto — within one bucket', () => {
  it('reorders and reports the same list for both ends', () => {
    const result = dropInto(board(), 'c', 's1', 's1', 0);
    expect(result.targetIds).toEqual(['c', 'a', 'b']);
    expect(result.sourceIds).toEqual(result.targetIds);
  });

  it('dropping a row on itself changes nothing', () => {
    const result = dropInto(board(), 'b', 's1', 's1', 1);
    expect(result.targetIds).toEqual(['a', 'b', 'c']);
  });

  // Applying the same drop twice must land on the same list — the whole idempotency claim.
  it('is idempotent', () => {
    const once = dropInto(board(), 'c', 's1', 's1', 0).targetIds;
    const twice = dropInto({ buckets: { ...board().buckets, s1: once } }, 'c', 's1', 's1', 0)
      .targetIds;
    expect(twice).toEqual(once);
  });
});

describe('dropInto — across buckets', () => {
  it('removes the row from where it came and inserts it where it landed', () => {
    const result = dropInto(board(), 'a', 's1', 's2', 0);
    expect(result.sourceIds).toEqual(['b', 'c']);
    expect(result.targetIds).toEqual(['a', 'd']);
  });

  it('appends when no index is given (a drop on the bucket, not on a row)', () => {
    expect(dropInto(board(), 'a', 's1', 's2', null).targetIds).toEqual(['d', 'a']);
  });

  it('moves a row OUT of every section — the unsectioned bucket is a real destination', () => {
    const result = dropInto(board(), 'a', 's1', null, null);
    expect(result.sourceIds).toEqual(['b', 'c']);
    expect(result.targetIds).toEqual(['x1', 'x2', 'a']);
    expect(bucketKey(result.target)).toBe('');
  });

  it('never leaves a duplicate behind when the same row is dropped twice', () => {
    const first = dropInto(board(), 'a', 's1', 's2', 0);
    const next: Board = {
      buckets: { ...board().buckets, s1: first.sourceIds, s2: first.targetIds },
    };
    const second = dropInto(next, 'a', 's2', 's2', 0);
    expect(second.targetIds).toEqual(['a', 'd']);
    expect(second.targetIds.filter((id) => id === 'a')).toHaveLength(1);
  });
});

describe('sections reorder the same way', () => {
  it('walks a section with the arrows', () => {
    expect(moveSection(['s1', 's2', 's3'], 's3', -1)).toEqual(['s1', 's3', 's2']);
  });

  it('drops a section at an index', () => {
    expect(dropSection(['s1', 's2', 's3'], 's1', 2)).toEqual(['s2', 's3', 's1']);
  });

  it('ignores a section it does not know', () => {
    expect(dropSection(['s1'], 'zz', 0)).toEqual(['s1']);
  });
});
