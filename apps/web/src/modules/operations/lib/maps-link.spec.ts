// Every URL shape Google Maps' Share button actually produces, because "paste the link" is only a
// feature if it works on the link the user is holding.
//
// The samples below are real shapes, not invented ones: the app's share sheet, the desktop address
// bar, the "copy link" on a place card and the directions URL all differ, and two of them carry
// TWO points — the place and the map centre — which are not the same location.
import { describe, expect, it } from 'vitest';
import { mapsUrl, parseMapsLink } from './maps-link';

const CAIRO = { lat: 30.0444196, lng: 31.2357116 };

const point = (input: string): { lat: number; lng: number } => {
  const result = parseMapsLink(input);
  if (!result.ok) throw new Error(`expected a point, got ${result.reason}`);
  return result.coordinates;
};

const failure = (input: string): string => {
  const result = parseMapsLink(input);
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.coordinates)}`);
  return result.reason;
};

describe('the shapes a Google Maps link comes in', () => {
  it('reads the desktop address bar — /maps/@lat,lng,zoom', () => {
    expect(point('https://www.google.com/maps/@30.0444196,31.2357116,15z')).toEqual(CAIRO);
  });

  it('reads a place card, and prefers the PLACE over the map centre', () => {
    // !3d/!4d is where the place IS; the @ is where the map happened to be centred when the link
    // was copied. For a driver those are different sides of a road, so the order matters.
    const url =
      'https://www.google.com/maps/place/Cairo+Tower/@30.9999999,31.9999999,17z/data=!4m6!3m5!1s0x0:0x0!8m2!3d30.0444196!4d31.2357116';
    expect(point(url)).toEqual(CAIRO);
  });

  it('reads the classic ?q= pair', () => {
    expect(point('https://maps.google.com/?q=30.0444196,31.2357116')).toEqual(CAIRO);
  });

  it('reads the ?q=loc: prefix', () => {
    expect(point('https://www.google.com/maps?q=loc:30.0444196,31.2357116')).toEqual(CAIRO);
  });

  it('reads the search and directions URLs', () => {
    expect(point('https://www.google.com/maps/search/?api=1&query=30.0444196,31.2357116')).toEqual(CAIRO);
    expect(
      point('https://www.google.com/maps/dir/?api=1&destination=30.0444196,31.2357116'),
    ).toEqual(CAIRO);
  });

  it('accepts a bare pair, since somebody holding the numbers should not have to find a link', () => {
    expect(point('30.0444196, 31.2357116')).toEqual(CAIRO);
    expect(point('30.0444196,31.2357116')).toEqual(CAIRO);
  });

  it('reads a negative and a southern-hemisphere point', () => {
    expect(point('https://www.google.com/maps/@-33.8688,151.2093,12z')).toEqual({
      lat: -33.8688,
      lng: 151.2093,
    });
  });
});

describe('what it refuses, and why it says which', () => {
  it('names a short link as a short link — it carries no point to read', () => {
    // The point is behind a redirect only Google can resolve, and the browser cannot follow it
    // cross-origin. The user has to open it and copy the full URL, so the message must say so.
    expect(failure('https://maps.app.goo.gl/AbCdEfGh123')).toBe('shortLink');
    expect(failure('https://goo.gl/maps/AbCdEfGh123')).toBe('shortLink');
  });

  it('names a named place with no point', () => {
    expect(failure('https://www.google.com/maps/search/?api=1&query=Cairo+Tower')).toBe(
      'noCoordinates',
    );
  });

  it('names an empty field', () => {
    expect(failure('')).toBe('empty');
    expect(failure('   ')).toBe('empty');
  });

  it('refuses a point that is not on Earth rather than storing it', () => {
    expect(failure('https://www.google.com/maps/@99.5,200.5,15z')).toBe('outOfRange');
    expect(failure('91, 0')).toBe('outOfRange');
  });

  it('does not mine a non-Maps URL for stray digits', () => {
    // A bare pair is only read when the field is NOTHING but a pair. Otherwise a link with an id
    // in it would silently become a location somewhere in the sea.
    expect(failure('https://example.com/branches/12,34/edit')).toBe('noCoordinates');
  });
});

describe('the link handed back to a human', () => {
  it('regenerates a working Maps URL from the stored point', () => {
    expect(mapsUrl(CAIRO)).toBe('https://www.google.com/maps?q=30.0444196,31.2357116');
  });

  it('round-trips: what it generates, it can read back', () => {
    expect(point(mapsUrl(CAIRO))).toEqual(CAIRO);
  });
});
