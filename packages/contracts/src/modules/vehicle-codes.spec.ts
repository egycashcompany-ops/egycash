// One vocabulary for "which cars?", and the hyphen that makes it hard.
//
// A vehicle code is free text, so `A-15` is a legal code and `215-216-217` is three cars written
// together — the characters cannot tell them apart. The separator is therefore the SPACE around a
// dash, not the dash. And a code MAY hold a space — «كورولا 1», «MG 2» — so a word followed by a
// number is one code: the same text still parses the same way, with nothing to look up.
import { describe, expect, it } from 'vitest';
import {
  ListFleetVehiclesQuerySchema,
  normalizeVehicleCode,
  sameVehicleCode,
  splitVehicleCodeList,
  vehicleCodeSearchQuery,
  vehicleCodeTakesNumber,
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

describe('splitVehicleCodeList — a long run of whitespace costs a single pass', () => {
  // The server runs this parser on `?vehicleCodes=` BEFORE any length limit applies, so the time
  // it takes is the time a request can hold the event loop. A run of whitespace with no separator
  // in it used to be re-scanned from every position of it — 16,000 spaces took 210 ms, 64,000 took
  // 3.7 s. The runs are written as one space first; this is the bound that guards it.
  const within = (budgetMs: number, raw: string): string[] => {
    const started = performance.now();
    const codes = splitVehicleCodeList(raw);
    expect(performance.now() - started, `${String(raw.length)} chars`).toBeLessThan(budgetMs);
    return codes;
  };

  it('parses 20,000 spaces in well under 50 ms — and finds no code in them', () => {
    expect(within(50, ' '.repeat(20_000))).toEqual([]);
  });

  it('…nor between two codes, or in a run of spaces and line breaks', () => {
    expect(within(50, `a${' '.repeat(20_000)}b`)).toEqual(['a', 'b']);
    expect(within(50, `كورولا${'\t '.repeat(10_000)}1`)).toEqual(['كورولا 1']);
    expect(within(50, `150${' \n'.repeat(10_000)}151`)).toEqual(['150', '151']);
    expect(within(50, `150${' - '.repeat(7_000)}151`)).toEqual(['150', '151']);
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

  it('splits on a SPACED dash, always — a separator no code is written with', () => {
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

describe('splitVehicleCodeList — a code with a space in it («كورولا 1»)', () => {
  // The owner's report: «لما باجى اعمل فلتر على اى عربيه من اللى بالعربى دى مش بيجيب العربيه و
  // بيسرش اكن الاسم بتاع العربيه حاجه والرقم اللى جمبها حاجه تانيه». The registry's real codes.
  it('reads a word and the number beside it as ONE car', () => {
    expect(splitVehicleCodeList('كورولا 1')).toEqual(['كورولا 1']);
    expect(splitVehicleCodeList('MG 2')).toEqual(['MG 2']);
    expect(splitVehicleCodeList('بيجو 5008')).toEqual(['بيجو 5008']);
    expect(splitVehicleCodeList('فورتشنر 2')).toEqual(['فورتشنر 2']);
    expect(splitVehicleCodeList('كوستر 1')).toEqual(['كوستر 1']);
    expect(splitVehicleCodeList('تويوتا 2')).toEqual(['تويوتا 2']);
  });

  it('still reads two NUMBERS as two cars', () => {
    expect(splitVehicleCodeList('150 151')).toEqual(['150', '151']);
  });

  it('joins one number to a word, not every number after it', () => {
    expect(splitVehicleCodeList('كورولا 1 150')).toEqual(['كورولا 1', '150']);
    expect(splitVehicleCodeList('MG 1 MG 2')).toEqual(['MG 1', 'MG 2']);
  });

  it('keeps the hard separators hard around such a code', () => {
    expect(splitVehicleCodeList('كورولا 1 - كوستر 2')).toEqual(['كورولا 1', 'كوستر 2']);
    expect(splitVehicleCodeList('كورولا 1, كورولا 2')).toEqual(['كورولا 1', 'كورولا 2']);
    expect(splitVehicleCodeList('كورولا 1;كورولا 2\nMG 3')).toEqual([
      'كورولا 1',
      'كورولا 2',
      'MG 3',
    ]);
  });

  it('reads a word with no number as itself', () => {
    expect(splitVehicleCodeList('كولراى')).toEqual(['كولراى']);
    expect(splitVehicleCodeList('كولراى 150')).toEqual(['كولراى 150']);
    expect(splitVehicleCodeList('كولراى كورولا 1')).toEqual(['كولراى', 'كورولا 1']);
  });

  it('writes the space back as ONE space, however much of it was typed or stored', () => {
    expect(splitVehicleCodeList('  كورولا   1  ')).toEqual(['كورولا 1']);
    expect(splitVehicleCodeList('كورولا\t1')).toEqual(['كورولا 1']);
    expect(splitVehicleCodeList(['فورتشنر 2 ', ' فورتشنر  2'])).toEqual(['فورتشنر 2']);
  });

  it('counts Arabic-Indic digits as the number', () => {
    expect(splitVehicleCodeList('كورولا ١')).toEqual(['كورولا ١']);
    expect(splitVehicleCodeList('١٥٠ ١٥١')).toEqual(['١٥٠', '١٥١']);
  });

  it('dedupes such a code whatever its case', () => {
    expect(splitVehicleCodeList('MG 2, mg 2, Mg  2')).toEqual(['MG 2']);
  });

  it('leaves a dashed number a number, and a dashed word a word', () => {
    expect(splitVehicleCodeList('215-216 3')).toEqual(['215-216', '3']);
    expect(splitVehicleCodeList('A-15 2')).toEqual(['A-15 2']);
    expect(splitVehicleCodeList('كورولا -')).toEqual(['كورولا']);
  });

  it('round-trips through the comma-joined URL a filter writes', () => {
    const picked = ['كورولا 1', 'MG 2', '150', 'A-15'];
    expect(splitVehicleCodeList(picked.join(','))).toEqual(picked);
    expect(vehicleCodesQuery().parse(picked.join(','))).toEqual(picked);
  });
});

describe('the words a code is compared by', () => {
  it('normalizeVehicleCode trims and makes every run of whitespace one space', () => {
    expect(normalizeVehicleCode('فورتشنر 2 ')).toBe('فورتشنر 2');
    expect(normalizeVehicleCode('  MG\t 2')).toBe('MG 2');
    expect(normalizeVehicleCode('150')).toBe('150');
  });

  it('sameVehicleCode ignores whitespace and Latin case, nothing else', () => {
    expect(sameVehicleCode('mg 2', 'MG 2')).toBe(true);
    expect(sameVehicleCode('فورتشنر 2 ', 'فورتشنر 2')).toBe(true);
    expect(sameVehicleCode('كورولا 1', 'كورولا 2')).toBe(false);
    expect(sameVehicleCode('كورولا 1', 'كورولا 10')).toBe(false);
  });

  it('vehicleCodeTakesNumber is true for a word, false for a number or a dashed number', () => {
    expect(vehicleCodeTakesNumber('كورولا')).toBe(true);
    expect(vehicleCodeTakesNumber('MG')).toBe(true);
    expect(vehicleCodeTakesNumber('A-15')).toBe(true);
    expect(vehicleCodeTakesNumber('150')).toBe(false);
    expect(vehicleCodeTakesNumber('١٥٠')).toBe(false);
    expect(vehicleCodeTakesNumber('215-216')).toBe(false);
    expect(vehicleCodeTakesNumber('-')).toBe(false);
    expect(vehicleCodeTakesNumber('')).toBe(false);
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
    expect(schema.safeParse(`${'x'.repeat(18)} 12`).success).toBe(false);
    expect(schema.parse(`${'x'.repeat(17)} 12`)).toEqual([`${'x'.repeat(17)} 12`]);
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
