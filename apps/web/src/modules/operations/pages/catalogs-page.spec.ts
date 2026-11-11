// The catalogs screen's URL contract. The tab lives in `?kind=`, so it is bookmarkable and
// survives a reload — which means an unknown or hand-edited value must land somewhere sane rather
// than rendering an empty screen with no table at all.
import { describe, expect, it } from 'vitest';
import { OPERATIONS_CATALOG_KINDS, resolveCatalogKind } from './CatalogsPage';
import { resolveCrewDate } from './CrewBoardPage';

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
    // `cities` is the LEGACY name for what B6 ships as `areas`; an old bookmark must not blank
    // the screen, and it must not silently resolve to the areas tab either — it is not that URL.
    expect(resolveCatalogKind('cities')).toBe('banks');
    expect(resolveCatalogKind('')).toBe('banks');
  });

  it('offers the four kinds the legacy /data_edit screen maintained', () => {
    // B1 shipped three and recorded cities as read by nothing. B6 corrected that: the legacy view
    // renders them into the `<datalist>` behind a branch's area field (data_edit.ejs:924), so
    // they ARE consumed — as suggestions for a free-text field, which is what `areas` maintains.
    expect([...OPERATIONS_CATALOG_KINDS]).toEqual(['banks', 'branches', 'currencies', 'areas']);
  });
});

// The daily board has no `?date=` contract any more — «اليوم التشغيلي … هو هيجيب بتاعت اليوم»: it
// is always Cairo's today, and an old link's `date` is dropped (shipment-screens.spec).

describe('resolveCrewDate — the crew board defaults to TOMORROW, server-side', () => {
  it('accepts an explicit day', () => {
    expect(resolveCrewDate('2026-11-03')).toBe('2026-11-03');
  });

  it('is null when absent — the SERVER decides, and it answers tomorrow', () => {
    // Legacy redirected to tomorrow (contad_app.js:2239-2247) because crews are planned a day
    // ahead. Null keeps that decision on the server rather than duplicating "+1 day" here.
    expect(resolveCrewDate(null)).toBeNull();
  });

  it('is null for anything that is not a plain day', () => {
    for (const bad of ['', 'tomorrow', '2026-11-03T00:00:00Z', '03-11-2026']) {
      expect(resolveCrewDate(bad)).toBeNull();
    }
  });
});

