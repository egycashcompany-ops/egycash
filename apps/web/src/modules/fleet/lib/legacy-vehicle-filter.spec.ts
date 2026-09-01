// A saved registry link, read after the vehicle filter split into two controls.
import { describe, expect, it } from 'vitest';
import { migrateLegacyVehicleCodeParam } from './legacy-vehicle-filter';

const run = (query: string, namesAVehicle: boolean): string | null => {
  const next = migrateLegacyVehicleCodeParam(new URLSearchParams(query), namesAVehicle);
  return next === null ? null : next.toString();
};

describe('a link written before the vehicle-code picker', () => {
  it('sends a code that NAMES a car to the picker — the same rows as before', () => {
    expect(run('code=FLT210', true)).toBe('vehicleCodes=FLT210');
  });

  it('sends a PARTIAL code to `search`, where substring still lives', () => {
    // `?code=FLT21` meant "codes CONTAINING FLT21". Read exactly it would find nothing.
    expect(run('code=FLT21', false)).toBe('search=FLT21');
  });

  it('keeps every other filter on the link exactly as it was', () => {
    expect(run('status=active&code=FLT210&page=3', true)).toBe(
      'status=active&page=3&vehicleCodes=FLT210',
    );
    expect(run('status=active&code=FLT21&page=3', false)).toBe('status=active&page=3&search=FLT21');
  });

  it('leaves a link alone when there is nothing to migrate', () => {
    expect(run('status=active', true)).toBeNull();
    expect(run('vehicleCodes=FLT210', true)).toBeNull();
    expect(run('', false)).toBeNull();
  });

  it('treats an empty or blank `code` as nothing to migrate', () => {
    expect(run('code=', true)).toBeNull();
    expect(run('code=%20%20', false)).toBeNull();
  });

  it('does not overwrite what the reader already chose, in either direction', () => {
    // Both present means the newer control has been used since; the legacy value is dropped rather
    // than promoted over the later choice.
    expect(run('code=FLT210&vehicleCodes=FLT211', true)).toBe('vehicleCodes=FLT211');
    expect(run('code=FLT21&search=ZZ', false)).toBe('search=ZZ');
  });

  it('does not confuse the two destinations', () => {
    // A code that names a car goes to the picker even when `search` is busy, and vice versa.
    expect(run('code=FLT210&search=ZZ', true)).toBe('search=ZZ&vehicleCodes=FLT210');
    expect(run('code=FLT21&vehicleCodes=FLT211', false)).toBe('vehicleCodes=FLT211&search=FLT21');
  });

  it('keeps a hyphenated legacy code whole on its way to the picker', () => {
    expect(run('code=A-15', true)).toBe('vehicleCodes=A-15');
  });
});
