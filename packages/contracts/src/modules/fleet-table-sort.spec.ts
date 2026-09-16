// The order a Fleet table is read in, as a wire format.
//
// One string, written by the browser into `?sort=` and read by the API off the query — which is
// why it lives in the contract and is tested here rather than twice on either side of it. What is
// pinned below is mostly what happens to a MALFORMED one, because the string is in an address bar
// that anybody can edit and a request that 400s over a stray comma helps nobody.
import { describe, expect, it } from 'vitest';
import {
  FLEET_SORT_MAX,
  fleetSortQuery,
  formatFleetSort,
  parseFleetSort,
  ListFleetVehiclesQuerySchema,
} from './fleet';

describe('reading the order off the wire', () => {
  it('takes the columns in the order the reader clicked them', () => {
    expect(parseFleetSort('code:asc,licenseExpiresAt:desc')).toEqual([
      { by: 'code', dir: 'asc' },
      { by: 'licenseExpiresAt', dir: 'desc' },
    ]);
  });

  it('reads one column as one column — the old single sort still parses', () => {
    expect(parseFleetSort('occurredAt:desc')).toEqual([{ by: 'occurredAt', dir: 'desc' }]);
  });

  it('takes a dotted field, which is what a localized name is called', () => {
    expect(parseFleetSort('name.ar:asc')).toEqual([{ by: 'name.ar', dir: 'asc' }]);
  });

  it('answers with nothing at all for nothing at all', () => {
    for (const raw of [null, undefined, '', '   ', ',,,', ':::']) {
      expect(parseFleetSort(raw), JSON.stringify(raw)).toEqual([]);
    }
  });

  it('reads a missing or unrecognized direction as ASCENDING', () => {
    // A hand-typed `?sort=code` is a reader asking for code order, not a malformed request.
    expect(parseFleetSort('code')).toEqual([{ by: 'code', dir: 'asc' }]);
    expect(parseFleetSort('code:sideways')).toEqual([{ by: 'code', dir: 'asc' }]);
  });

  it('keeps a column’s FIRST place when it is named twice', () => {
    // Otherwise «code, expiry, code» would quietly become «expiry, code» and the reader's first
    // click would have moved without them touching it.
    expect(parseFleetSort('code:asc,licenseExpiresAt:desc,code:desc')).toEqual([
      { by: 'code', dir: 'asc' },
      { by: 'licenseExpiresAt', dir: 'desc' },
    ]);
  });

  it('drops a field name no collection could have, and keeps the rest of the line', () => {
    // The database never sees these; dropping them here is the cheaper of the two refusals.
    expect(parseFleetSort('$where:asc,code:asc')).toEqual([{ by: 'code', dir: 'asc' }]);
    expect(parseFleetSort('a b:asc,code:asc')).toEqual([{ by: 'code', dir: 'asc' }]);
    expect(parseFleetSort('..:asc,code:asc')).toEqual([{ by: 'code', dir: 'asc' }]);
  });

  it('stops at the cap rather than sorting by fifty columns', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((f) => `${f}:asc`).join(',');
    expect(parseFleetSort(many)).toHaveLength(FLEET_SORT_MAX);
    expect(parseFleetSort(many).map((s) => s.by)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('tolerates the spaces a person leaves when they edit the address bar', () => {
    expect(parseFleetSort(' code : asc , licenseExpiresAt : desc ')).toEqual([
      { by: 'code', dir: 'asc' },
      { by: 'licenseExpiresAt', dir: 'desc' },
    ]);
  });
});

describe('writing it back', () => {
  it('round-trips whatever it parsed', () => {
    for (const raw of ['code:asc', 'code:asc,licenseExpiresAt:desc', 'name.ar:desc,createdAt:asc']) {
      expect(formatFleetSort(parseFleetSort(raw)), raw).toBe(raw);
    }
  });

  it('answers null for an empty order — nothing to put in the address bar', () => {
    expect(formatFleetSort([])).toBeNull();
  });
});

describe('the query parameter', () => {
  it('is optional, so every existing caller is unchanged', () => {
    const parsed = ListFleetVehiclesQuerySchema.parse({});
    expect(parsed.sort).toBeUndefined();
  });

  it('is accepted by the registry query beside the single sort it did not replace', () => {
    const parsed = ListFleetVehiclesQuerySchema.parse({
      sort: 'code:asc,licenseExpiresAt:desc',
      sortBy: 'code',
      sortDir: 'asc',
    });
    expect(parsed.sort).toBe('code:asc,licenseExpiresAt:desc');
    expect(parsed.sortBy, 'the platform pagination contract is untouched').toBe('code');
  });

  it('refuses a string long enough to be an attack rather than an order', () => {
    expect(fleetSortQuery().safeParse('x'.repeat(201)).success).toBe(false);
  });
});
