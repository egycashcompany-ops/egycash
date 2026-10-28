// The bank catalog's boot steps, pure half (DEC-35): the seed planner — the retired setting allowed
// two banks one label, the catalog's unique label index does not, so every collision must be gone
// before the first write — and how an existing Operations spelling is given its bank.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { ATM_BANK_SEED, ATM_DEFAULT_BANK_LABELS_SETTING, atmBankLabelKey } from '@ecms/contracts';
import { buildAtmBankCatalog } from './bank-catalog';
import { type AtmBankDoc } from './bank.model';
import { bankCodeOfSpelling, planBankSeed } from './catalog.migration';

const labelsOf = (plan: ReturnType<typeof planBankSeed>): Record<string, string> =>
  Object.fromEntries(plan.rows.map((row) => [row.code, row.opsLabel]));

/** Every key the plan would store, across the six — must never repeat (ux_bank_ops_label_keys). */
const allKeys = (plan: ReturnType<typeof planBankSeed>): string[] =>
  plan.rows.flatMap((row) =>
    [...new Set([row.opsLabel, ...row.formerOpsLabels].map(atmBankLabelKey))].map((key) => key),
  );

describe('planBankSeed', () => {
  it('the default setting seeds the D5 labels, nothing reverted, no former labels', () => {
    const plan = planBankSeed(ATM_DEFAULT_BANK_LABELS_SETTING);
    expect(labelsOf(plan)).toEqual({
      NBE: 'NBE',
      BM: 'MISR',
      CIB: 'CIB',
      HDB: 'HDB',
      BRK: 'BRK',
      NXT: 'NXT',
    });
    expect(plan.reverted).toEqual([]);
    expect(plan.rows.every((row) => row.formerOpsLabels.length === 0)).toBe(true);
    expect(plan.rows.map((row) => row.code)).toEqual(ATM_BANK_SEED.map((seed) => seed.code));
  });

  it('keeps a stored label (trimmed), and keeps the default as a former label', () => {
    const plan = planBankSeed([{ bankCode: 'BM', label: ' BANQUE MISR ' }]);
    expect(plan.rows.find((row) => row.code === 'BM')).toEqual({
      code: 'BM',
      opsLabel: 'BANQUE MISR',
      // Machines given the D5 default before the administrator changed the setting still say MISR.
      formerOpsLabels: ['MISR'],
    });
    expect(plan.reverted).toEqual([]);
  });

  it('a stored label equal to the default in another case is no override', () => {
    const plan = planBankSeed([{ bankCode: 'BM', label: 'misr' }]);
    expect(plan.rows.find((row) => row.code === 'BM')).toEqual({
      code: 'BM',
      opsLabel: 'MISR',
      formerOpsLabels: [],
    });
  });

  it('two overrides on one label (case ignored) both go back to their defaults', () => {
    const plan = planBankSeed([
      { bankCode: 'CIB', label: 'SHARED' },
      { bankCode: 'HDB', label: 'shared ' },
    ]);
    expect(labelsOf(plan)).toMatchObject({ CIB: 'CIB', HDB: 'HDB' });
    expect(plan.reverted.sort()).toEqual(['CIB', 'HDB']);
    expect(new Set(allKeys(plan)).size).toBe(allKeys(plan).length);
  });

  it('an override equal to another bank’s default goes back to its own default', () => {
    const plan = planBankSeed([{ bankCode: 'BM', label: 'nbe' }]);
    expect(labelsOf(plan)).toMatchObject({ NBE: 'NBE', BM: 'MISR' });
    expect(plan.reverted).toEqual(['BM']);
  });

  it('an override equal to the default another override replaced still collides — no key twice', () => {
    // BM moved away from MISR, but its machines still carry MISR: CIB may not take it.
    const plan = planBankSeed([
      { bankCode: 'BM', label: 'BANQUE MISR' },
      { bankCode: 'CIB', label: 'MISR' },
    ]);
    expect(labelsOf(plan)).toMatchObject({ BM: 'BANQUE MISR', CIB: 'CIB' });
    expect(plan.reverted).toEqual(['CIB']);
    expect(new Set(allKeys(plan)).size).toBe(allKeys(plan).length);
  });

  it('settles a chain of collisions with no key repeated', () => {
    const plan = planBankSeed([
      { bankCode: 'NBE', label: 'X' },
      { bankCode: 'BM', label: 'X' },
      { bankCode: 'CIB', label: 'NXT' },
      { bankCode: 'HDB', label: 'HOUSING' },
    ]);
    expect(labelsOf(plan)).toEqual({
      NBE: 'NBE',
      BM: 'MISR',
      CIB: 'CIB',
      HDB: 'HOUSING',
      BRK: 'BRK',
      NXT: 'NXT',
    });
    expect(new Set(allKeys(plan)).size).toBe(allKeys(plan).length);
  });
});

const NOW = new Date('2026-10-27T09:00:00.000Z');
const bank = (code: string, opsLabel: string, formerOpsLabels: string[] = []): AtmBankDoc => ({
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
  name: { ar: code, en: code },
  opsLabel,
  formerOpsLabels,
  opsLabelKeys: [opsLabel, ...formerOpsLabels].map(atmBankLabelKey),
  color: '#385723',
  sortOrder: 10,
  isActive: true,
  isSeed: false,
});

describe('bankCodeOfSpelling', () => {
  const catalog = buildAtmBankCatalog([
    bank('NBE', 'NBE'),
    bank('BM', 'BANQUE MISR', ['MISR']),
    bank('NXT', 'NXT'),
  ]);

  it('a catalog key — current or former, any case or padding — is that bank', () => {
    expect(bankCodeOfSpelling('NBE', catalog)).toBe('NBE');
    expect(bankCodeOfSpelling(' misr ', catalog)).toBe('BM');
  });

  it('NBE FOREX is NBE (DEC-16), and the import’s one alias is NXT', () => {
    expect(bankCodeOfSpelling('NBE FOREX', catalog)).toBe('NBE');
    expect(bankCodeOfSpelling('nbe forex', catalog)).toBe('NBE');
    expect(bankCodeOfSpelling('نيكست', catalog)).toBe('NXT');
  });

  it('anything else stays unmapped — never a guess', () => {
    expect(bankCodeOfSpelling('NBE2', catalog)).toBeNull();
    expect(bankCodeOfSpelling('البنك الأهلي', catalog)).toBeNull();
  });
});
