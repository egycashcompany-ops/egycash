// Reading one register cell (docs/12-planning/atm-map-zones.md §4.2, §9.2). Every URL shape below
// is one Google Maps actually produces (the share sheet, the address bar, a place card, a search, a
// directions link) or one the register's free text holds; every coordinate is synthetic.
import { describe, expect, it } from 'vitest';
import {
  haversineMeters,
  insideEgypt,
  isGoogleMapsUrl,
  isShortLinkUrl,
  pointFromGoogleUrl,
  readLocationText,
  type LocationCandidate,
} from './maps-text';

/** The single candidate a cell holds. */
const one = (cell: string): LocationCandidate => {
  const found = readLocationText(cell);
  expect(found, cell).toHaveLength(1);
  return found[0] as LocationCandidate;
};

const pin = (lat: number, lng: number, ambiguous = false): LocationCandidate => ({
  kind: 'coordinates',
  lat,
  lng,
  via: 'url',
  ambiguous,
});

describe('Google Maps URLs', () => {
  it("prefers the place's own !3d!4d point over the map centre @", () => {
    expect(
      one(
        'https://www.google.com/maps/place/Cairo+Tower/@30.9999999,31.9999999,17z/data=!4m6!3m5!1s0x0:0x0!8m2!3d30.0444196!4d31.2357116',
      ),
    ).toEqual(pin(30.04442, 31.235712));
  });

  it('reads ?q=, ?q=loc: and api=1&query= as a pin', () => {
    expect(one('https://maps.google.com/?q=30.0444196,31.2357116')).toEqual(
      pin(30.04442, 31.235712),
    );
    expect(one('https://www.google.com/maps?q=loc:30.0444,31.2357')).toEqual(pin(30.0444, 31.2357));
    expect(one('https://www.google.com/maps/search/?api=1&query=30.0444,31.2357')).toEqual(
      pin(30.0444, 31.2357),
    );
    expect(one('https://www.google.com/maps/dir/?api=1&destination=30.0444,31.2357')).toEqual(
      pin(30.0444, 31.2357),
    );
    // A `(label)` suffix, as Google encodes it.
    expect(one('https://www.google.com/maps?q=30.0444,31.2357%28Branch%29')).toEqual(
      pin(30.0444, 31.2357),
    );
  });

  it('does not read a pair out of a ?q= that is an address', () => {
    expect(one('https://www.google.com/maps?q=Building+26,+30+St')).toEqual({
      kind: 'noCoordinates',
    });
  });

  it('reads ll= or center= alone as a viewport', () => {
    expect(one('https://maps.google.com/?ll=30.0444,31.2357&z=15')).toEqual({
      kind: 'viewport',
      lat: 30.0444,
      lng: 31.2357,
    });
    expect(
      one('https://www.google.com/maps/@?api=1&map_action=map&center=30.0444,31.2357'),
    ).toEqual({
      kind: 'viewport',
      lat: 30.0444,
      lng: 31.2357,
    });
  });

  it('reads a place or search segment that is exactly a pair as a pin', () => {
    expect(one('https://www.google.com/maps/search/30.0444,+31.2357')).toEqual(
      pin(30.0444, 31.2357),
    );
    expect(one('https://www.google.com/maps/place/30.0444,31.2357')).toEqual(pin(30.0444, 31.2357));
  });

  it('reads a named search or place with only an @ as a viewport', () => {
    expect(one('https://www.google.com/maps/search/ATM+Cairo/@30.05,31.24,15z')).toEqual({
      kind: 'viewport',
      lat: 30.05,
      lng: 31.24,
    });
    expect(one('https://www.google.com/maps/place/Some+Bank/@30.06,31.25,17z')).toEqual({
      kind: 'viewport',
      lat: 30.06,
      lng: 31.25,
    });
    // A place name copied unencoded stays part of the URL.
    expect(one('https://www.google.com/maps/place/بنك+تجريبي/@30.06,31.25,17z')).toEqual({
      kind: 'viewport',
      lat: 30.06,
      lng: 31.25,
    });
  });

  it('never reads a viewport off a directions URL', () => {
    expect(one('https://www.google.com/maps/dir/Cairo/Giza/@30,31,12z')).toEqual({
      kind: 'noCoordinates',
    });
  });

  it('keeps the first of two !3d!4d pairs, ambiguous when they are more than 50 m apart', () => {
    expect(
      one('https://www.google.com/maps/place/X/data=!3d30.0444!4d31.2357!5m1!3d30.05!4d31.2357'),
    ).toEqual(pin(30.0444, 31.2357, true));
    expect(
      one('https://www.google.com/maps/place/X/data=!3d30.0444!4d31.2357!5m1!3d30.0446!4d31.2357'),
    ).toEqual(pin(30.0444, 31.2357, false));
  });

  it('reads a short Plus Code in a place segment, with the URL viewport as its reference', () => {
    expect(one('https://www.google.com/maps/place/26VP%2BQ7+Cairo/@30.05,31.2,17z')).toEqual({
      kind: 'shortPlusCode',
      code: '26VP+Q7',
      urlReference: { lat: 30.05, lng: 31.2 },
    });
  });

  it('prefers a full Plus Code in the place segment over the viewport', () => {
    expect(one('https://www.google.com/maps/place/8G2H26VP%2BQ7/@30.1,31.3,17z')).toEqual({
      kind: 'plusCode',
      code: '8G2H26VP+Q7',
    });
  });

  it('reads a DMS place', () => {
    expect(
      one(
        "https://www.google.com/maps/place/30%C2%B002'39.8%22N+31%C2%B014'08.5%22E/@30.0443889,31.2335195,17z",
      ),
    ).toEqual(pin(30.044389, 31.235694));
  });

  it('names a named place with no point', () => {
    expect(one('https://www.google.com/maps/search/?api=1&query=Cairo+Tower')).toEqual({
      kind: 'noCoordinates',
    });
  });

  it('answers invalidCoordinates for a pin off the Earth', () => {
    expect(one('https://www.google.com/maps?q=95.1,31.2')).toEqual({ kind: 'invalidCoordinates' });
  });
});

describe('short links and other hosts', () => {
  it('names maps.app.goo.gl and goo.gl/maps as short links', () => {
    expect(one('https://maps.app.goo.gl/AbCd123')).toEqual({
      kind: 'shortLink',
      url: 'https://maps.app.goo.gl/AbCd123',
    });
    expect(one('https://goo.gl/maps/AbCd123')).toEqual({
      kind: 'shortLink',
      url: 'https://goo.gl/maps/AbCd123',
    });
  });

  it('does not take goo.gl/mapsX or another goo.gl link for a map link', () => {
    expect(one('https://goo.gl/mapsX')).toEqual({ kind: 'noCoordinates' });
    expect(one('https://goo.gl/other')).toEqual({ kind: 'noCoordinates' });
  });

  it('never mines digits out of a URL that is not Google Maps', () => {
    expect(one('https://example.com/@30,31')).toEqual({ kind: 'noCoordinates' });
    expect(one('https://www.google.com/search?q=30.0444,31.2357')).toEqual({
      kind: 'noCoordinates',
    });
  });

  it('reads plus.codes/<code> without turning its + into a space', () => {
    expect(one('https://plus.codes/8G2H26VP+Q7')).toEqual({
      kind: 'plusCode',
      code: '8G2H26VP+Q7',
    });
    expect(one('https://plus.codes/26VP+Q7')).toEqual({
      kind: 'shortPlusCode',
      code: '26VP+Q7',
      urlReference: null,
    });
  });

  it('finds a scheme-less short link at the start of the cell and after other words', () => {
    expect(one('maps.app.goo.gl/abc')).toEqual({
      kind: 'shortLink',
      url: 'https://maps.app.goo.gl/abc',
    });
    expect(readLocationText('الموقع: maps.app.goo.gl/abc')).toContainEqual({
      kind: 'shortLink',
      url: 'https://maps.app.goo.gl/abc',
    });
  });

  it('strips punctuation and Arabic text stuck to a short link', () => {
    expect(readLocationText('https://maps.app.goo.gl/abc)،')).toEqual([
      { kind: 'shortLink', url: 'https://maps.app.goo.gl/abc' },
    ]);
    expect(readLocationText('https://maps.app.goo.gl/abcالقاهرة')[0]).toEqual({
      kind: 'shortLink',
      url: 'https://maps.app.goo.gl/abc',
    });
  });

  it('answers unreadable for a URL that does not parse', () => {
    expect(one('https://')).toEqual({ kind: 'unreadable' });
  });
});

describe('plain text', () => {
  it('reads a whole-field decimal pair, Arabic comma included', () => {
    const expected = {
      kind: 'coordinates',
      lat: 30.0444,
      lng: 31.2357,
      via: 'text',
      ambiguous: false,
    };
    expect(one('30.0444, 31.2357')).toEqual(expected);
    expect(one('30.0444،31.2357')).toEqual(expected);
  });

  it('answers invalidCoordinates for a pair off the Earth', () => {
    expect(one('91, 0')).toEqual({ kind: 'invalidCoordinates' });
  });

  it('reads a full Plus Code, and refuses one with fewer than 10 digits', () => {
    expect(one('8G2H26VP+Q7')).toEqual({ kind: 'plusCode', code: '8G2H26VP+Q7' });
    expect(one('8g2h26vp+q7')).toEqual({ kind: 'plusCode', code: '8G2H26VP+Q7' });
    expect(one('8G2H26VP+')).toEqual({ kind: 'unreadable' });
  });

  it('reads a short Plus Code and ignores the place name after it', () => {
    expect(one('26VP+Q7 القاهرة')).toEqual({
      kind: 'shortPlusCode',
      code: '26VP+Q7',
      urlReference: null,
    });
  });

  it('reads DMS with either hemisphere first, and S/W as negative', () => {
    const cairo = {
      kind: 'coordinates',
      lat: 30.044389,
      lng: 31.235694,
      via: 'text',
      ambiguous: false,
    };
    expect(one(`30°02'39.8"N 31°14'08.5"E`)).toEqual(cairo);
    expect(one(`31°14'08.5"E 30°02'39.8"N`)).toEqual(cairo);
    expect(one('30°02′39.8″N 31°14′08.5″E')).toEqual(cairo);
    expect(one(`33°52'07.7"S 151°12'33.5"W`)).toEqual({
      kind: 'coordinates',
      lat: -33.868806,
      lng: -151.209306,
      via: 'text',
      ambiguous: false,
    });
  });

  it('refuses DMS with 60 minutes, or two latitudes', () => {
    expect(one(`30°60'00.0"N 31°14'08.5"E`)).toEqual({ kind: 'unreadable' });
    expect(one(`30°02'39.8"N 31°14'08.5"N`)).toEqual({ kind: 'unreadable' });
  });

  it('answers unreadable for anything else', () => {
    expect(one('hello')).toEqual({ kind: 'unreadable' });
    expect(one('30.0444, 31.2357 near the bank')).toEqual({ kind: 'unreadable' });
  });

  it('gives an empty cell no candidate', () => {
    expect(readLocationText('')).toEqual([]);
    expect(readLocationText('   ')).toEqual([]);
  });
});

describe('several candidates in one cell', () => {
  it('returns two URLs as two candidates, in order', () => {
    expect(
      readLocationText('https://maps.app.goo.gl/abc https://www.google.com/maps?q=30.0444,31.2357'),
    ).toEqual([{ kind: 'shortLink', url: 'https://maps.app.goo.gl/abc' }, pin(30.0444, 31.2357)]);
  });

  it('places the text left over by its position in the cell', () => {
    expect(readLocationText('26VP+Q7 https://maps.app.goo.gl/abc')).toEqual([
      { kind: 'shortPlusCode', code: '26VP+Q7', urlReference: null },
      { kind: 'shortLink', url: 'https://maps.app.goo.gl/abc' },
    ]);
  });
});

describe('hosts', () => {
  it('recognises the Google Maps hosts exactly', () => {
    expect(isGoogleMapsUrl(new URL('https://www.google.com.eg/maps/place/x'))).toBe(true);
    expect(isGoogleMapsUrl(new URL('https://GOOGLE.com./maps'))).toBe(true);
    expect(isGoogleMapsUrl(new URL('https://maps.google.com/'))).toBe(true);
    expect(isGoogleMapsUrl(new URL('https://www.google.com/mapsXYZ'))).toBe(false);
    expect(isGoogleMapsUrl(new URL('https://www.google.com/search?q=x'))).toBe(false);
    expect(isGoogleMapsUrl(new URL('https://evil-google.com/maps'))).toBe(false);
  });

  it('recognises the short-link hosts exactly', () => {
    expect(isShortLinkUrl(new URL('https://maps.app.goo.gl/x'))).toBe(true);
    expect(isShortLinkUrl(new URL('https://goo.gl/maps'))).toBe(true);
    expect(isShortLinkUrl(new URL('https://goo.gl/maps/x'))).toBe(true);
    expect(isShortLinkUrl(new URL('https://goo.gl/mapsX'))).toBe(false);
  });
});

describe('pointFromGoogleUrl (the resolver reads redirect targets with it)', () => {
  it('returns a pin, a viewport only, a Plus Code centre, or nothing', () => {
    expect(
      pointFromGoogleUrl(new URL('https://www.google.com/maps/place/X/data=!3d30.0444!4d31.2357')),
    ).toEqual({
      lat: 30.0444,
      lng: 31.2357,
      viewportOnly: false,
    });
    expect(pointFromGoogleUrl(new URL('https://www.google.com/maps/@30.05,31.24,15z'))).toEqual({
      lat: 30.05,
      lng: 31.24,
      viewportOnly: true,
    });
    expect(pointFromGoogleUrl(new URL('https://www.google.com/maps/place/8G2H26VP%2BQ7'))).toEqual({
      lat: 30.044438,
      lng: 31.235688,
      viewportOnly: false,
    });
    expect(pointFromGoogleUrl(new URL('https://www.google.com/maps/place/Cairo+Tower'))).toBeNull();
  });
});

describe('distances and the Egypt box', () => {
  it('measures with R = 6,371,008.8 m', () => {
    expect(
      haversineMeters({ lat: 30.0444, lng: 31.2357 }, { lat: 30.0534, lng: 31.2357 }),
    ).toBeCloseTo(1000.76, 1);
    expect(
      haversineMeters({ lat: 30.0444, lng: 31.2357 }, { lat: 30.0533, lng: 31.2357 }),
    ).toBeCloseTo(989.64, 1);
  });

  it('checks the DM-35 box', () => {
    expect(insideEgypt({ lat: 30.0444, lng: 31.2357 })).toBe(true);
    expect(insideEgypt({ lat: 24.0889, lng: 32.8998 })).toBe(true);
    expect(insideEgypt({ lat: 0, lng: 0 })).toBe(false);
    expect(insideEgypt({ lat: 21.0, lng: 31.0 })).toBe(false);
  });
});
