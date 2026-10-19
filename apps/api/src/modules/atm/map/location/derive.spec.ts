// Choosing a machine's location and what a re-derivation may write (docs/12-planning/atm-map-zones.md
// §4.3, §9.2): every row of the ranking table, the DM-34 reference, and every row of the DM-2
// precedence table. All texts and ids are synthetic.
import { describe, expect, it } from 'vitest';
import { type AtmMapLocationTexts } from '@ecms/contracts';
import {
  applyDerivation,
  bestCandidateIsShortCode,
  hasShortCodeCandidate,
  pinHolds,
  commonBankCode,
  deriveLocation,
  mergeOpenEntries,
  referenceFor,
  referenceLookup,
  type DeriveInput,
  type Derived,
  type ExistingLocation,
  type ReferencePoint,
  type ReferencePoolEntry,
  type StoredShortLink,
} from './derive';
import { haversineMeters } from './maps-text';
import { decode } from './plus-code';

const E1 = '0000000000000000000000e1';
const E2 = '0000000000000000000000e2';
const LINK = 'https://maps.app.goo.gl/AbCd123';
const CAIRO_URL = 'https://www.google.com/maps?q=30.0444,31.2357';

const ref =
  (lat: number, lng: number, weak = false) =>
  (url: { lat: number; lng: number } | null): ReferencePoint | null =>
    url === null
      ? { lat, lng, basis: 'area', machines: 5, weak }
      : { lat: url.lat, lng: url.lng, basis: 'url', machines: 0, weak: false };
const noReference = () => null;

const derive = (
  texts: Partial<AtmMapLocationTexts>,
  over: Partial<Omit<DeriveInput, 'texts'>> = {},
): Derived =>
  deriveLocation({
    texts: { plusCode: texts.plusCode ?? null, url: texts.url ?? null },
    entryIds: [E1],
    entryProblem: null,
    resolvedLink: null,
    reference: noReference,
    ...over,
  });

const resolved = (url: string, lat: number, lng: number, viewportOnly = false) => ({
  url,
  status: 'resolved' as const,
  lat,
  lng,
  viewportOnly,
});

/** The recovered centre of 8G2H26VP+Q7, as the derivation rounds it. */
const CAIRO_CODE_CENTRE = (() => {
  const c = decode('8G2H26VP+Q7');
  return { lat: Math.round(c.lat * 1e6) / 1e6, lng: Math.round(c.lng * 1e6) / 1e6 };
})();

describe('deriveLocation — the ranking table', () => {
  it('rank 1: coordinates from a URL pin or from text', () => {
    expect(derive({ url: CAIRO_URL })).toMatchObject({
      status: 'located',
      lat: 30.0444,
      lng: 31.2357,
      source: 'registerUrl',
      sourceField: 'locationUrl',
      needsReview: false,
      warnings: [],
      reason: null,
    });
    expect(derive({ plusCode: '30.0444, 31.2357' })).toMatchObject({
      source: 'registerCoordinates',
      sourceField: 'locationPlusCode',
    });
  });

  it('rank 1: an ambiguous URL is a review pin', () => {
    const d = derive({
      url: 'https://www.google.com/maps/place/X/data=!3d30.0444!4d31.2357!5m1!3d30.05!4d31.2357',
    });
    expect(d).toMatchObject({ status: 'located', needsReview: true, warnings: ['ambiguousUrl'] });
  });

  it('rank 2: a full Plus Code is its cell centre', () => {
    expect(derive({ plusCode: '8G2H26VP+Q7' })).toMatchObject({
      status: 'located',
      ...CAIRO_CODE_CENTRE,
      source: 'registerPlusCode',
      needsReview: false,
    });
  });

  it('AV coordinates beat an AP full code', () => {
    expect(derive({ url: CAIRO_URL, plusCode: '8G2H26VP+Q7' })).toMatchObject({
      source: 'registerUrl',
      sourceField: 'locationUrl',
    });
  });

  it('a full code beats a short link, and the link is not queued', () => {
    expect(derive({ url: LINK, plusCode: '8G2H26VP+Q7' })).toMatchObject({
      source: 'registerPlusCode',
      shortLinkUrl: null,
    });
  });

  it('rank 3: a resolved short link, and a review pin when it came from a viewport only', () => {
    expect(derive({ url: LINK }, { resolvedLink: resolved(LINK, 30.05, 31.24) })).toMatchObject({
      status: 'located',
      lat: 30.05,
      lng: 31.24,
      source: 'registerShortLink',
      needsReview: false,
      shortLinkUrl: LINK,
    });
    expect(
      derive({ url: LINK }, { resolvedLink: resolved(LINK, 30.05, 31.24, true) }),
    ).toMatchObject({
      source: 'registerShortLink',
      needsReview: true,
      warnings: ['viewportOnly'],
    });
  });

  it('a stored result for ANOTHER link does not resolve this one', () => {
    expect(
      derive({ url: LINK }, { resolvedLink: resolved('https://maps.app.goo.gl/Other', 30, 31) }),
    ).toMatchObject({ status: 'unlocated', reason: 'shortLink', shortLinkUrl: LINK });
  });

  it('a resolved link beats a short code', () => {
    expect(
      derive(
        { url: LINK, plusCode: '26VP+Q7' },
        { resolvedLink: resolved(LINK, 30.05, 31.24), reference: ref(30.05, 31.2) },
      ),
    ).toMatchObject({ source: 'registerShortLink' });
  });

  it('rank 4: a short code with a reference is a review pin that stores its reference', () => {
    const d = derive({ plusCode: '26VP+Q7 القاهرة' }, { reference: ref(30.05, 31.2) });
    expect(d).toMatchObject({
      status: 'located',
      ...CAIRO_CODE_CENTRE,
      source: 'registerShortCode',
      needsReview: true,
      warnings: [],
      reference: { lat: 30.05, lng: 31.2, basis: 'area', machines: 5 },
    });
    expect(d.reference).not.toHaveProperty('weak');
  });

  it("rank 4: a code from a URL is recovered against that URL's own viewport (basis url)", () => {
    const d = derive(
      { url: 'https://www.google.com/maps/place/26VP%2BQ7+Cairo/@30.05,31.2,17z' },
      { reference: ref(31.5, 32.5, true) },
    );
    expect(d).toMatchObject({
      source: 'registerShortCode',
      ...CAIRO_CODE_CENTRE,
      reference: { lat: 30.05, lng: 31.2, basis: 'url', machines: 0 },
      warnings: [],
    });
  });

  it('rank 4: a weak basis adds weakReference', () => {
    expect(derive({ plusCode: '26VP+Q7' }, { reference: ref(30.05, 31.2, true) })).toMatchObject({
      warnings: ['weakReference'],
      needsReview: true,
    });
  });

  it('a short code with an unresolved link returns the link to queue', () => {
    expect(
      derive({ url: LINK, plusCode: '26VP+Q7' }, { reference: ref(30.05, 31.2) }),
    ).toMatchObject({
      status: 'located',
      source: 'registerShortCode',
      shortLinkUrl: LINK,
    });
  });

  it('rank 5: a viewport is a review pin with viewportOnly', () => {
    expect(derive({ url: 'https://www.google.com/maps/@30.05,31.24,15z' })).toMatchObject({
      status: 'located',
      lat: 30.05,
      lng: 31.24,
      source: 'registerUrl',
      needsReview: true,
      warnings: ['viewportOnly'],
    });
  });

  it('rank 6: a short link not yet resolved is queued', () => {
    expect(derive({ url: LINK })).toMatchObject({
      status: 'unlocated',
      reason: 'shortLink',
      shortLinkUrl: LINK,
      lat: null,
      source: null,
      sourceField: null,
    });
    expect(derive({ url: LINK }, { resolvedLink: { url: LINK, status: 'pending' } })).toMatchObject(
      { reason: 'shortLink' },
    );
  });

  it('rank 7: a short link that failed', () => {
    expect(
      derive(
        { url: LINK },
        { resolvedLink: { url: LINK, status: 'failed', failure: 'noCoordinates' } },
      ),
    ).toMatchObject({ status: 'unlocated', reason: 'shortLinkFailed', shortLinkUrl: LINK });
  });

  it('ranks 8–11 and both cells empty', () => {
    expect(derive({ url: 'https://www.google.com/maps/place/Cairo+Tower' }).reason).toBe(
      'noCoordinates',
    );
    expect(derive({ plusCode: '26VP+Q7' }).reason).toBe('shortPlusCodeNoReference');
    expect(derive({ plusCode: '91, 0' }).reason).toBe('invalidCoordinates');
    expect(derive({ plusCode: 'hello' }).reason).toBe('unreadable');
    expect(derive({ plusCode: '  ', url: '' })).toMatchObject({
      status: 'unlocated',
      reason: 'none',
      seenText: { plusCode: null, url: null },
    });
  });

  it('a better unlocated reason wins: a pending link over an unreadable remainder', () => {
    expect(derive({ url: `الموقع: ${LINK}` }).reason).toBe('shortLink');
  });

  it('an entry problem is unlocated with no seen text', () => {
    expect(
      deriveLocation({
        texts: null,
        entryIds: [],
        entryProblem: 'noEntry',
        resolvedLink: null,
        reference: noReference,
      }),
    ).toMatchObject({ status: 'unlocated', reason: 'noEntry', seenText: null, seenEntryIds: [] });
    expect(
      deriveLocation({
        texts: null,
        entryIds: [E2, E1],
        entryProblem: 'conflictingEntries',
        resolvedLink: null,
        reference: noReference,
      }),
    ).toMatchObject({ reason: 'conflictingEntries', seenText: null, seenEntryIds: [E1, E2] });
  });

  it('a rank 1 winner returns shortLinkUrl: null', () => {
    expect(derive({ url: `${LINK} ${CAIRO_URL}` })).toMatchObject({
      source: 'registerUrl',
      shortLinkUrl: null,
    });
  });

  it('warns outsideEgypt without asking for review', () => {
    expect(derive({ plusCode: '0.5, 0.5' })).toMatchObject({
      status: 'located',
      needsReview: false,
      warnings: ['outsideEgypt'],
    });
  });

  it('sourcesDisagree for two candidates 1.2 km apart, none at 0.9 km', () => {
    const far = { lat: 30.0444 + 0.0108, lng: 31.2357 };
    const near = { lat: 30.0444 + 0.0081, lng: 31.2357 };
    expect(haversineMeters({ lat: 30.0444, lng: 31.2357 }, far)).toBeGreaterThan(1150);
    expect(haversineMeters({ lat: 30.0444, lng: 31.2357 }, near)).toBeLessThan(950);
    expect(
      derive({ url: CAIRO_URL, plusCode: `${String(far.lat)}, ${String(far.lng)}` }),
    ).toMatchObject({
      source: 'registerUrl',
      lat: 30.0444,
      needsReview: true,
      warnings: ['sourcesDisagree'],
    });
    expect(
      derive({ url: CAIRO_URL, plusCode: `${String(near.lat)}, ${String(near.lng)}` }),
    ).toMatchObject({ needsReview: false, warnings: [] });
  });

  it('a recovered short code takes part in the disagreement check', () => {
    // AV pin 30.0444 vs an AP short code recovered at 30.0444375 — the same place: no warning.
    expect(
      derive({ url: CAIRO_URL, plusCode: '26VP+Q7' }, { reference: ref(30.05, 31.2) }).warnings,
    ).toEqual([]);
    // A short code recovered a degree north disagrees.
    expect(
      derive({ url: CAIRO_URL, plusCode: '26VP+Q7' }, { reference: ref(30.9, 31.2) }).warnings,
    ).toEqual(['sourcesDisagree']);
  });
});

describe('several open entries', () => {
  it('merges per-field equal sets, with every id in seenEntryIds', () => {
    const merged = mergeOpenEntries([
      { id: E2, locationUrl: CAIRO_URL, locationPlusCode: '' },
      { id: E1, locationUrl: ` ${CAIRO_URL} `, locationPlusCode: '8G2H26VP+Q7' },
    ]);
    expect(merged).toEqual({
      texts: { plusCode: '8G2H26VP+Q7', url: CAIRO_URL },
      entryIds: [E1, E2],
      entryProblem: null,
    });
    expect(deriveLocation({ ...merged, resolvedLink: null, reference: noReference })).toMatchObject(
      {
        status: 'located',
        seenEntryIds: [E1, E2],
      },
    );
  });

  it('answers conflictingEntries when one field differs', () => {
    const merged = mergeOpenEntries([
      { id: E1, locationUrl: CAIRO_URL, locationPlusCode: null },
      { id: E2, locationUrl: LINK, locationPlusCode: null },
    ]);
    expect(merged).toEqual({ texts: null, entryIds: [E1, E2], entryProblem: 'conflictingEntries' });
    expect(deriveLocation({ ...merged, resolvedLink: null, reference: noReference })).toMatchObject(
      {
        reason: 'conflictingEntries',
        seenText: null,
        seenEntryIds: [E1, E2],
      },
    );
  });

  it('answers noEntry without entries', () => {
    expect(mergeOpenEntries([])).toEqual({ texts: null, entryIds: [], entryProblem: 'noEntry' });
  });

  it('gives the common bank code, or null when the codes differ', () => {
    expect(commonBankCode(['NBE', 'NBE'])).toBe('NBE');
    expect(commonBankCode(['NBE', 'CIB'])).toBeNull();
    expect(commonBankCode(['NBE', null])).toBeNull();
    expect(commonBankCode([])).toBeNull();
  });
});

describe('referenceFor (DM-34)', () => {
  const BRANCH = '0000000000000000000000b1';
  let n = 0;
  const pin = (area: string, lat: number, lng: number, over: Partial<ReferencePoolEntry> = {}) => {
    n += 1;
    return {
      machineId: `m${String(n)}`,
      branchId: BRANCH,
      area,
      machineDeleted: false,
      status: 'located' as const,
      lat,
      lng,
      needsReview: false,
      source: 'registerUrl' as const,
      warnings: [],
      ...over,
    };
  };

  it('uses the same area (trimmed, case-folded) before the branch', () => {
    const pool = [
      pin('منطقة تجريبية 1', 30.0, 31.0),
      pin(' Zone A ', 30.1, 31.1),
      pin('zone a', 30.2, 31.2),
      pin('zone a', 30.3, 31.3),
    ];
    expect(referenceFor(pool, BRANCH, 'ZONE A', 'self')).toEqual({
      lat: 30.2,
      lng: 31.2,
      basis: 'area',
      machines: 3,
      weak: false,
    });
    expect(referenceFor(pool, BRANCH, 'منطقة تجريبية 9', 'self')).toMatchObject({
      basis: 'branch',
      machines: 4,
    });
  });

  it('takes the median, so an outlier does not move it', () => {
    const pool = [
      pin('a', 30.0, 31.0),
      pin('a', 30.01, 31.01),
      pin('a', 30.02, 31.02),
      pin('a', 39, 39),
    ];
    // Even count: the mean of the two middle values.
    expect(referenceFor(pool, BRANCH, 'a', 'self')).toMatchObject({ lat: 30.015, lng: 31.015 });
    expect(referenceFor([...pool, pin('a', 30.03, 31.03)], BRANCH, 'a', 'self')).toMatchObject({
      lat: 30.02,
      lng: 31.02,
    });
  });

  it('excludes review pins, short-code pins, pins with warnings, deleted machines, other branches and itself', () => {
    const self = pin('a', 30.0, 31.0, { machineId: 'self' });
    const pool = [
      self,
      pin('a', 30.1, 31.1, { needsReview: true }),
      pin('a', 30.1, 31.1, { source: 'registerShortCode' }),
      pin('a', 30.1, 31.1, { warnings: ['outsideEgypt'] }),
      pin('a', 30.1, 31.1, { machineDeleted: true }),
      pin('a', 30.1, 31.1, { branchId: '0000000000000000000000b2' }),
      pin('a', 30.1, 31.1, { status: 'unlocated', lat: null, lng: null }),
    ];
    expect(referenceFor(pool, BRANCH, 'a', 'self')).toBeNull();
    expect(referenceFor([...pool, pin('a', 30.2, 31.2)], BRANCH, 'a', 'self')).toMatchObject({
      lat: 30.2,
      machines: 1,
    });
  });

  it('marks a 2-pin basis, and a basis pin 0.5° away, as weak', () => {
    expect(referenceFor([pin('a', 30, 31), pin('a', 30.01, 31.01)], BRANCH, 'a', 'x')?.weak).toBe(
      true,
    );
    expect(
      referenceFor(
        [pin('a', 30, 31), pin('a', 30.01, 31.01), pin('a', 30.02, 31.5)],
        BRANCH,
        'a',
        'x',
      )?.weak,
    ).toBe(true);
    expect(
      referenceFor(
        [pin('a', 30, 31), pin('a', 30.01, 31.01), pin('a', 30.02, 31.02)],
        BRANCH,
        'a',
        'x',
      )?.weak,
    ).toBe(false);
  });

  it('no reference → shortPlusCodeNoReference', () => {
    expect(
      derive({ plusCode: '26VP+Q7' }, { reference: referenceLookup([], BRANCH, 'a', 'x') }),
    ).toMatchObject({
      status: 'unlocated',
      reason: 'shortPlusCodeNoReference',
    });
  });

  it("referenceLookup answers the URL's own viewport first, never weak", () => {
    expect(referenceLookup([], BRANCH, 'a', 'x')({ lat: 30.05, lng: 31.2 })).toEqual({
      lat: 30.05,
      lng: 31.2,
      basis: 'url',
      machines: 0,
      weak: false,
    });
  });
});

describe('bestCandidateIsShortCode (sync pass 2)', () => {
  const ask = (
    texts: Partial<AtmMapLocationTexts>,
    resolvedLink: DeriveInput['resolvedLink'] = null,
  ) =>
    bestCandidateIsShortCode({
      texts: { plusCode: texts.plusCode ?? null, url: texts.url ?? null },
      entryProblem: null,
      resolvedLink,
    });

  it('is true when nothing outranks the short code', () => {
    expect(ask({ plusCode: '26VP+Q7' })).toBe(true);
    expect(ask({ plusCode: '26VP+Q7', url: LINK })).toBe(true);
    expect(ask({ plusCode: '26VP+Q7', url: 'https://www.google.com/maps/@30.05,31.24,15z' })).toBe(
      true,
    );
  });

  it('is false when coordinates, a full code or a resolved link outrank it, or there is none', () => {
    expect(ask({ plusCode: '26VP+Q7', url: CAIRO_URL })).toBe(false);
    expect(ask({ plusCode: '26VP+Q7', url: 'https://plus.codes/8G2H26VP+Q7' })).toBe(false);
    expect(ask({ plusCode: '26VP+Q7', url: LINK }, resolved(LINK, 30, 31))).toBe(false);
    expect(ask({ url: CAIRO_URL })).toBe(false);
  });
});

describe('hasShortCodeCandidate / pinHolds (sync passes 1a, 1b and the pool)', () => {
  it('only a short Plus Code anywhere in the texts makes a derivation read the pool', () => {
    const ask = (texts: Partial<AtmMapLocationTexts>) =>
      hasShortCodeCandidate({
        texts: { plusCode: texts.plusCode ?? null, url: texts.url ?? null },
        entryProblem: null,
      });
    expect(ask({ url: CAIRO_URL })).toBe(false);
    expect(ask({ plusCode: '8G2H26VP+Q7' })).toBe(false);
    expect(ask({ plusCode: '26VP+Q7', url: CAIRO_URL })).toBe(true);
    expect(hasShortCodeCandidate({ texts: null, entryProblem: 'conflictingEntries' })).toBe(false);
  });

  it('a pin holds while the register text equals the text it was set against (row 3)', () => {
    const text: AtmMapLocationTexts = { plusCode: null, url: CAIRO_URL };
    expect(pinHolds({ pinned: true, pinText: text }, { plusCode: '', url: ` ${CAIRO_URL} ` })).toBe(
      true,
    );
    expect(pinHolds({ pinned: true, pinText: text }, { plusCode: null, url: LINK })).toBe(false);
    expect(pinHolds({ pinned: false, pinText: text }, text)).toBe(false);
  });
});

describe('applyDerivation — the precedence table (DM-2)', () => {
  const A: AtmMapLocationTexts = { plusCode: null, url: CAIRO_URL };
  const B: AtmMapLocationTexts = { plusCode: null, url: LINK };

  const pinned = (over: Partial<ExistingLocation> = {}): ExistingLocation => ({
    status: 'located',
    lat: 30.05,
    lng: 31.25,
    source: 'manual',
    needsReview: false,
    reason: null,
    warnings: [],
    pinned: true,
    pinText: A,
    seenText: A,
    seenEntryIds: [E1],
    sourceField: null,
    reference: null,
    shortLink: null,
    ...over,
  });

  const asExisting = (d: Derived, over: Partial<ExistingLocation> = {}): ExistingLocation => ({
    status: d.status,
    lat: d.lat,
    lng: d.lng,
    source: d.source,
    needsReview: d.needsReview,
    reason: d.reason,
    warnings: d.warnings,
    pinned: false,
    pinText: null,
    seenText: d.seenText,
    seenEntryIds: d.seenEntryIds,
    sourceField: d.sourceField,
    reference: d.reference,
    shortLink: null,
    ...over,
  });

  it('row 1: no document → insert the derivation, unpinned', () => {
    const outcome = applyDerivation(null, derive({ url: LINK }), B);
    expect(outcome).toMatchObject({
      row: 1,
      write: 'insert',
      pointChanged: false,
      replacedPin: false,
    });
    expect(outcome.set).toMatchObject({
      pinned: false,
      status: 'unlocated',
      reason: 'shortLink',
      shortLink: {
        url: LINK,
        status: 'pending',
        attempts: 0,
        viewportOnly: false,
        claimedAt: null,
      },
    });
    expect(applyDerivation(null, derive({ url: CAIRO_URL }), A)).toMatchObject({
      pointChanged: true,
      set: { shortLink: null },
    });
  });

  it('row 2: unpinned — writes only when a stored field differs', () => {
    const d = derive({ url: CAIRO_URL });
    expect(applyDerivation(asExisting(d), d, A)).toMatchObject({ row: 2, write: null, set: {} });
    const moved = derive({ url: 'https://www.google.com/maps?q=30.05,31.24' });
    expect(applyDerivation(asExisting(d), moved, moved.seenText)).toMatchObject({
      row: 2,
      write: 'update',
      pointChanged: true,
      set: { lat: 30.05, lng: 31.24, pinned: false },
    });
    // Only the entry ids moved: written, the point did not change.
    const reread = derive({ url: CAIRO_URL }, { entryIds: [E1, E2] });
    expect(applyDerivation(asExisting(d), reread, A)).toMatchObject({
      write: 'update',
      pointChanged: false,
      set: { seenEntryIds: [E1, E2] },
    });
  });

  it('row 2: an unchanged short link keeps its stored result; a new one is queued', () => {
    const stored: StoredShortLink = {
      url: LINK,
      status: 'failed',
      lat: null,
      lng: null,
      viewportOnly: false,
      failure: 'noCoordinates',
      attempts: 1,
      lastAttemptAt: new Date(0),
      claimedAt: null,
    };
    const failed = derive({ url: LINK }, { resolvedLink: stored });
    const existing = asExisting(derive({ url: LINK }), { shortLink: stored });
    const outcome = applyDerivation(existing, failed, B);
    expect(outcome.set.shortLink).toBe(stored);
    const other = derive({ url: 'https://maps.app.goo.gl/Other' });
    expect(applyDerivation(existing, other, other.seenText).set.shortLink).toMatchObject({
      url: 'https://maps.app.goo.gl/Other',
      status: 'pending',
      attempts: 0,
    });
  });

  it('row 3: pinned and the text unchanged → the point stays; seen fields only when they differ', () => {
    const d = derive({ url: CAIRO_URL });
    expect(applyDerivation(pinned(), d, A)).toMatchObject({ row: 3, write: null, set: {} });
    const reread = derive({ url: CAIRO_URL }, { entryIds: [E1, E2] });
    const outcome = applyDerivation(pinned(), reread, A);
    expect(outcome).toMatchObject({ row: 3, write: 'update', pointChanged: false });
    expect(outcome.set).toEqual({ seenText: A, seenEntryIds: [E1, E2] });
  });

  it('row 3: a short link queued while the text had moved is dropped once it moves back', () => {
    const queued = nextLink(LINK);
    const outcome = applyDerivation(
      pinned({ seenText: B, shortLink: queued }),
      derive({ url: CAIRO_URL }),
      A,
    );
    expect(outcome).toMatchObject({ row: 3, write: 'update' });
    expect(outcome.set).toEqual({ seenText: A, seenEntryIds: [E1], shortLink: null });
  });

  it('row 4: pinned, the text changed and gives a point → replace, provenance cleared', () => {
    const moved = derive({ url: 'https://www.google.com/maps?q=30.06,31.26' });
    const outcome = applyDerivation(pinned(), moved, moved.seenText);
    expect(outcome).toMatchObject({
      row: 4,
      write: 'update',
      pointChanged: true,
      replacedPin: true,
    });
    expect(outcome.set).toMatchObject({
      lat: 30.06,
      lng: 31.26,
      source: 'registerUrl',
      pinned: false,
      needsReview: false,
      pinText: null,
      pinEntryIds: [],
      reviewedBy: null,
      reviewedByName: null,
      reviewedAt: null,
      manualText: null,
      moveReason: null,
    });
  });

  it('row 4: needsReview as derived', () => {
    const viewport = derive({ url: 'https://www.google.com/maps/@30.06,31.26,15z' });
    expect(applyDerivation(pinned(), viewport, viewport.seenText).set).toMatchObject({
      needsReview: true,
      warnings: ['viewportOnly'],
      pinned: false,
    });
  });

  it('row 5: pinned + changed text + unlocated → pin kept, seenText updated, pinText unchanged', () => {
    const cleared = derive({ url: 'hello' });
    const outcome = applyDerivation(pinned(), cleared, cleared.seenText);
    expect(outcome).toMatchObject({
      row: 5,
      write: 'update',
      pointChanged: false,
      replacedPin: false,
    });
    expect(outcome.set).toEqual({ seenText: { plusCode: null, url: 'hello' }, seenEntryIds: [E1] });
    expect(outcome.set).not.toHaveProperty('lat');
    expect(outcome.set).not.toHaveProperty('pinText');
    expect(outcome.set).not.toHaveProperty('pinned');
  });

  it('the DM-2 scenario: pin at AV = A; AV becomes short link B; sync keeps the pin and queues B; B resolves → the pin is replaced', () => {
    // Sync after the register changed to B.
    const sync = derive({ url: LINK });
    const first = applyDerivation(pinned(), sync, B);
    expect(first).toMatchObject({ row: 5, write: 'update' });
    expect(first.set.shortLink).toMatchObject({ url: LINK, status: 'pending' });
    const afterSync = pinned({
      seenText: first.set.seenText ?? null,
      shortLink: first.set.shortLink ?? null,
    });

    // The resolver: the stored result, then the re-derivation from the stored seenText.
    const result: StoredShortLink = {
      ...(afterSync.shortLink as StoredShortLink),
      status: 'resolved',
      lat: 30.07,
      lng: 31.27,
      attempts: 1,
      lastAttemptAt: new Date(0),
    };
    const afterResolve = { ...afterSync, shortLink: result };
    const rederived = deriveLocation({
      texts: afterResolve.seenText,
      entryIds: [E1],
      entryProblem: null,
      resolvedLink: result,
      reference: noReference,
    });
    const second = applyDerivation(afterResolve, rederived, afterResolve.seenText);
    expect(second).toMatchObject({ row: 4, replacedPin: true });
    expect(second.set).toMatchObject({
      lat: 30.07,
      lng: 31.27,
      source: 'registerShortLink',
      pinned: false,
      pinText: null,
      shortLink: result,
    });
  });
});

function nextLink(url: string): StoredShortLink {
  return {
    url,
    status: 'pending',
    lat: null,
    lng: null,
    viewportOnly: false,
    failure: null,
    attempts: 0,
    lastAttemptAt: null,
    claimedAt: null,
  };
}
