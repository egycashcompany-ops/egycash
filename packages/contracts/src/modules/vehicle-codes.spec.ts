// One vocabulary for "which cars?", and the hyphen that makes it hard.
//
// A vehicle code is free text, so `A-15` is a legal code and `215-216-217` is three cars written
// together — the characters cannot tell them apart. The separator is therefore the SPACE around a
// dash, not the dash: a code cannot contain a space, so the same text always parses the same way.
import { describe, expect, it } from 'vitest';
import {
  ListFleetVehiclesQuerySchema,
  splitVehicleCodeList,
  vehicleCodeSearchQuery,
  vehicleCodesQuery,
} from '../index.js';

describe('splitVehicleCodeList — the separators', () => {
  it('reads a single code', () => {
    expect(splitVehicleCodeList('215')).toEqual(['215']);
  });

  it('reads commas', () => {
    expect(splitVehicleCodeList('215,216,217')).toEqual(['215', '216', '217']);
  });

  it('reads a SPACED dash — the way an operator writes a list by hand', () => {
    expect(splitVehicleCodeList('215 - 216 - 217')).toEqual(['215', '216', '217']);
  });

  it('reads plain spaces', () => {
    expect(splitVehicleCodeList('215 216 217')).toEqual(['215', '216', '217']);
  });

  it('reads semicolons and newlines — a paste out of a spreadsheet column', () => {
    expect(splitVehicleCodeList('215;216\n217')).toEqual(['215', '216', '217']);
  });

  it('is unmoved by whitespace, however much of it', () => {
    expect(splitVehicleCodeList('  215 ,   216\t,\n217  ')).toEqual(['215', '216', '217']);
  });

  it('keeps the first writing of a repeated code and drops the rest', () => {
    expect(splitVehicleCodeList('215 - 216 - 215 - 217')).toEqual(['215', '216', '217']);
    expect(splitVehicleCodeList('215,215,215')).toEqual(['215']);
  });

  it('treats a repeat as a repeat whatever its case', () => {
    expect(splitVehicleCodeList('flt210, FLT210')).toEqual(['flt210']);
  });

  it('answers nothing for nothing', () => {
    for (const blank of ['', '   ', ',', ' - ', ',,,', '\n\t']) {
      expect(splitVehicleCodeList(blank), JSON.stringify(blank)).toEqual([]);
    }
  });

  it('accepts an array as readily as a string, and still dedupes it', () => {
    expect(splitVehicleCodeList(['215', ' 216 ', '215'])).toEqual(['215', '216']);
  });
});

describe('splitVehicleCodeList — the hyphen, settled by the space around it', () => {
  it('keeps a BARE hyphen inside one code, because a code may genuinely contain one', () => {
    expect(splitVehicleCodeList('A-15')).toEqual(['A-15']);
    expect(splitVehicleCodeList('FLT-210')).toEqual(['FLT-210']);
    expect(splitVehicleCodeList('215-216')).toEqual(['215-216']);
  });

  it('is not fooled by a dash the reader has not finished typing', () => {
    // `150 -` is one code and a half-written separator, not a car called `-`.
    expect(splitVehicleCodeList('150 -')).toEqual(['150']);
    expect(splitVehicleCodeList('150 - ')).toEqual(['150']);
    expect(splitVehicleCodeList('-')).toEqual([]);
    expect(splitVehicleCodeList('- - -')).toEqual([]);
  });

  it('splits on a SPACED dash, because no code contains a space', () => {
    expect(splitVehicleCodeList('215 - 216')).toEqual(['215', '216']);
    expect(splitVehicleCodeList('A - 15')).toEqual(['A', '15']);
  });

  it('reads both shapes in one line, each on its own terms', () => {
    expect(splitVehicleCodeList('A-15 - 215 - FLT-210')).toEqual(['A-15', '215', 'FLT-210']);
    expect(splitVehicleCodeList('A-15,215-216')).toEqual(['A-15', '215-216']);
  });

  it('gives the same answer every time, with nothing to look up', () => {
    // The property the rule exists for: no registry, no search state, no order of events can make
    // the same text mean two different filters.
    for (const text of ['A-15', '215-216-217', '215 - 216']) {
      expect(splitVehicleCodeList(text), text).toEqual(splitVehicleCodeList(text));
    }
  });
});

describe('vehicleCodesQuery — the same parse, as a schema', () => {
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

describe('vehicleCodeSearchQuery — what a vehicle-code box asks the registry', () => {
  it('asks about the CODE, and about no other identifier', () => {
    // The whole point. `search` spans code, plate, chassis and motor at once; a control labelled
    // with the code must never ask it, or a plate offers a car under a code nobody typed.
    expect(vehicleCodeSearchQuery('150')).toEqual({ code: '150' });
    expect(vehicleCodeSearchQuery('150')).not.toHaveProperty('search');
    expect(vehicleCodeSearchQuery('150')).not.toHaveProperty('plateNumber');
    expect(vehicleCodeSearchQuery('150')).not.toHaveProperty('chassisNumber');
    expect(vehicleCodeSearchQuery('150')).not.toHaveProperty('motorNumber');
  });

  it('asks NOTHING for an empty box, rather than narrowing to nothing', () => {
    // Spread into a params object, `{}` has to leave the query unnarrowed — the same distinction
    // `vehicleCodesQuery` draws between `undefined` and `[]`.
    expect(vehicleCodeSearchQuery('')).toEqual({});
    expect(vehicleCodeSearchQuery('   ')).toEqual({});
  });

  it('trims, because the box is typed into', () => {
    expect(vehicleCodeSearchQuery('  150  ')).toEqual({ code: '150' });
  });

  it('produces a query the registry endpoint actually accepts', () => {
    // `.strict()` up there, so a field spelled wrong here would be REJECTED rather than ignored:
    // this is what ties the helper to the endpoint it is built for.
    const parsed = ListFleetVehiclesQuerySchema.parse({
      ...vehicleCodeSearchQuery('150'),
      pageSize: 50,
    });
    expect(parsed.code).toBe('150');
    expect(parsed.search).toBeUndefined();
  });
});
