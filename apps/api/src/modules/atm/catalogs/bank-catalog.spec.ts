// The catalog's answers (DEC-35), pure: which bank an Operations text means — a catalog key first
// (current, then former), then the branch's mapped spelling under its exact name, else none — and
// the fallbacks a missed consumer relies on (seed, then the code itself).
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { atmBankLabelKey } from '@ecms/contracts';
import { buildAtmBankCatalog, pickBankOfLabel, type AtmBankSpelling } from './bank-catalog';
import { type AtmBankDoc } from './bank.model';
import { bankLabelKeys, defaultBankColor, nextFormerOpsLabels } from './bank.service';

const NOW = new Date('2026-10-27T09:00:00.000Z');
const bank = (code: string, opsLabel: string, over: Partial<AtmBankDoc> = {}): AtmBankDoc => {
  const formerOpsLabels = over.formerOpsLabels ?? [];
  return {
    _id: new Types.ObjectId(),
    schemaVersion: 1,
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    createdBy: null,
    updatedBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    __v: 0,
    code,
    name: { ar: `${code} ar`, en: `${code} en` },
    opsLabel,
    formerOpsLabels,
    opsLabelKeys: [opsLabel, ...formerOpsLabels].map(atmBankLabelKey),
    color: '#385723',
    sortOrder: 10,
    isActive: true,
    isSeed: false,
    ...over,
  };
};

const catalog = buildAtmBankCatalog([
  bank('QNB', 'QNB ALAHLI', { sortOrder: 70, formerOpsLabels: ['QNB'] }),
  bank('NBE', 'NBE', { sortOrder: 10, isSeed: true }),
  bank('BM', 'MISR', { sortOrder: 20, isSeed: true }),
  bank('ADIB', 'ADIB', { sortOrder: 70, isActive: false }),
]);

describe('pickBankOfLabel — the resolution order', () => {
  const spellings: AtmBankSpelling[] = [
    { name: 'NBE FOREX', bankCode: 'NBE' },
    { name: 'MISR OLD', bankCode: null },
    { name: 'GHOST', bankCode: 'ZZZ' },
  ];

  it('1. a current catalog label, any case or padding', () => {
    expect(pickBankOfLabel(' misr ', catalog, spellings)?.code).toBe('BM');
  });

  it('1. a FORMER label still means its bank — machines keep the text they were given', () => {
    expect(pickBankOfLabel('qnb', catalog, spellings)?.code).toBe('QNB');
  });

  it('1. an archived bank is still found — refusing it is the caller’s call', () => {
    expect(pickBankOfLabel('ADIB', catalog, spellings)?.isActive).toBe(false);
  });

  it('2. a branch spelling under its EXACT name, mapped to a known bank', () => {
    expect(pickBankOfLabel('NBE FOREX', catalog, spellings)?.code).toBe('NBE');
    expect(pickBankOfLabel('nbe forex', catalog, spellings)).toBeNull();
  });

  it('3. an unmapped spelling, a spelling of an unknown code, or any other text: no bank', () => {
    expect(pickBankOfLabel('MISR OLD', catalog, spellings)).toBeNull();
    expect(pickBankOfLabel('GHOST', catalog, spellings)).toBeNull();
    expect(pickBankOfLabel('SOMETHING', catalog, spellings)).toBeNull();
  });

  it('the catalog answers before a spelling of the same text', () => {
    expect(pickBankOfLabel('MISR', catalog, [{ name: 'MISR', bankCode: 'NBE' }])?.code).toBe('BM');
  });
});

describe('buildAtmBankCatalog', () => {
  it('orders by sortOrder then code, and splits out the active banks and the extras', () => {
    expect(catalog.all.map((b) => b.code)).toEqual(['NBE', 'BM', 'ADIB', 'QNB']);
    expect(catalog.active.map((b) => b.code)).toEqual(['NBE', 'BM', 'QNB']);
    expect(catalog.extrasInOrder).toEqual(['ADIB', 'QNB']);
  });

  it('opsLabel: the catalog’s, else the seed’s default, else the code', () => {
    expect(catalog.opsLabel('QNB')).toBe('QNB ALAHLI');
    expect(catalog.opsLabel('HDB')).toBe('HDB');
    expect(buildAtmBankCatalog([]).opsLabel('BM')).toBe('MISR');
    expect(catalog.opsLabel('ZZZ')).toBe('ZZZ');
  });

  it('nameOf: the catalog’s, else the seed’s, else null', () => {
    expect(catalog.nameOf('QNB')).toEqual({ ar: 'QNB ar', en: 'QNB en' });
    expect(catalog.nameOf('BRK')).toEqual({ ar: 'بنك البركة', en: 'Al Baraka Bank' });
    expect(catalog.nameOf('ZZZ')).toBeNull();
  });
});

describe('the bank service’s pure rules', () => {
  it('a label change appends the old label and never repeats the new one', () => {
    expect(nextFormerOpsLabels({ opsLabel: 'MISR', formerOpsLabels: [] }, 'BANQUE MISR')).toEqual([
      'MISR',
    ]);
    // Changed back: the label is current again, so it leaves the former list.
    expect(
      nextFormerOpsLabels({ opsLabel: 'BANQUE MISR', formerOpsLabels: ['MISR'] }, 'misr'),
    ).toEqual(['BANQUE MISR']);
    // A case-only change keeps nothing twice.
    expect(nextFormerOpsLabels({ opsLabel: 'nbe', formerOpsLabels: [] }, 'NBE')).toEqual([]);
  });

  it('label keys: trimmed, upper-cased, current first, distinct', () => {
    expect(bankLabelKeys(' Banque Misr', ['MISR', 'misr '])).toEqual(['BANQUE MISR', 'MISR']);
  });

  it('a new bank wears the first extra colour nobody wears, then the least worn one', () => {
    expect(defaultBankColor(['#385723', '#AC2100'])).toBe('#7030A0');
    expect(defaultBankColor(['#7030a0'])).toBe('#00B0F0');
    const allOnce = ['#7030A0', '#00B0F0', '#00B050', '#FF66CC', '#7F6000', '#008080', '#C55A11'];
    expect(defaultBankColor([...allOnce, '#92D050', ...allOnce])).toBe('#92D050');
  });
});
