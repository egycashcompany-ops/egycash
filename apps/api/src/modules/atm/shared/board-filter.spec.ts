// The open boards' bank/area filter, pinned at its two edges: the wire (a name list that survives a
// comma inside a name, and still reads every link written before the escape existed) and the
// match (a name stands for every stored spelling that differs only by surrounding spaces).
//
// Every name below is synthetic.
import { describe, expect, it } from 'vitest';
import {
  AtmOperationFacetsQuerySchema,
  ListAtmOpenOperationsQuerySchema,
  joinAtmNameList,
  splitAtmNameList,
} from '@ecms/contracts';
import { boardName, boardNames, storedSpellingsOf } from './board-filter';

describe('the bank/area name list on the wire', () => {
  it('round-trips names holding commas and backslashes', () => {
    const names = ['SYN Bank, Ltd', 'SYN Raml, Station', 'SYN a\\b', 'SYN ,lead', 'سموحة، الجديدة'];
    expect(splitAtmNameList(joinAtmNameList(names))).toEqual(names);
  });

  it('writes a list without commas or backslashes exactly as before — old links stay valid', () => {
    expect(joinAtmNameList(['SYN NBE', 'SYN CIB'])).toBe('SYN NBE,SYN CIB');
    expect(splitAtmNameList('SYN NBE,SYN CIB')).toEqual(['SYN NBE', 'SYN CIB']);
  });

  it('trims each name and drops empty ones, as `listQuery` does', () => {
    expect(splitAtmNameList(' SYN NBE , ,SYN CIB,')).toEqual(['SYN NBE', 'SYN CIB']);
    expect(splitAtmNameList('')).toEqual([]);
  });

  it('keeps a lone trailing backslash as written', () => {
    expect(splitAtmNameList('SYN A\\')).toEqual(['SYN A\\']);
  });

  it('the list query and the facets query read the escape, and a repeated parameter too', () => {
    const one = ListAtmOpenOperationsQuerySchema.parse({
      banks: joinAtmNameList(['SYN Bank, Ltd']),
      areas: joinAtmNameList(['SYN Raml, Station', 'سموحة']),
    });
    expect(one.banks).toEqual(['SYN Bank, Ltd']);
    expect(one.areas).toEqual(['SYN Raml, Station', 'سموحة']);
    expect(
      AtmOperationFacetsQuerySchema.parse({ banks: ['SYN NBE', joinAtmNameList(['SYN A, B'])] })
        .banks,
    ).toEqual(['SYN NBE', 'SYN A, B']);
    // Absent or empty is "not narrowed", exactly as before.
    expect(ListAtmOpenOperationsQuerySchema.parse({ banks: '' }).banks).toBeUndefined();
    expect(ListAtmOpenOperationsQuerySchema.parse({}).areas).toBeUndefined();
  });

  it('keeps the platform cap of fifty names', () => {
    const many = (n: number): string =>
      joinAtmNameList(Array.from({ length: n }, (_unused, i) => `SYN ${String(i)}`));
    expect(ListAtmOpenOperationsQuerySchema.parse({ areas: many(50) }).areas).toHaveLength(50);
    expect(() => ListAtmOpenOperationsQuerySchema.parse({ areas: many(51) })).toThrow();
  });
});

describe('a name stands for its spellings', () => {
  it('is the stored text without its surrounding spaces', () => {
    expect(boardName('  SYN NBE ')).toBe('SYN NBE');
  });

  it('offers each name once, blank ones dropped, sorted as the boards always were', () => {
    expect(boardNames(['SYN QNB ', 'SYN CIB', 'SYN QNB', ' ', 'SYN Bank, Ltd'])).toEqual([
      'SYN Bank, Ltd',
      'SYN CIB',
      'SYN QNB',
    ]);
  });

  it('resolves requested names to every stored spelling, and to nothing for an unknown one', () => {
    const stored = ['SYN QNB ', 'SYN QNB', 'SYN CIB', ' SYN NBE'];
    expect(storedSpellingsOf(stored, ['SYN QNB'])).toEqual(['SYN QNB ', 'SYN QNB']);
    expect(storedSpellingsOf(stored, ['SYN NBE', 'SYN CIB'])).toEqual(['SYN CIB', ' SYN NBE']);
    expect(storedSpellingsOf(stored, ['SYN GONE'])).toEqual([]);
  });
});
