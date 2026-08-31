// A saved registry link, read after the vehicle filter changed meaning.
import { describe, expect, it } from 'vitest';
import { migrateLegacyVehicleCodeParam } from './legacy-vehicle-filter';

const run = (query: string): string | null => {
  const next = migrateLegacyVehicleCodeParam(new URLSearchParams(query));
  return next === null ? null : next.toString();
};

describe('a link written before the vehicle-code picker', () => {
  it('sends a legacy code to `search`, where substring still lives', () => {
    // `?code=FLT21` meant "codes CONTAINING FLT21". Routed to `vehicleCodes` it would be read
    // exactly, and find nothing.
    expect(run('code=FLT21')).toBe('search=FLT21');
  });

  it('keeps every other filter on the link exactly as it was', () => {
    expect(run('status=active&code=FLT21&page=3')).toBe('status=active&page=3&search=FLT21');
  });

  it('leaves a link alone when there is nothing to migrate', () => {
    expect(run('status=active')).toBeNull();
    expect(run('vehicleCodes=FLT210')).toBeNull();
    expect(run('')).toBeNull();
  });

  it('treats an empty or blank `code` as nothing to migrate', () => {
    expect(run('code=')).toBeNull();
    expect(run('code=%20%20')).toBeNull();
  });

  it('does not overwrite a `search` the reader already has', () => {
    // Both present means the newer control was used since; the legacy value is dropped, not
    // promoted over what was chosen last.
    expect(run('code=FLT21&search=ZZ')).toBe('search=ZZ');
  });

  it('does not touch a picker selection that is already there', () => {
    expect(run('code=FLT21&vehicleCodes=FLT210')).toBe('vehicleCodes=FLT210&search=FLT21');
  });
});
