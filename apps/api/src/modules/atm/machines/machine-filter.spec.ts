// The machine list's filters, as the API reads them and as Mongo is asked — no database here; the
// whole set over real HTTP and a real mongod is tests/integration/atm-machines-filter.spec.ts.
//
// Every bank, area and code below is synthetic.
import { describe, expect, it } from 'vitest';
import {
  ATM_MACHINE_CODES_MAX,
  AtmMachinesSummaryQuerySchema,
  ListAtmMachinesQuerySchema,
  joinAtmNameList,
  splitAtmMachineCodeList,
} from '@ecms/contracts';
import { allOf, literalPattern, machineFilterClauses } from './machine-filter';

describe('the machine-code list', () => {
  it('splits on spaces, commas (Latin and Arabic), semicolons and new lines, and normalizes', () => {
    expect(splitAtmMachineCodeList('0123 456,789،  0012;\n 99')).toEqual([
      '123',
      '456',
      '789',
      '12',
      '99',
    ]);
  });

  it('keeps each code once, in the order first written, and drops what names no machine', () => {
    expect(splitAtmMachineCodeList('77 077 0077 , 000 ,')).toEqual(['77']);
    expect(splitAtmMachineCodeList(['11,22', '22 33'])).toEqual(['11', '22', '33']);
  });
});

describe('the list and summary queries', () => {
  it('read every column filter, a bank name holding a comma arriving whole', () => {
    const parsed = ListAtmMachinesQuerySchema.parse({
      banks: joinAtmNameList(['SYN Bank, Ltd', 'SYN NBE']),
      areas: joinAtmNameList(['SYN Raml, Station']),
      codes: '0101 0102',
      code: ' 10 ',
      name: ' Mall ',
      isActive: 'true',
      sortBy: 'bankName',
      sortDir: 'asc',
    });
    expect(parsed.banks).toEqual(['SYN Bank, Ltd', 'SYN NBE']);
    expect(parsed.areas).toEqual(['SYN Raml, Station']);
    expect(parsed.codes).toEqual(['101', '102']);
    expect(parsed.code).toBe('10');
    expect(parsed.name).toBe('Mall');
    expect(parsed.isActive).toBe(true);
  });

  it('read an empty list as no filter, and refuse what is not a filter of the list', () => {
    const parsed = AtmMachinesSummaryQuerySchema.parse({ banks: '', codes: ' , ' });
    expect(parsed.banks).toBeUndefined();
    expect(parsed.codes).toBeUndefined();
    expect(() => AtmMachinesSummaryQuerySchema.parse({ page: '2' })).toThrow();
    expect(() => ListAtmMachinesQuerySchema.parse({ branchId: 'x' })).toThrow();
  });

  it('bound the codes one filter may name', () => {
    const many = (n: number): string =>
      Array.from({ length: n }, (_unused, i) => String(i + 1)).join(',');
    expect(ListAtmMachinesQuerySchema.parse({ codes: many(ATM_MACHINE_CODES_MAX) }).codes).toHaveLength(
      ATM_MACHINE_CODES_MAX,
    );
    expect(() => ListAtmMachinesQuerySchema.parse({ codes: many(ATM_MACHINE_CODES_MAX + 1) })).toThrow();
  });
});

describe('the clauses', () => {
  const query = AtmMachinesSummaryQuerySchema.parse({
    isActive: 'true',
    banks: 'SYN NBE',
    areas: 'SYN Smouha',
    codes: '0101',
    code: '1.0',
    name: 'Mall (East)',
  });
  const spellings = { bankName: ['SYN NBE', 'SYN NBE '], area: ['SYN Smouha'] };

  it('ANDs one clause per narrowed column, the stored spellings standing for each name', () => {
    expect(allOf(machineFilterClauses(query, spellings))).toEqual({
      $and: [
        { isActive: true },
        { bankName: { $in: ['SYN NBE', 'SYN NBE '] } },
        { machineCode: { $in: ['101'] } },
        { machineCode: { $regex: '1\\.0', $options: 'i' } },
        { name: { $regex: 'Mall \\(East\\)', $options: 'i' } },
        { area: { $in: ['SYN Smouha'] } },
      ],
    });
  });

  it('leaves one dropdown’s own choice out when it asks what to offer', () => {
    const banksLeft = machineFilterClauses(query, spellings, 'banks');
    expect(banksLeft).not.toContainEqual({ bankName: { $in: ['SYN NBE', 'SYN NBE '] } });
    expect(banksLeft).toContainEqual({ area: { $in: ['SYN Smouha'] } });
    const areasLeft = machineFilterClauses(query, spellings, 'areas');
    expect(areasLeft).not.toContainEqual({ area: { $in: ['SYN Smouha'] } });
    expect(areasLeft).toContainEqual({ bankName: { $in: ['SYN NBE', 'SYN NBE '] } });
  });

  it('a name nothing in scope carries narrows to nothing rather than being dropped', () => {
    const none = machineFilterClauses(
      AtmMachinesSummaryQuerySchema.parse({ banks: 'SYN NOWHERE' }),
      { bankName: [] },
    );
    expect(none).toEqual([{ bankName: { $in: [] } }]);
  });

  it('asks nothing of an unnarrowed list, and takes typed text literally', () => {
    expect(allOf(machineFilterClauses(AtmMachinesSummaryQuerySchema.parse({}), {}))).toEqual({});
    expect(literalPattern('a.b*c?(d)[e]{f}|g^h$i\\j+')).toBe(
      'a\\.b\\*c\\?\\(d\\)\\[e\\]\\{f\\}\\|g\\^h\\$i\\\\j\\+',
    );
    expect(new RegExp(literalPattern('ATM (1)')).test('Mall ATM (1)')).toBe(true);
  });
});
