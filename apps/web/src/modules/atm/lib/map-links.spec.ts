// Where the map's links go (spec §8.5): the register search, the promoted Google Maps link, the two
// screens' links carrying the branch, and «فتح الرابط الأصلي» for http(s) only.
import { describe, expect, it } from 'vitest';
import { mapsUrl } from '../../operations/lib/maps-link';
import {
  googleMapsUrl,
  machineMapUrl,
  originalLinkHref,
  registerSearchUrl,
  unlocatedMachinesUrl,
} from './map-links';

describe('map links', () => {
  it('searches the register for the machine code', () => {
    expect(registerSearchUrl('ATM 01/2')).toBe('/atm/register?q=ATM%2001%2F2');
  });

  it('hands out the same Google Maps link operations hands out', () => {
    expect(googleMapsUrl({ lat: 30.0444, lng: 31.2357 })).toBe(
      'https://www.google.com/maps?q=30.0444,31.2357',
    );
    expect(mapsUrl).toBe(googleMapsUrl);
  });

  it('carries the branch between the two screens', () => {
    expect(unlocatedMachinesUrl('b1')).toBe('/atm/map/unlocated?branch=b1');
    expect(unlocatedMachinesUrl(null)).toBe('/atm/map/unlocated');
    expect(machineMapUrl('all')).toBe('/atm/map?branch=all');
    expect(machineMapUrl(null)).toBe('/atm/map');
  });

  it('opens an original link only when it is http(s)', () => {
    expect(originalLinkHref(' https://maps.app.goo.gl/abc ')).toBe('https://maps.app.goo.gl/abc');
    expect(originalLinkHref('http://maps.google.com/?q=1,2')).toBe('http://maps.google.com/?q=1,2');
    expect(originalLinkHref('javascript:alert(1)')).toBeNull();
    expect(originalLinkHref('data:text/html,x')).toBeNull();
    expect(originalLinkHref('30.0444, 31.2357')).toBeNull();
    expect(originalLinkHref(null)).toBeNull();
  });
});
