// One vocabulary for "which cars?", and the hyphen that makes it hard.
//
// A vehicle code is free text, so `215-216-217` (three cars) and `A-15` (one car) are the same
// shape. These pin the rule that tells them apart: a hyphenated run is one code when the registry
// knows it by that name, and three when it does not.
import { describe, expect, it } from 'vitest';
import { parseVehicleCodes, splitVehicleCodeList, vehicleCodesQuery } from '../index.js';

describe('parseVehicleCodes — the separators', () => {
  it('reads a single code', () => {
    expect(parseVehicleCodes('215')).toEqual(['215']);
  });

  it('reads commas', () => {
    expect(parseVehicleCodes('215,216,217')).toEqual(['215', '216', '217']);
  });

  it('reads a spaced dash — the way an operator writes a list by hand', () => {
    expect(parseVehicleCodes('215 - 216 - 217')).toEqual(['215', '216', '217']);
  });

  it('reads a bare dash run as several codes', () => {
    expect(parseVehicleCodes('215-216-217')).toEqual(['215', '216', '217']);
  });

  it('is unmoved by whitespace, however much of it', () => {
    expect(parseVehicleCodes('  215 ,   216\t,\n217  ')).toEqual(['215', '216', '217']);
    expect(parseVehicleCodes('215   216')).toEqual(['215', '216']);
  });

  it('reads semicolons and newlines — a paste out of a spreadsheet column', () => {
    expect(parseVehicleCodes('215;216\n217')).toEqual(['215', '216', '217']);
  });

  it('keeps the first writing of a repeated code and drops the rest', () => {
    expect(parseVehicleCodes('215 - 216 - 215 - 217')).toEqual(['215', '216', '217']);
    expect(parseVehicleCodes('215,215,215')).toEqual(['215']);
  });

  it('treats a repeat as a repeat whatever its case', () => {
    expect(parseVehicleCodes('flt210, FLT210')).toEqual(['flt210']);
  });

  it('answers nothing for nothing', () => {
    for (const blank of ['', '   ', ',', ' - ', ',,,', '\n\t']) {
      expect(parseVehicleCodes(blank), JSON.stringify(blank)).toEqual([]);
    }
  });

  it('accepts an array as readily as a string, and still dedupes it', () => {
    expect(parseVehicleCodes(['215', ' 216 ', '215'])).toEqual(['215', '216']);
  });
});

describe('parseVehicleCodes — the hyphen, settled by the registry', () => {
  it('keeps a hyphenated code whole when the registry knows it', () => {
    expect(parseVehicleCodes('A-15', ['A-15'])).toEqual(['A-15']);
    expect(parseVehicleCodes('FLT-210', ['FLT-210', 'FLT-211'])).toEqual(['FLT-210']);
  });

  it('splits the same shape when the registry does NOT know it', () => {
    // Nothing about the string changed — only whether a car answers to it.
    expect(parseVehicleCodes('215-216-217', ['A-15'])).toEqual(['215', '216', '217']);
    expect(parseVehicleCodes('FLT-210', [])).toEqual(['FLT', '210']);
  });

  it('decides each run on its own', () => {
    // One list, both shapes: the known one survives, the unknown one splits.
    expect(parseVehicleCodes('A-15, 215-216', ['A-15'])).toEqual(['A-15', '215', '216']);
  });

  it('matches the registry case-insensitively', () => {
    expect(parseVehicleCodes('a-15', ['A-15'])).toEqual(['a-15']);
  });

  it('splits a hyphenated run when nothing has vouched for it', () => {
    // The default for free text: with no registry to ask, a hyphenated run is several codes. This
    // is why the URL is parsed by `splitVehicleCodeList` instead — see the suite below.
    expect(parseVehicleCodes('A-15')).toEqual(['A', '15']);
    expect(parseVehicleCodes('215-216-217')).toEqual(['215', '216', '217']);
  });

  it('still splits on a SPACED dash even when the whole run is a known code', () => {
    // ` - ` is punctuation a code cannot contain, so it separates regardless of what is known.
    expect(parseVehicleCodes('A - 15', ['A - 15'])).toEqual(['A', '15']);
  });
});

describe('splitVehicleCodeList — the URL, which is canonical', () => {
  it('splits the separators a code cannot contain', () => {
    expect(splitVehicleCodeList('215,216,217')).toEqual(['215', '216', '217']);
    expect(splitVehicleCodeList('215 - 216')).toEqual(['215', '216']);
    expect(splitVehicleCodeList('215 216')).toEqual(['215', '216']);
  });

  it('leaves a hyphen alone — this is what lets `A-15` survive a reload', () => {
    // The filter box already resolved the ambiguity and wrote the answer. Splitting again here
    // would take a code the reader successfully picked and turn it into two codes nobody has.
    expect(splitVehicleCodeList('A-15')).toEqual(['A-15']);
    expect(splitVehicleCodeList('A-15,FLT-210')).toEqual(['A-15', 'FLT-210']);
  });

  it('dedupes, like the other half', () => {
    expect(splitVehicleCodeList('215,216,215')).toEqual(['215', '216']);
  });
});

describe('vehicleCodesQuery — the URL parse, as a schema', () => {
  const schema = vehicleCodesQuery();

  it('parses a comma-joined string into codes', () => {
    expect(schema.parse('215,216,217')).toEqual(['215', '216', '217']);
  });

  it('round-trips a hyphenated code the filter box wrote', () => {
    expect(schema.parse('A-15')).toEqual(['A-15']);
  });

  it('dedupes', () => {
    expect(schema.parse('215,216,215')).toEqual(['215', '216']);
  });

  it('is undefined when nothing was asked — never an empty filter', () => {
    // The distinction the whole feature rests on: `undefined` narrows nothing, `[]` would narrow
    // to nothing. A blank box must be the first.
    expect(schema.parse(undefined)).toBeUndefined();
    expect(schema.parse('')).toBeUndefined();
    expect(schema.parse('  ,  ')).toBeUndefined();
  });

  it('refuses a code longer than the registry allows', () => {
    expect(schema.safeParse('x'.repeat(21)).success).toBe(false);
  });

  it('refuses more codes than a filter bar can mean', () => {
    const many = Array.from({ length: 51 }, (_, i) => `C${String(i)}`).join(',');
    expect(schema.safeParse(many).success).toBe(false);
  });
});
