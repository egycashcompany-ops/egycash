// The catalogs screen's URL contract. The tab lives in `?kind=`, so it is bookmarkable and
// survives a reload — which means an unknown or hand-edited value must land somewhere sane rather
// than rendering an empty screen with no table at all.
import { describe, expect, it } from 'vitest';
import { OPERATIONS_CATALOG_KINDS, resolveCatalogKind } from './CatalogsPage';
import { resolveBoardDate } from './DailyOperationsPage';

describe('resolveCatalogKind', () => {
  it('accepts each kind the page can actually show', () => {
    for (const kind of OPERATIONS_CATALOG_KINDS) {
      expect(resolveCatalogKind(kind)).toBe(kind);
    }
  });

  it('falls back to banks when the parameter is absent', () => {
    expect(resolveCatalogKind(null)).toBe('banks');
  });

  it('falls back to banks for a value that is not a kind', () => {
    expect(resolveCatalogKind('cities')).toBe('banks');
    expect(resolveCatalogKind('')).toBe('banks');
  });

  it('offers exactly the three kinds Operations joins on — cities are deliberately not here', () => {
    expect([...OPERATIONS_CATALOG_KINDS]).toEqual(['banks', 'branches', 'currencies']);
  });
});

describe('resolveBoardDate — the daily board\'s ?date= contract', () => {
  it('accepts a plain yyyy-mm-dd day', () => {
    expect(resolveBoardDate('2026-10-05')).toBe('2026-10-05');
  });

  it('is null when absent, so the SERVER decides what today is', () => {
    // Near midnight a browser and the server can disagree about the date; the legacy screen had no
    // picker at all and computed today server-side. Null preserves that.
    expect(resolveBoardDate(null)).toBeNull();
  });

  it('is null for anything that is not a day, rather than passing it through', () => {
    for (const bad of ['', 'today', '2026-13-99T00:00:00Z', '05-10-2026']) {
      expect(resolveBoardDate(bad)).toBeNull();
    }
  });
});
