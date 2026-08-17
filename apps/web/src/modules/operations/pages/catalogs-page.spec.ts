// The catalogs screen's URL contract. The tab lives in `?kind=`, so it is bookmarkable and
// survives a reload — which means an unknown or hand-edited value must land somewhere sane rather
// than rendering an empty screen with no table at all.
import { describe, expect, it } from 'vitest';
import { OPERATIONS_CATALOG_KINDS, resolveCatalogKind } from './CatalogsPage';

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
