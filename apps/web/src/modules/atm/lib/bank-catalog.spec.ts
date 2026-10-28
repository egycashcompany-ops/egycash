// The bank lookup every bank-naming screen reads (DEC-35): its fallbacks — catalog, then seed, then
// the code, and grey for a colour it cannot find — the ring decided by contrast, and the pickers'
// helpers (area display names, grouped bank options, what a map legend shows). The catalog banks
// and labels below are synthetic.
import { describe, expect, it } from 'vitest';
import { ATM_BANK_SEED, ATM_SEED_BANK_CODES, type AtmRefLabelOptionsDto } from '@ecms/contracts';
import { NO_ZONE_GREY } from './map-colors';
import {
  areaOptionText,
  bankOptionGroups,
  banksOnShow,
  inCatalogOrder,
  labelText,
  makeBankLookup,
  sortByCatalogOrder,
  type LookupBank,
} from './bank-catalog';

const SEEDS: LookupBank[] = ATM_BANK_SEED.map((seed) => ({ ...seed, isActive: true }));
const QNB: LookupBank = {
  code: 'QNB',
  name: { ar: 'بنك تجريبي', en: 'SYN Bank' },
  color: '#7030A0',
  sortOrder: 70,
  isActive: true,
};
const OLD: LookupBank = {
  code: 'OLD',
  name: { ar: 'بنك مؤرشف تجريبي', en: 'SYN Old Bank' },
  color: '#00B0F0',
  sortOrder: 15,
  isActive: false,
};

describe('makeBankLookup', () => {
  it('before the catalog answers it is the six seeds, in the sheet’s section-3 order', () => {
    const lookup = makeBankLookup();
    expect(lookup.codes).toEqual([...ATM_SEED_BANK_CODES]);
    expect(lookup.name('NBE', 'ar')).toBe('البنك الأهلي المصري');
    expect(lookup.name('BM', 'en')).toBe('Banque Misr');
    expect(lookup.color('CIB')).toBe('#FFD966');
  });

  it('names a bank from the catalog, then the seed, then the code itself', () => {
    const curated = SEEDS.map((b) =>
      b.code === 'NXT' ? { ...b, name: { ar: 'بنك نكست', en: 'NXT Bank' } } : b,
    );
    const lookup = makeBankLookup([...curated, QNB]);
    expect(lookup.name('NXT', 'ar')).toBe('بنك نكست');
    expect(lookup.name('QNB', 'en')).toBe('SYN Bank');
    // A seed the catalog answer leaves out still gets its seed name; an unknown code reads as itself.
    expect(makeBankLookup([QNB]).name('HDB', 'ar')).toBe('بنك التعمير والاسكان');
    expect(lookup.name('ZZZ', 'ar')).toBe('ZZZ');
  });

  it('colours a bank from the catalog, then the seed, then grey', () => {
    const lookup = makeBankLookup([QNB]);
    expect(lookup.color('QNB')).toBe('#7030A0');
    expect(lookup.color('BRK')).toBe('#F4B183');
    expect(lookup.color('ZZZ')).toBe(NO_ZONE_GREY);
    expect(lookup.color(null)).toBe(NO_ZONE_GREY);
  });

  it('isPale is CIB, HDB and BRK exactly for the seeds — decided by contrast, not a list', () => {
    const lookup = makeBankLookup(SEEDS);
    expect(lookup.codes.filter((code) => lookup.isPale(code))).toEqual(['CIB', 'HDB', 'BRK']);
    expect(lookup.isPale(null)).toBe(false);
    expect(makeBankLookup([{ ...QNB, color: '#92D050' }]).isPale('QNB')).toBe(true);
  });

  it('orders by sortOrder then code, and offers only the active banks', () => {
    const lookup = makeBankLookup([QNB, ...SEEDS, OLD]);
    expect(lookup.codes).toEqual(['NBE', 'OLD', 'BM', 'CIB', 'HDB', 'BRK', 'NXT', 'QNB']);
    expect(lookup.active.map((b) => b.code)).not.toContain('OLD');
    expect(sortByCatalogOrder([QNB, { ...QNB, code: 'ABC' }]).map((b) => b.code)).toEqual([
      'ABC',
      'QNB',
    ]);
  });
});

describe('an OLDER server’s bank rows (rollback, or a tab on this bundle mid-deploy)', () => {
  // The meta before the catalog: `{ code, name, opsLabel, color }` — no `isActive`, no `sortOrder`.
  const older = [...ATM_BANK_SEED]
    .reverse()
    .map(({ code, name, color, opsLabel }) => ({ code, name, color, opsLabel }));

  it('reads a row without the flags as ACTIVE, in its seed’s place — never «مؤرشف», never none', () => {
    const lookup = makeBankLookup(older);
    expect(lookup.active.map((b) => b.code)).toEqual([...ATM_SEED_BANK_CODES]);
    expect(lookup.ordered.every((b) => b.isActive)).toBe(true);
    expect(lookup.codes).toEqual([...ATM_SEED_BANK_CODES]);
  });

  it('keeps a flag the server did send', () => {
    const lookup = makeBankLookup([...older, { ...QNB, isActive: false }]);
    expect(lookup.active.map((b) => b.code)).not.toContain('QNB');
    expect(lookup.codes.at(-1)).toBe('QNB');
  });
});

describe('what a map legend and filter show', () => {
  const lookup = makeBankLookup([...SEEDS, QNB, OLD]);

  it('every active bank, plus an archived or unknown code the dots still carry', () => {
    expect(banksOnShow(lookup, [])).toEqual(['NBE', 'BM', 'CIB', 'HDB', 'BRK', 'NXT', 'QNB']);
    expect(banksOnShow(lookup, ['OLD', 'ZZZ', null, 'NBE'])).toEqual([
      'NBE',
      'OLD',
      'BM',
      'CIB',
      'HDB',
      'BRK',
      'NXT',
      'QNB',
      'ZZZ',
    ]);
  });

  it('inCatalogOrder keeps the catalog order and appends the rest sorted', () => {
    expect(inCatalogOrder(lookup, ['ZZZ', 'QNB', 'AAA', 'NBE'])).toEqual([
      'NBE',
      'QNB',
      'AAA',
      'ZZZ',
    ]);
  });
});

describe('area display names (DEC-38)', () => {
  const both = { name: 'MOHNDESSEN', nameAr: 'المهندسين', nameEn: 'Mohandessin' };
  const legacy = { name: 'ALEX', nameAr: null, nameEn: null };
  const arOnly = { name: 'سموحة', nameAr: 'سموحة', nameEn: null };

  it('the reader’s language, else the other one, else the stored name', () => {
    expect(labelText(both, 'ar')).toBe('المهندسين');
    expect(labelText(both, 'en')).toBe('Mohandessin');
    expect(labelText(arOnly, 'en')).toBe('سموحة');
    expect(labelText(legacy, 'ar')).toBe('ALEX');
  });

  it('a picker shows the stored name after it when the two differ', () => {
    expect(areaOptionText(both, 'ar')).toBe('المهندسين (MOHNDESSEN)');
    expect(areaOptionText(legacy, 'ar')).toBe('ALEX');
    expect(areaOptionText(arOnly, 'ar')).toBe('سموحة');
  });
});

describe('bankOptionGroups', () => {
  const lookup = makeBankLookup([...SEEDS, QNB]);
  const banks: AtmRefLabelOptionsDto['banks'] = [
    { value: 'QNB', bankCode: 'QNB', kind: 'bank' },
    { value: 'NBE FOREX', bankCode: 'NBE', kind: 'spelling' },
    { value: 'MISR', bankCode: 'BM', kind: 'bank' },
    { value: 'NBE', bankCode: 'NBE', kind: 'bank' },
    { value: 'NBE ALEX', bankCode: 'NBE', kind: 'spelling' },
    { value: 'NBE', bankCode: 'NBE', kind: 'spelling' },
  ];

  it('groups by bank in the catalog order: the bank’s own label, then its spellings, once each', () => {
    expect(bankOptionGroups(banks, lookup, 'ar')).toEqual([
      { code: 'NBE', label: 'البنك الأهلي المصري', values: ['NBE', 'NBE ALEX', 'NBE FOREX'] },
      { code: 'BM', label: 'بنك مصر', values: ['MISR'] },
      { code: 'QNB', label: 'بنك تجريبي', values: ['QNB'] },
    ]);
  });
});
