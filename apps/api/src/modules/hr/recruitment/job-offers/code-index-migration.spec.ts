// The guard in front of a `dropIndex`, which is the only irreversible thing this migration does.
//
// Two ways it could go wrong, and each is worse than the bug it fixes:
//   • dropping when two live offers share a code — the rebuild fails and the collection is left
//     with no uniqueness at all, silently;
//   • dropping on every boot — the index is rebuilt over and over on a collection that is fine.
import { describe, expect, it } from 'vitest';
import { decideCodeIndexRebuild } from './code-index-migration';

/** The drifted shape: unique, no partial filter — the one that rejects a second `code: null`. */
const LEGACY = { name: 'ux_code', unique: true };
/** What the schema declares today. */
const DECLARED = {
  name: 'ux_code',
  unique: true,
  partialFilterExpression: { code: { $type: 'string' } },
};

describe('deciding whether to rebuild ux_code', () => {
  it('rebuilds the legacy index that has no partial filter', () => {
    expect(decideCodeIndexRebuild(LEGACY, [])).toEqual({ action: 'rebuild' });
  });

  /** Idempotence: the second boot, and every boot after it, must not touch a repaired index. */
  it('skips an index that already carries the partial filter', () => {
    expect(decideCodeIndexRebuild(DECLARED, [])).toMatchObject({ action: 'skip' });
  });

  it('skips a fresh install where the index does not exist yet', () => {
    expect(decideCodeIndexRebuild(undefined, [])).toMatchObject({ action: 'skip' });
  });

  /**
   * THE ONE THAT MATTERS. Dropping here would fail the rebuild and leave `hr_job_offers` with no
   * unique index on `code` — two offers could then be issued the same number, and nothing would
   * say so. Refusing keeps the current, working invariant and names what a human has to fix.
   */
  it('refuses to drop while two live offers share a code, and names them', () => {
    const verdict = decideCodeIndexRebuild(LEGACY, ['JO-2026-000007', 'JO-2026-000012']);
    expect(verdict.action).toBe('blocked');
    expect(verdict).toMatchObject({ duplicates: ['JO-2026-000007', 'JO-2026-000012'] });
  });

  /** Duplicates are irrelevant once the index is already right — no drop is contemplated. */
  it('still skips an already-partial index even if duplicates exist', () => {
    expect(decideCodeIndexRebuild(DECLARED, ['JO-2026-000007'])).toMatchObject({ action: 'skip' });
  });

  /** A non-unique `ux_code` is drift too: the declared index is unique AND partial. */
  it('rebuilds an index that lost its uniqueness', () => {
    expect(decideCodeIndexRebuild({ name: 'ux_code' }, [])).toEqual({ action: 'rebuild' });
  });

  /** The caller must not be handed a reference into its own input. */
  it('copies the duplicate list rather than aliasing the caller’s array', () => {
    const codes = ['JO-2026-000007'];
    const verdict = decideCodeIndexRebuild(LEGACY, codes);
    codes.push('JO-2026-000099');
    expect(verdict).toMatchObject({ duplicates: ['JO-2026-000007'] });
  });
});
