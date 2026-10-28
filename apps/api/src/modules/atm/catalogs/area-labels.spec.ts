// The pure halves of the area labels (DEC-38) and the label service: which (branch, area) pairs earn
// a label, how a text's script names it, what a rename remembers, and what a picker offers. The
// writes themselves are tests/integration/atm-area-labels.spec.ts.
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { areaLabelPairs, areaNamesByScript, isArabicText } from './area-labels';
import { buildAtmBankCatalog } from './bank-catalog';
import { type AtmBankDoc } from './bank.model';
import { branchLabelChoices, nextFormerNames } from './ref-label.service';

const ALEX = new Types.ObjectId();

const bank = (code: string, opsLabel: string, over: Partial<AtmBankDoc> = {}): AtmBankDoc =>
  ({
    _id: new Types.ObjectId(),
    code,
    name: { ar: code, en: code },
    opsLabel,
    formerOpsLabels: [],
    opsLabelKeys: [opsLabel.toUpperCase()],
    color: '#000000',
    sortOrder: 10,
    isActive: true,
    isSeed: false,
    ...over,
  }) as unknown as AtmBankDoc;

describe('areaLabelPairs', () => {
  it('trims, keeps one per exact spelling and branch, and skips blanks, `#` values and no branch', () => {
    expect(
      areaLabelPairs([
        { branchId: ALEX, area: ' MOHNDESSEN ' },
        { branchId: String(ALEX), area: 'MOHNDESSEN' },
        { branchId: ALEX, area: 'Mohndessen' },
        { branchId: ALEX, area: '   ' },
        { branchId: ALEX, area: '#N/A' },
        { branchId: ALEX, area: null },
        { branchId: null, area: 'Smouha' },
      ]),
    ).toEqual([
      { branchId: String(ALEX), area: 'MOHNDESSEN' },
      { branchId: String(ALEX), area: 'Mohndessen' },
    ]);
  });
});

describe('the display name by script', () => {
  it('an Arabic text is the Arabic name, anything else the English one', () => {
    expect(isArabicText('المهندسين')).toBe(true);
    expect(isArabicText('Smouha 2')).toBe(false);
    expect(areaNamesByScript('المهندسين')).toEqual({ nameAr: 'المهندسين', nameEn: null });
    expect(areaNamesByScript('ALEX')).toEqual({ nameAr: null, nameEn: 'ALEX' });
  });
});

describe('nextFormerNames', () => {
  it('appends the old name once and never lists the current one', () => {
    expect(nextFormerNames({ name: 'A' }, 'B')).toEqual(['A']);
    expect(nextFormerNames({ name: 'B', formerNames: ['A'] }, 'C')).toEqual(['A', 'B']);
    // Renamed back: the name in use leaves the list, the one it replaced joins it.
    expect(nextFormerNames({ name: 'B', formerNames: ['A'] }, 'A')).toEqual(['B']);
  });
});

describe('branchLabelChoices', () => {
  it('offers the ACTIVE banks, then spellings of active banks that are not catalog labels; areas sorted', () => {
    const catalog = buildAtmBankCatalog([
      bank('NBE', 'NBE', { sortOrder: 10 }),
      bank('BM', 'MISR', { sortOrder: 20 }),
      bank('QNB', 'QNB', { sortOrder: 70, isActive: false }),
    ]);
    const choices = branchLabelChoices(
      [
        { kind: 'bank', name: 'NBE FOREX', bankCode: 'NBE' },
        { kind: 'bank', name: 'NBE', bankCode: 'NBE' }, // a legacy own-label row: no override
        { kind: 'bank', name: 'QNB ATM', bankCode: 'QNB' }, // its bank is archived
        { kind: 'bank', name: 'Old text', bankCode: null }, // unmapped
        { kind: 'area', name: 'Smouha', nameEn: 'Smouha' },
        { kind: 'area', name: 'Gleem' },
      ],
      catalog,
    );
    expect(choices.banks).toEqual([
      { value: 'NBE', bankCode: 'NBE', kind: 'bank' },
      { value: 'MISR', bankCode: 'BM', kind: 'bank' },
      { value: 'NBE FOREX', bankCode: 'NBE', kind: 'spelling' },
    ]);
    expect(choices.areas).toEqual([
      { name: 'Gleem', nameAr: null, nameEn: null },
      { name: 'Smouha', nameAr: null, nameEn: 'Smouha' },
    ]);
  });
});
