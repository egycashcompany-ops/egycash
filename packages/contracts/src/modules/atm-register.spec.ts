// The register's contract, pinned: the status rule (D1), the ONE active definition (D7), the input
// schemas' refusals, the per-bank ID shapes (D6, warnings only), the bank catalog's shape and
// fallbacks (DEC-35), and above all the Data Report fold — the single function both the report page
// and the import's 57-number check run, so a drift here would make the page and the cut-over check
// disagree about the same cell. A catalog bank is appended after the sheet's six (DEC-40); the six
// keep the workbook's 57 cells byte for byte.
//
// Every value below is synthetic. No figure, code or combination from the owner's workbook is used
// except the published Data Report COUNTS (spec §6.5), which are totals, not records.
import { describe, expect, it } from 'vitest';
import { ATM_BANK_CODE_PATTERN } from './atm.js';
import {
  ATM_BANK_COLOR_PATTERN,
  ATM_BANK_EXTRA_COLORS,
  ATM_BANK_SEED,
  ATM_DATA_REPORT_CELLS,
  ATM_DEFAULT_BANK_LABELS_SETTING,
  ATM_REGISTER_BANK_ALIASES,
  ATM_REGISTER_BRANCH_CODES,
  ATM_REGISTER_COLUMNS,
  ATM_REGISTER_DISPLAY_ORDER,
  ATM_REGISTER_ID_FORMATS,
  ATM_REPORT_SECTION1_BANKS,
  ATM_REPORT_SECTION3_BANKS,
  ATM_REPORT_SECTION3_BRANCHES,
  ATM_REPORT_TOTALS_COLOR,
  ATM_SEED_BANK_CODES,
  AtmBankCodeSchema,
  AtmRegisterBankLabelsSettingSchema,
  AtmRegisterBranchCodesSettingSchema,
  AtmRegisterDateSchema,
  CreateAtmBankSchema,
  ExportAtmRegisterEntriesQuerySchema,
  HandoverAtmRegisterEntrySchema,
  ListAtmRegisterEntriesQuerySchema,
  ReceiveAtmRegisterEntrySchema,
  UpdateAtmBankSchema,
  UpdateAtmRegisterEntrySchema,
  atmBankColor,
  atmBankLabelKey,
  atmBankName,
  atmBankSeedOf,
  atmRegisterIdFormatOk,
  atmReportBankOrders,
  buildAtmReportCells,
  deriveAtmRegisterStatus,
  foldAtmRegisterReport,
  isAtmRegisterActive,
  isAtmSeedBankCode,
  readAtmReportCell,
  type AtmBankCode,
  type AtmRegisterBranchCode,
  type AtmRegisterReportGroup,
  type AtmSeedBankCode,
} from './atm-register.js';

const BRANCH_ID = '650000000000000000000101';
const OTHER_BRANCH_ID = '650000000000000000000102';

// ── Status and the active definition ────────────────────────────────────────────────────────────

describe('deriveAtmRegisterStatus — the only producer of a status (D1)', () => {
  it('covers the four combinations', () => {
    expect(deriveAtmRegisterStatus(null, null)).toBe('pending');
    expect(deriveAtmRegisterStatus('2026-01-01', null)).toBe('open');
    expect(deriveAtmRegisterStatus('2026-01-01', '2026-02-01')).toBe('ended');
    // An end date without a start date is still a handed-back period — the Excel's AR decides.
    expect(deriveAtmRegisterStatus(null, '2026-02-01')).toBe('ended');
  });

  it('accepts Date values as the model stores them', () => {
    expect(deriveAtmRegisterStatus(new Date('2026-01-01T00:00:00Z'), null)).toBe('open');
  });
});

describe('isAtmRegisterActive — Excel helper CI (D7)', () => {
  it('needs a branch, a start date and no end date', () => {
    expect(isAtmRegisterActive({ hasBranch: true, startDate: '2026-01-01', endDate: null })).toBe(
      true,
    );
    expect(isAtmRegisterActive({ hasBranch: false, startDate: '2026-01-01', endDate: null })).toBe(
      false,
    );
    expect(isAtmRegisterActive({ hasBranch: true, startDate: null, endDate: null })).toBe(false);
    expect(
      isAtmRegisterActive({ hasBranch: true, startDate: '2026-01-01', endDate: '2026-02-01' }),
    ).toBe(false);
  });
});

describe('AtmRegisterDateSchema', () => {
  it('accepts a calendar date and refuses the rest', () => {
    expect(AtmRegisterDateSchema.safeParse('2026-01-12').success).toBe(true);
    expect(AtmRegisterDateSchema.safeParse('2024-02-29').success).toBe(true);
    expect(AtmRegisterDateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(AtmRegisterDateSchema.safeParse('2026-13-01').success).toBe(false);
    expect(AtmRegisterDateSchema.safeParse('12/01/2026').success).toBe(false);
    expect(AtmRegisterDateSchema.safeParse('2026-01-12T00:00:00Z').success).toBe(false);
  });
});

// ── Input schemas ───────────────────────────────────────────────────────────────────────────────

const receipt = {
  branchId: BRANCH_ID,
  machineCode: '99990001',
  bankCode: 'NBE',
  area: 'Test Area',
  name: 'Test Machine',
  startDate: '2026-01-12',
} as const;

describe('ReceiveAtmRegisterEntrySchema', () => {
  it('accepts a full receipt', () => {
    expect(ReceiveAtmRegisterEntrySchema.safeParse(receipt).success).toBe(true);
  });

  it.each(['status', 'endDate', 'machineId'])('is strict: refuses `%s`', (field) => {
    const value = field === 'status' ? 'open' : field === 'endDate' ? '2026-02-01' : BRANCH_ID;
    const parsed = ReceiveAtmRegisterEntrySchema.safeParse({ ...receipt, [field]: value });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('requires bank, code and area once the start date is set — each on its own path', () => {
    const parsed = ReceiveAtmRegisterEntrySchema.safeParse({
      branchId: BRANCH_ID,
      name: 'Test Machine',
      startDate: '2026-01-12',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((i) => i.path.join('.')).sort()).toEqual([
        'area',
        'bankCode',
        'machineCode',
      ]);
    }
  });

  it('treats a code that normalizes to nothing as missing', () => {
    const parsed = ReceiveAtmRegisterEntrySchema.safeParse({ ...receipt, machineCode: ' 000 ' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(['machineCode']);
  });

  it('accepts a pending entry without bank, code, area or start date', () => {
    const pending = { branchId: BRANCH_ID, name: 'Test Machine' };
    expect(ReceiveAtmRegisterEntrySchema.safeParse(pending).success).toBe(true);
    expect(ReceiveAtmRegisterEntrySchema.safeParse({ ...pending, startDate: null }).success).toBe(
      true,
    );
  });

  it('turns blank text into null and trims the rest', () => {
    const parsed = ReceiveAtmRegisterEntrySchema.parse({
      ...receipt,
      vendor: '   ',
      serial: ' SN-1\t',
      keys: { supervisorCode: '' },
      safeCombination: '',
    });
    expect(parsed.vendor).toBeNull();
    expect(parsed.serial).toBe('SN-1');
    expect(parsed.keys?.supervisorCode).toBeNull();
    expect(parsed.safeCombination).toBeNull();
  });

  it('requires a non-empty name on a manual write', () => {
    expect(ReceiveAtmRegisterEntrySchema.safeParse({ ...receipt, name: '  ' }).success).toBe(false);
  });

  it('never echoes a refused K or S value in its messages', () => {
    const marker = 'FAKE-KEY-MARKER-';
    const parsed = ReceiveAtmRegisterEntrySchema.safeParse({
      ...receipt,
      keys: { supervisorCode: marker.repeat(40) },
      safeCombination: marker.repeat(20),
      receiptNotes: 7,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(JSON.stringify(parsed.error.issues)).not.toContain(marker);
  });
});

describe('UpdateAtmRegisterEntrySchema', () => {
  it('is strict and needs a version', () => {
    expect(UpdateAtmRegisterEntrySchema.safeParse({ version: 0 }).success).toBe(true);
    expect(UpdateAtmRegisterEntrySchema.safeParse({}).success).toBe(false);
    expect(UpdateAtmRegisterEntrySchema.safeParse({ version: 0, status: 'open' }).success).toBe(
      false,
    );
    expect(
      UpdateAtmRegisterEntrySchema.safeParse({ version: 0, branchId: BRANCH_ID }).success,
    ).toBe(false);
  });

  it('lets the combination be cleared with null, kept when absent, never set to blank', () => {
    expect(UpdateAtmRegisterEntrySchema.parse({ version: 1, safeCombination: null })).toEqual({
      version: 1,
      safeCombination: null,
    });
    expect(UpdateAtmRegisterEntrySchema.parse({ version: 1 })).not.toHaveProperty(
      'safeCombination',
    );
    expect(
      UpdateAtmRegisterEntrySchema.safeParse({ version: 1, safeCombination: ' ' }).success,
    ).toBe(false);
  });

  it('never clears a name', () => {
    expect(UpdateAtmRegisterEntrySchema.safeParse({ version: 1, name: '' }).success).toBe(false);
  });

  it('sets or clears «بيانات ناقصة» (DEC-37), a boolean only', () => {
    expect(UpdateAtmRegisterEntrySchema.parse({ version: 1, dataIncomplete: false })).toEqual({
      version: 1,
      dataIncomplete: false,
    });
    expect(UpdateAtmRegisterEntrySchema.parse({ version: 1 })).not.toHaveProperty('dataIncomplete');
    expect(
      UpdateAtmRegisterEntrySchema.safeParse({ version: 1, dataIncomplete: 'true' }).success,
    ).toBe(false);
  });
});

describe('HandoverAtmRegisterEntrySchema', () => {
  it('keeps an absent field absent, and reads a sent blank as a clear', () => {
    expect(HandoverAtmRegisterEntrySchema.parse({ endDate: '2026-03-01', version: 2 })).toEqual({
      endDate: '2026-03-01',
      version: 2,
    });
    expect(
      HandoverAtmRegisterEntrySchema.parse({ endDate: '2026-03-01', handoverName: '', version: 2 }),
    ).toEqual({ endDate: '2026-03-01', handoverName: null, version: 2 });
  });
});

describe('the list and export queries', () => {
  it('parse multi-value filters and refuse a malformed bank code', () => {
    const parsed = ListAtmRegisterEntriesQuerySchema.parse({ banks: 'NBE,BM', statuses: 'open' });
    expect(parsed.banks).toEqual(['NBE', 'BM']);
    expect(parsed.statuses).toEqual(['open']);
    // A catalog bank is data (DEC-35): a well-shaped code parses, and whether it EXISTS is the
    // server's question. Only the shape is refused here.
    expect(ListAtmRegisterEntriesQuerySchema.parse({ banks: 'QNB' }).banks).toEqual(['QNB']);
    expect(ListAtmRegisterEntriesQuerySchema.safeParse({ banks: 'qnb' }).success).toBe(false);
    expect(ListAtmRegisterEntriesQuerySchema.safeParse({ banks: 'NBE,x' }).success).toBe(false);
  });

  it('export takes the filters without a page', () => {
    expect(ExportAtmRegisterEntriesQuerySchema.safeParse({ withIssues: 'true' }).success).toBe(
      true,
    );
    expect(ExportAtmRegisterEntriesQuerySchema.safeParse({ page: '2' }).success).toBe(false);
  });

  it('read `incomplete` as a real boolean, on the list and the export alike (DEC-37)', () => {
    expect(ListAtmRegisterEntriesQuerySchema.parse({ incomplete: 'true' }).incomplete).toBe(true);
    // 'false' must mean false — the reason the platform's booleanQuery exists.
    expect(ListAtmRegisterEntriesQuerySchema.parse({ incomplete: 'false' }).incomplete).toBe(false);
    expect(ExportAtmRegisterEntriesQuerySchema.parse({ incomplete: 'true' }).incomplete).toBe(true);
    expect(ListAtmRegisterEntriesQuerySchema.safeParse({ incomplete: '1' }).success).toBe(false);
  });
});

// ── Per-bank ID shapes (D6) ─────────────────────────────────────────────────────────────────────

describe('atmRegisterIdFormatOk — a warning, never a block', () => {
  it.each<[AtmBankCode, string, boolean]>([
    ['NBE', '20370003', true],
    ['NBE', '2037003', false],
    ['BM', '1234567', true],
    ['CIB', '4802', true],
    ['HDB', 'HDB - 4802', true],
    ['HDB', 'HDB-ATM 4802', true],
    ['HDB', 'HDB-ATM4802', true],
    ['HDB', '4802', false],
    ['BRK', 'BRKN0101', true],
    ['BRK', 'BRKW12', true],
    ['BRK', 'BRK0101', false],
    ['NXT', 'ATM0001', true],
    ['NXT', 'ATM001', false],
  ])('%s %s → %s', (bank, code, ok) => {
    expect(atmRegisterIdFormatOk(bank, code)).toBe(ok);
  });

  it('never warns for a bank without a shape — a catalog bank, or a crafted key', () => {
    expect(atmRegisterIdFormatOk('QNB', 'x')).toBe(true);
    // A Map, not a record: a prototype name is just an unknown bank.
    expect(atmRegisterIdFormatOk('constructor', 'x')).toBe(true);
    expect(atmRegisterIdFormatOk('__proto__', 'x')).toBe(true);
    expect([...ATM_REGISTER_ID_FORMATS.keys()]).toEqual([...ATM_SEED_BANK_CODES]);
  });
});

// ── Bank codes and the catalog (DEC-35) ─────────────────────────────────────────────────────────

describe('the bank code shape', () => {
  it.each(['NBE', 'BM', 'CIB', 'HDB', 'BRK', 'NXT', 'QNB', 'AAIB1', 'A1', 'ABCDEFGHIJ'])(
    'accepts %s',
    (code) => {
      expect(ATM_BANK_CODE_PATTERN.test(code)).toBe(true);
      expect(AtmBankCodeSchema.safeParse(code).success).toBe(true);
    },
  );

  // `none` and `total` are the map's and the fold's sentinels: lower-case, so never a code.
  it.each(['qnb', 'Q', '1QNB', 'ABCDEFGHIJK', 'QN B', 'QNB-1', '', 'none', 'total', 'نيكست'])(
    'refuses %j',
    (code) => {
      expect(ATM_BANK_CODE_PATTERN.test(code)).toBe(false);
      expect(AtmBankCodeSchema.safeParse(code).success).toBe(false);
    },
  );

  it('knows the six seeds by name', () => {
    expect(ATM_SEED_BANK_CODES).toEqual(['NBE', 'BM', 'CIB', 'HDB', 'BRK', 'NXT']);
    expect(isAtmSeedBankCode('BRK')).toBe(true);
    expect(isAtmSeedBankCode('QNB')).toBe(false);
    expect(isAtmSeedBankCode('brk')).toBe(false);
    expect(ATM_REGISTER_BANK_ALIASES['نيكست']).toBe('NXT');
  });
});

describe('ATM_BANK_SEED — the six, exactly as the deleted per-bank records held them', () => {
  it('keeps every name, colour, Operations label and the section-3 sort order', () => {
    expect(ATM_BANK_SEED).toEqual([
      {
        code: 'NBE',
        name: { ar: 'البنك الأهلي المصري', en: 'National Bank of Egypt' },
        color: '#385723',
        opsLabel: 'NBE',
        sortOrder: 10,
      },
      {
        code: 'BM',
        name: { ar: 'بنك مصر', en: 'Banque Misr' },
        color: '#AC2100',
        opsLabel: 'MISR',
        sortOrder: 20,
      },
      {
        code: 'CIB',
        name: { ar: 'البنك التجارى الدولى', en: 'Commercial International Bank' },
        color: '#FFD966',
        opsLabel: 'CIB',
        sortOrder: 30,
      },
      {
        code: 'HDB',
        name: { ar: 'بنك التعمير والاسكان', en: 'Housing and Development Bank' },
        color: '#B4C7E7',
        opsLabel: 'HDB',
        sortOrder: 40,
      },
      {
        code: 'BRK',
        name: { ar: 'بنك البركة', en: 'Al Baraka Bank' },
        color: '#F4B183',
        opsLabel: 'BRK',
        sortOrder: 50,
      },
      {
        code: 'NXT',
        name: { ar: 'NXT BANK', en: 'NXT BANK' },
        color: '#000099',
        opsLabel: 'NXT',
        sortOrder: 60,
      },
    ]);
    expect(ATM_BANK_SEED.map((seed) => seed.code)).toEqual([...ATM_SEED_BANK_CODES]);
    expect(atmBankSeedOf('BM')?.opsLabel).toBe('MISR');
    expect(atmBankSeedOf('QNB')).toBeUndefined();
  });

  it('seeds six distinct Operations label keys — the catalog index can never refuse its own seed', () => {
    const keys = ATM_BANK_SEED.map((seed) => atmBankLabelKey(seed.opsLabel));
    expect(new Set(keys).size).toBe(6);
  });
});

describe('ATM_BANK_EXTRA_COLORS', () => {
  it('offers at least 8 catalog-shaped colours, none a seed’s or the totals colour', () => {
    expect(ATM_BANK_EXTRA_COLORS.length).toBeGreaterThanOrEqual(8);
    for (const color of ATM_BANK_EXTRA_COLORS) expect(color).toMatch(ATM_BANK_COLOR_PATTERN);
    expect(new Set(ATM_BANK_EXTRA_COLORS).size).toBe(ATM_BANK_EXTRA_COLORS.length);
    const taken = new Set([...ATM_BANK_SEED.map((seed) => seed.color), ATM_REPORT_TOTALS_COLOR]);
    for (const color of ATM_BANK_EXTRA_COLORS) expect(taken.has(color), color).toBe(false);
  });
});

describe('CreateAtmBankSchema', () => {
  const bank = { code: 'QNB', name: { ar: 'بنك قطر الوطني', en: 'QNB' } };

  it('trims and upper-cases the code, then checks its shape', () => {
    expect(CreateAtmBankSchema.parse({ ...bank, code: ' qnb ' }).code).toBe('QNB');
    expect(CreateAtmBankSchema.safeParse({ ...bank, code: 'q' }).success).toBe(false);
    expect(CreateAtmBankSchema.safeParse({ ...bank, code: 'QNB BANK' }).success).toBe(false);
  });

  it('defaults the Operations label to the code, and trims a given one', () => {
    expect(CreateAtmBankSchema.parse(bank).opsLabel).toBe('QNB');
    expect(CreateAtmBankSchema.parse({ ...bank, opsLabel: '  QNB ALAHLI ' }).opsLabel).toBe(
      'QNB ALAHLI',
    );
    expect(CreateAtmBankSchema.safeParse({ ...bank, opsLabel: '   ' }).success).toBe(false);
    expect(CreateAtmBankSchema.safeParse({ ...bank, opsLabel: 'X'.repeat(65) }).success).toBe(
      false,
    );
  });

  it('needs both names, trimmed, 1–80 each', () => {
    expect(CreateAtmBankSchema.parse({ ...bank, name: { ar: ' أ ', en: ' Q ' } }).name).toEqual({
      ar: 'أ',
      en: 'Q',
    });
    expect(CreateAtmBankSchema.safeParse({ ...bank, name: { ar: 'بنك' } }).success).toBe(false);
    expect(CreateAtmBankSchema.safeParse({ ...bank, name: { ar: 'بنك', en: ' ' } }).success).toBe(
      false,
    );
    expect(
      CreateAtmBankSchema.safeParse({ ...bank, name: { ar: 'بنك', en: 'Q'.repeat(81) } }).success,
    ).toBe(false);
  });

  it('upper-cases a hex colour and refuses anything else', () => {
    expect(CreateAtmBankSchema.parse({ ...bank, color: '#7030a0' }).color).toBe('#7030A0');
    expect(CreateAtmBankSchema.safeParse({ ...bank, color: '7030A0' }).success).toBe(false);
    expect(CreateAtmBankSchema.safeParse({ ...bank, color: '#FFF' }).success).toBe(false);
    expect(CreateAtmBankSchema.safeParse({ ...bank, color: 'red' }).success).toBe(false);
  });

  it('is strict: no active switch, seed flag or former labels on create', () => {
    for (const extra of [{ isActive: false }, { isSeed: true }, { formerOpsLabels: ['X'] }]) {
      expect(CreateAtmBankSchema.safeParse({ ...bank, ...extra }).success).toBe(false);
    }
  });
});

describe('UpdateAtmBankSchema', () => {
  it('needs a version and never takes the code', () => {
    expect(UpdateAtmBankSchema.safeParse({ version: 0 }).success).toBe(true);
    expect(UpdateAtmBankSchema.safeParse({}).success).toBe(false);
    expect(UpdateAtmBankSchema.safeParse({ version: 0, code: 'QNB' }).success).toBe(false);
    expect(UpdateAtmBankSchema.safeParse({ version: 0, formerOpsLabels: [] }).success).toBe(false);
  });

  it('archives, renames, re-labels and re-colours', () => {
    expect(
      UpdateAtmBankSchema.parse({
        version: 3,
        isActive: false,
        name: { ar: ' بنك ', en: ' Bank ' },
        opsLabel: ' QNB2 ',
        color: '#00b0f0',
        sortOrder: 70,
      }),
    ).toEqual({
      version: 3,
      isActive: false,
      name: { ar: 'بنك', en: 'Bank' },
      opsLabel: 'QNB2',
      color: '#00B0F0',
      sortOrder: 70,
    });
    expect(UpdateAtmBankSchema.safeParse({ version: 3, name: { ar: 'بنك' } }).success).toBe(false);
    expect(UpdateAtmBankSchema.safeParse({ version: 3, sortOrder: 1.5 }).success).toBe(false);
  });
});

describe('atmBankLabelKey', () => {
  it('matches a label case- and space-insensitively at its ends only', () => {
    expect(atmBankLabelKey(' nbe forex ')).toBe('NBE FOREX');
    expect(atmBankLabelKey('MISR')).toBe(atmBankLabelKey('misr'));
    expect(atmBankLabelKey('NBE  FOREX')).not.toBe(atmBankLabelKey('NBE FOREX'));
  });
});

describe('atmBankName / atmBankColor — catalog, then seed, then the code (or null)', () => {
  const catalog = [
    { code: 'QNB', name: { ar: 'بنك قطر الوطني', en: 'QNB Al Ahli' }, color: '#7030A0' },
    { code: 'BM', name: { ar: 'بنك مصر (معدل)', en: 'Banque Misr (edited)' }, color: '#123456' },
  ];

  it('prefers the catalog', () => {
    expect(atmBankName('QNB', 'ar', catalog)).toBe('بنك قطر الوطني');
    expect(atmBankName('QNB', 'en', catalog)).toBe('QNB Al Ahli');
    expect(atmBankName('BM', 'en', catalog)).toBe('Banque Misr (edited)');
    expect(atmBankColor('QNB', catalog)).toBe('#7030A0');
    expect(atmBankColor('BM', catalog)).toBe('#123456');
  });

  it('falls back to the seed when the catalog lacks the bank or is not loaded', () => {
    expect(atmBankName('NBE', 'ar', catalog)).toBe('البنك الأهلي المصري');
    expect(atmBankName('BM', 'en')).toBe('Banque Misr');
    expect(atmBankColor('CIB', catalog)).toBe('#FFD966');
    expect(atmBankColor('NXT')).toBe('#000099');
  });

  it('ends with the code itself for a name, and null for a colour', () => {
    expect(atmBankName('AAIB', 'ar', catalog)).toBe('AAIB');
    expect(atmBankName('QNB', 'en')).toBe('QNB');
    expect(atmBankColor('AAIB', catalog)).toBeNull();
    expect(atmBankColor('QNB')).toBeNull();
  });
});

// ── Settings value schemas ──────────────────────────────────────────────────────────────────────

describe('register settings', () => {
  it('branch codes: each code once and each branch once', () => {
    expect(
      AtmRegisterBranchCodesSettingSchema.safeParse([
        { code: 'EGYCASH-1', branchId: BRANCH_ID },
        { code: 'EGYCASH-2', branchId: OTHER_BRANCH_ID },
      ]).success,
    ).toBe(true);
    expect(
      AtmRegisterBranchCodesSettingSchema.safeParse([
        { code: 'EGYCASH-1', branchId: BRANCH_ID },
        { code: 'EGYCASH-1', branchId: OTHER_BRANCH_ID },
      ]).success,
    ).toBe(false);
    expect(
      AtmRegisterBranchCodesSettingSchema.safeParse([
        { code: 'EGYCASH-1', branchId: BRANCH_ID },
        { code: 'EGYCASH-2', branchId: BRANCH_ID },
      ]).success,
    ).toBe(false);
    expect(AtmRegisterBranchCodesSettingSchema.safeParse([]).success).toBe(true);
  });

  // The setting knows nothing of `atm.branchLinks`: a code on a linked source and a code on its
  // target are two RAW branches and both parse. Reading resolves them; a link-aware refinement
  // here would make the stored production value fail the schema — and a stored value that fails
  // reads as `[]`, every branch unmapped (2026-10-28, branch alignment).
  it('branch codes: stays on the raw ids — a linked source and its target each keep a code', () => {
    const linkedSetting = [
      { code: 'EGYCASH-1', branchId: BRANCH_ID },
      { code: 'EGYCASH-5', branchId: OTHER_BRANCH_ID },
    ];
    expect(AtmRegisterBranchCodesSettingSchema.parse(linkedSetting)).toEqual(linkedSetting);
  });

  it('bank labels (retired, read once by the seed): each bank once; the default covers all six', () => {
    expect(
      AtmRegisterBankLabelsSettingSchema.safeParse([
        { bankCode: 'NBE', label: 'NBE' },
        { bankCode: 'NBE', label: 'NBE FOREX' },
      ]).success,
    ).toBe(false);
    expect(
      AtmRegisterBankLabelsSettingSchema.safeParse(ATM_DEFAULT_BANK_LABELS_SETTING).success,
    ).toBe(true);
    expect(ATM_DEFAULT_BANK_LABELS_SETTING.map((r) => r.bankCode)).toEqual([
      ...ATM_SEED_BANK_CODES,
    ]);
    expect(ATM_DEFAULT_BANK_LABELS_SETTING.find((r) => r.bankCode === 'BM')?.label).toBe('MISR');
    // The setting never knew a catalog bank, and must not start to: the catalog's opsLabel is it.
    expect(
      AtmRegisterBankLabelsSettingSchema.safeParse([{ bankCode: 'QNB', label: 'QNB' }]).success,
    ).toBe(false);
  });
});

// ── The Data Report fold (D7) ───────────────────────────────────────────────────────────────────

interface Row {
  branchCode: AtmRegisterBranchCode | null;
  /** A branch is set on the row but has no mapping — the report's "unmapped". */
  unmappedBranch?: boolean;
  bankCode: AtmBankCode | null;
  startDate: string | null;
  endDate: string | null;
}

/** What the report endpoint does: keep the ACTIVE rows, group by (branch, bank), fold. */
const activeGroups = (rows: readonly Row[]): AtmRegisterReportGroup[] => {
  const groups = new Map<string, AtmRegisterReportGroup>();
  for (const row of rows) {
    const hasBranch = row.branchCode !== null || row.unmappedBranch === true;
    if (!isAtmRegisterActive({ hasBranch, startDate: row.startDate, endDate: row.endDate }))
      continue;
    const key = `${row.branchCode ?? '-'}|${row.bankCode ?? '-'}`;
    const group = groups.get(key) ?? {
      branchCode: row.branchCode,
      bankCode: row.bankCode,
      count: 0,
    };
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()];
};

const open = (branchCode: AtmRegisterBranchCode, bankCode: AtmBankCode | null): Row => ({
  branchCode,
  bankCode,
  startDate: '2026-01-01',
  endDate: null,
});

describe('foldAtmRegisterReport', () => {
  it('S1: handing one NXT machine back takes it out of every total', () => {
    const before = foldAtmRegisterReport(
      activeGroups([open('EGYCASH-4', 'NXT'), open('EGYCASH-1', 'NXT')]),
    );
    const after = foldAtmRegisterReport(
      activeGroups([
        open('EGYCASH-4', 'NXT'),
        { ...open('EGYCASH-1', 'NXT'), endDate: '2026-02-01' },
      ]),
    );
    expect(before.section1.NXT).toBe(2);
    expect(after.section1.NXT).toBe(1);
    expect(after.section1.total).toBe(before.section1.total - 1);
    expect(after.section2.total).toBe(before.section2.total - 1);
  });

  it('S2/S3: an Alexandria NXT counts under NXT and an Alexandria HDB once under HDB', () => {
    const nxtOnly = foldAtmRegisterReport(activeGroups([open('EGYCASH-4', 'NXT')]));
    expect(nxtOnly.section3['EGYCASH-4']?.NXT).toBe(1);
    expect(nxtOnly.section3['EGYCASH-4']?.HDB).toBe(0);

    const hdbOnly = foldAtmRegisterReport(activeGroups([open('EGYCASH-4', 'HDB')]));
    expect(hdbOnly.section3['EGYCASH-4']?.HDB).toBe(1);
    expect(hdbOnly.section3['EGYCASH-4']?.NXT).toBe(0);
    expect(hdbOnly.section1.HDB).toBe(1);
    expect(hdbOnly.section2['EGYCASH-4']).toBe(1);
  });

  it('S5: a pending row with a bank is not active and counts nowhere', () => {
    const counts = foldAtmRegisterReport(
      activeGroups([{ branchCode: 'EGYCASH-4', bankCode: 'NBE', startDate: null, endDate: null }]),
    );
    expect(counts.section1.total).toBe(0);
    expect(counts.section2.total).toBe(0);
    expect(counts.section3['EGYCASH-4']?.NBE).toBe(0);
  });

  it('S7: an active row without a bank counts in its branch cell only', () => {
    const counts = foldAtmRegisterReport(activeGroups([open('EGYCASH-2', null)]));
    expect(counts.activeWithoutBank).toBe(1);
    expect(counts.section2['EGYCASH-2']).toBe(1);
    expect(counts.section2.total).toBe(1);
    expect(counts.section1.total).toBe(0);
    expect(Object.values(counts.section3['EGYCASH-2'] ?? {})).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('an active row of an unmapped branch counts in section 1 only, and is flagged', () => {
    const counts = foldAtmRegisterReport(
      activeGroups([
        {
          branchCode: null,
          unmappedBranch: true,
          bankCode: 'BM',
          startDate: '2026-01-01',
          endDate: null,
        },
        open('EGYCASH-1', 'BM'),
      ]),
    );
    expect(counts.section1.BM).toBe(2);
    expect(counts.section1.total).toBe(2);
    expect(counts.section2.total).toBe(1);
    expect(counts.activeWithUnmappedBranch).toBe(1);
  });

  it('a row with no branch at all is not active (Excel A>0)', () => {
    const counts = foldAtmRegisterReport(
      activeGroups([{ branchCode: null, bankCode: 'BM', startDate: '2026-01-01', endDate: null }]),
    );
    expect(counts.section1.total).toBe(0);
    expect(counts.activeWithUnmappedBranch).toBe(0);
  });

  it('every shown cell is present as 0, and only shown branches appear', () => {
    const counts = foldAtmRegisterReport([], ['EGYCASH-2', 'EGYCASH-4']);
    expect(counts.section1).toEqual({ NBE: 0, BM: 0, CIB: 0, HDB: 0, BRK: 0, NXT: 0, total: 0 });
    expect(counts.section2).toEqual({ 'EGYCASH-2': 0, 'EGYCASH-4': 0, total: 0 });
    expect(Object.keys(counts.section3).sort()).toEqual(['EGYCASH-2', 'EGYCASH-4']);
    expect(counts.section3['EGYCASH-4']).toEqual({ NBE: 0, BM: 0, CIB: 0, HDB: 0, BRK: 0, NXT: 0 });
    expect(foldAtmRegisterReport([]).section2).toEqual({
      ...Object.fromEntries(ATM_REGISTER_BRANCH_CODES.map((code) => [code, 0])),
      total: 0,
    });
  });

  it('a mapped branch outside the shown set counts in section 1 but not in section 2', () => {
    const counts = foldAtmRegisterReport(
      [{ branchCode: 'EGYCASH-1', bankCode: 'NBE', count: 3 }],
      ['EGYCASH-2'],
    );
    expect(counts.section1.NBE).toBe(3);
    expect(counts.section2.total).toBe(0);
    expect(counts.section2['EGYCASH-1']).toBeUndefined();
  });
});

describe('foldAtmRegisterReport with catalog banks (DEC-35, DEC-40)', () => {
  const SEVEN: readonly AtmBankCode[] = [...ATM_SEED_BANK_CODES, 'QNB'];

  it('folds a seventh bank into every section, and the totals still agree', () => {
    const groups: AtmRegisterReportGroup[] = [
      { branchCode: 'EGYCASH-1', bankCode: 'QNB', count: 4 },
      { branchCode: 'EGYCASH-1', bankCode: 'NBE', count: 2 },
      { branchCode: 'EGYCASH-2', bankCode: 'QNB', count: 1 },
    ];
    const counts = foldAtmRegisterReport(groups, ATM_REGISTER_BRANCH_CODES, SEVEN);
    expect(counts.section1).toEqual({
      NBE: 2,
      BM: 0,
      CIB: 0,
      HDB: 0,
      BRK: 0,
      NXT: 0,
      QNB: 5,
      total: 7,
    });
    expect(counts.section2.total).toBe(7);
    expect(counts.section2.total).toBe(counts.section1.total);
    expect(counts.section3['EGYCASH-1']).toMatchObject({ QNB: 4, NBE: 2 });
    // Every shown branch carries the seventh column as 0, never absent.
    expect(counts.section3['EGYCASH-7']).toEqual({
      NBE: 0,
      BM: 0,
      CIB: 0,
      HDB: 0,
      BRK: 0,
      NXT: 0,
      QNB: 0,
    });
  });

  it('a listed bank with nothing open still has its 0 cell', () => {
    expect(foldAtmRegisterReport([], ['EGYCASH-1'], SEVEN).section1.QNB).toBe(0);
  });

  it('appends a group whose bank is not listed, sorted, instead of losing it from the totals', () => {
    const counts = foldAtmRegisterReport(
      [
        { branchCode: 'EGYCASH-1', bankCode: 'ZZB', count: 1 },
        { branchCode: 'EGYCASH-1', bankCode: 'AAIB', count: 2 },
        { branchCode: 'EGYCASH-1', bankCode: 'BM', count: 3 },
      ],
      ['EGYCASH-1'],
    );
    expect(Object.keys(counts.section1)).toEqual([...ATM_SEED_BANK_CODES, 'AAIB', 'ZZB', 'total']);
    expect(counts.section1.total).toBe(6);
    expect(counts.section2.total).toBe(6);
    expect(counts.section3['EGYCASH-1']).toMatchObject({ AAIB: 2, ZZB: 1, BM: 3 });
  });

  it('defaults to the workbook’s six — what the import’s 57-cell check folds with', () => {
    const counts = foldAtmRegisterReport([]);
    expect(Object.keys(counts.section1)).toEqual([...ATM_SEED_BANK_CODES, 'total']);
    expect(Object.keys(counts.section3['EGYCASH-1'] ?? {})).toEqual([...ATM_SEED_BANK_CODES]);
  });

  it('reads a cell of a bank the fold did not see as 0', () => {
    const counts = foldAtmRegisterReport([]);
    const [qnb] = buildAtmReportCells(['QNB'], []);
    expect(qnb).toBeDefined();
    if (qnb !== undefined) expect(readAtmReportCell(counts, qnb)).toBe(0);
  });
});

describe('atmReportBankOrders — the six keep their sheet places, catalog banks follow', () => {
  it('appends after BRK in section 1 and after NXT in section 3, in the given order', () => {
    expect(atmReportBankOrders(['QNB', 'AAIB'])).toEqual({
      section1: ['NXT', 'NBE', 'BM', 'CIB', 'HDB', 'BRK', 'QNB', 'AAIB'],
      section3: ['NBE', 'BM', 'CIB', 'HDB', 'BRK', 'NXT', 'QNB', 'AAIB'],
    });
  });

  it('is the sheet itself with no extras, and drops seeds and repeats', () => {
    expect(atmReportBankOrders([])).toEqual({
      section1: [...ATM_REPORT_SECTION1_BANKS],
      section3: [...ATM_REPORT_SECTION3_BANKS],
    });
    expect(atmReportBankOrders(['NBE', 'QNB', 'QNB']).section3).toEqual([
      ...ATM_REPORT_SECTION3_BANKS,
      'QNB',
    ]);
  });
});

// ── The verified snapshot (spec §6.5) and the 57 cells ──────────────────────────────────────────

/** Section 3 of the 2026-09-29 snapshot: rows in SECTION3 order × banks NBE, BM, CIB, HDB, BRK, NXT. */
const SNAPSHOT_SECTION3: Record<AtmRegisterBranchCode, readonly number[]> = {
  'EGYCASH-1': [487, 412, 60, 43, 57, 2],
  'EGYCASH-5': [198, 177, 47, 27, 24, 2],
  'EGYCASH-2': [85, 126, 0, 0, 0, 0],
  'EGYCASH-3': [86, 68, 0, 0, 0, 0],
  'EGYCASH-4': [138, 156, 0, 0, 0, 0],
  'EGYCASH-6': [62, 162, 0, 0, 0, 0],
  'EGYCASH-7': [156, 0, 0, 7, 25, 0],
};
const SNAPSHOT_SECTION1 = { NXT: 4, NBE: 1212, BM: 1101, CIB: 107, HDB: 77, BRK: 106, total: 2607 };
const SNAPSHOT_SECTION2 = {
  'EGYCASH-7': 188,
  'EGYCASH-1': 1061,
  'EGYCASH-2': 211,
  'EGYCASH-3': 154,
  'EGYCASH-4': 294,
  'EGYCASH-5': 475,
  'EGYCASH-6': 224,
  total: 2607,
};

const snapshotGroups = (): AtmRegisterReportGroup[] =>
  ATM_REPORT_SECTION3_BRANCHES.flatMap((branchCode) =>
    ATM_REPORT_SECTION3_BANKS.map((bankCode, i) => ({
      branchCode,
      bankCode,
      count: SNAPSHOT_SECTION3[branchCode][i] ?? 0,
    })),
  );

describe('the snapshot matrix folds back into the sheet', () => {
  it('reproduces sections 1 and 2 exactly', () => {
    const counts = foldAtmRegisterReport(snapshotGroups());
    expect(counts.section1).toEqual(SNAPSHOT_SECTION1);
    expect(counts.section2).toEqual(SNAPSHOT_SECTION2);
    expect(counts.activeWithUnmappedBranch).toBe(0);
    expect(counts.activeWithoutBank).toBe(0);
  });

  it('reads every one of the 57 cells back from the fold', () => {
    const counts = foldAtmRegisterReport(snapshotGroups());
    for (const ref of ATM_DATA_REPORT_CELLS) {
      const expected =
        ref.section === 1
          ? SNAPSHOT_SECTION1[ref.isTotal ? 'total' : (ref.bankCode as AtmSeedBankCode)]
          : ref.section === 2
            ? SNAPSHOT_SECTION2[ref.isTotal ? 'total' : (ref.branchCode as AtmRegisterBranchCode)]
            : SNAPSHOT_SECTION3[ref.branchCode as AtmRegisterBranchCode][
                ATM_REPORT_SECTION3_BANKS.indexOf(ref.bankCode as AtmSeedBankCode)
              ];
      expect(readAtmReportCell(counts, ref), ref.key).toBe(expected);
    }
  });
});

describe('ATM_DATA_REPORT_CELLS', () => {
  const letters = (from: string, to: string): string[] => {
    const all = ['AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK'];
    return all.slice(all.indexOf(from), all.indexOf(to) + 1);
  };

  it('holds the 57 numeric cells at the sheet addresses', () => {
    expect(ATM_DATA_REPORT_CELLS).toHaveLength(57);
    const cells = ATM_DATA_REPORT_CELLS.map((ref) => ref.cell);
    const section3 = [8, 9, 10, 11, 12, 13, 14].flatMap((row) =>
      letters('AE', 'AJ').map((c) => `${c}${String(row)}`),
    );
    expect(cells).toEqual([
      ...letters('AD', 'AJ').map((c) => `${c}3`),
      ...letters('AD', 'AK').map((c) => `${c}5`),
      ...section3,
    ]);
    expect(new Set(ATM_DATA_REPORT_CELLS.map((ref) => ref.key)).size).toBe(57);
  });

  it('names the sheet orders: NXT first in section 1, وصال first in section 2', () => {
    expect(ATM_DATA_REPORT_CELLS[0]).toMatchObject({ key: 's1.NXT', cell: 'AD3', bankCode: 'NXT' });
    expect(ATM_DATA_REPORT_CELLS[6]).toMatchObject({ key: 's1.total', cell: 'AJ3', isTotal: true });
    expect(ATM_DATA_REPORT_CELLS[7]).toMatchObject({ key: 's2.EGYCASH-7', cell: 'AD5' });
    expect(ATM_DATA_REPORT_CELLS[14]).toMatchObject({
      key: 's2.total',
      cell: 'AK5',
      isTotal: true,
    });
    expect(ATM_DATA_REPORT_CELLS[15]).toMatchObject({
      key: 's3.EGYCASH-1.NBE',
      cell: 'AE8',
      branchCode: 'EGYCASH-1',
      bankCode: 'NBE',
    });
    expect(ATM_DATA_REPORT_CELLS[56]).toMatchObject({ key: 's3.EGYCASH-7.NXT', cell: 'AJ14' });
  });

  it('is byte for byte the 57 cells the sheet constant held before the catalog', () => {
    // Written out from the workbook, NOT from this module's orders — so a change to an order, a
    // letter, a key or even a property's position fails here (the cut-over check compares
    // against the workbook, cell by cell).
    type Row = [string, string, 1 | 2 | 3, string | null, string | null, boolean];
    const s1: Row[] = [
      ['s1.NXT', 'AD3', 1, null, 'NXT', false],
      ['s1.NBE', 'AE3', 1, null, 'NBE', false],
      ['s1.BM', 'AF3', 1, null, 'BM', false],
      ['s1.CIB', 'AG3', 1, null, 'CIB', false],
      ['s1.HDB', 'AH3', 1, null, 'HDB', false],
      ['s1.BRK', 'AI3', 1, null, 'BRK', false],
      ['s1.total', 'AJ3', 1, null, null, true],
    ];
    const s2: Row[] = [
      ['s2.EGYCASH-7', 'AD5', 2, 'EGYCASH-7', null, false],
      ['s2.EGYCASH-1', 'AE5', 2, 'EGYCASH-1', null, false],
      ['s2.EGYCASH-2', 'AF5', 2, 'EGYCASH-2', null, false],
      ['s2.EGYCASH-3', 'AG5', 2, 'EGYCASH-3', null, false],
      ['s2.EGYCASH-4', 'AH5', 2, 'EGYCASH-4', null, false],
      ['s2.EGYCASH-5', 'AI5', 2, 'EGYCASH-5', null, false],
      ['s2.EGYCASH-6', 'AJ5', 2, 'EGYCASH-6', null, false],
      ['s2.total', 'AK5', 2, null, null, true],
    ];
    const s3Rows = [
      'EGYCASH-1',
      'EGYCASH-5',
      'EGYCASH-2',
      'EGYCASH-3',
      'EGYCASH-4',
      'EGYCASH-6',
      'EGYCASH-7',
    ];
    const s3Banks = [
      ['NBE', 'AE'],
      ['BM', 'AF'],
      ['CIB', 'AG'],
      ['HDB', 'AH'],
      ['BRK', 'AI'],
      ['NXT', 'AJ'],
    ] as const;
    const s3: Row[] = s3Rows.flatMap((branch, i) =>
      s3Banks.map(([bank, column]): Row => [
        `s3.${branch}.${bank}`,
        `${column}${String(8 + i)}`,
        3,
        branch,
        bank,
        false,
      ]),
    );
    const sheet = [...s1, ...s2, ...s3].map(
      ([key, cell, section, branchCode, bankCode, isTotal]) => ({
        key,
        cell,
        section,
        branchCode,
        bankCode,
        isTotal,
      }),
    );
    expect(sheet).toHaveLength(57);
    expect(JSON.stringify(ATM_DATA_REPORT_CELLS)).toBe(JSON.stringify(sheet));
  });
});

describe('buildAtmReportCells', () => {
  const { section1, section3 } = atmReportBankOrders(['QNB']);
  const cells = buildAtmReportCells(section1, section3);

  it('is the sheet for the sheet orders', () => {
    expect(buildAtmReportCells(ATM_REPORT_SECTION1_BANKS, ATM_REPORT_SECTION3_BANKS)).toEqual(
      ATM_DATA_REPORT_CELLS,
    );
  });

  it('puts a seventh bank after BRK in section 1 with no sheet letter; the total keeps AJ3', () => {
    const s1 = cells.filter((ref) => ref.section === 1);
    expect(s1.map((ref) => [ref.key, ref.cell])).toEqual([
      ['s1.NXT', 'AD3'],
      ['s1.NBE', 'AE3'],
      ['s1.BM', 'AF3'],
      ['s1.CIB', 'AG3'],
      ['s1.HDB', 'AH3'],
      ['s1.BRK', 'AI3'],
      ['s1.QNB', ''],
      ['s1.total', 'AJ3'],
    ]);
    expect(s1[6]).toMatchObject({ bankCode: 'QNB', isTotal: false, branchCode: null });
  });

  it('leaves section 2 alone — its total keeps AK5', () => {
    const s2 = cells.filter((ref) => ref.section === 2);
    expect(s2).toEqual(ATM_DATA_REPORT_CELLS.filter((ref) => ref.section === 2));
    expect(s2.at(-1)).toMatchObject({ key: 's2.total', cell: 'AK5' });
  });

  it('puts a seventh bank after NXT in every section-3 row, with no sheet letter', () => {
    const row = cells.filter((ref) => ref.section === 3 && ref.branchCode === 'EGYCASH-5');
    expect(row.map((ref) => [ref.key, ref.cell])).toEqual([
      ['s3.EGYCASH-5.NBE', 'AE9'],
      ['s3.EGYCASH-5.BM', 'AF9'],
      ['s3.EGYCASH-5.CIB', 'AG9'],
      ['s3.EGYCASH-5.HDB', 'AH9'],
      ['s3.EGYCASH-5.BRK', 'AI9'],
      ['s3.EGYCASH-5.NXT', 'AJ9'],
      ['s3.EGYCASH-5.QNB', ''],
    ]);
    expect(cells.filter((ref) => ref.section === 3)).toHaveLength(7 * 7);
    expect(new Set(cells.map((ref) => ref.key)).size).toBe(cells.length);
  });

  it('gives a seed its own sheet letter wherever the given order puts it', () => {
    const [first] = buildAtmReportCells(['BRK', 'NXT'], []);
    expect(first).toMatchObject({ key: 's1.BRK', cell: 'AI3' });
  });

  it('reads the seventh bank’s cells from a seven-bank fold', () => {
    const counts = foldAtmRegisterReport(
      [{ branchCode: 'EGYCASH-5', bankCode: 'QNB', count: 9 }],
      ATM_REGISTER_BRANCH_CODES,
      section3,
    );
    const value = (key: string): number | undefined => {
      const ref = cells.find((c) => c.key === key);
      return ref === undefined ? undefined : readAtmReportCell(counts, ref);
    };
    expect(value('s1.QNB')).toBe(9);
    expect(value('s1.total')).toBe(9);
    expect(value('s3.EGYCASH-5.QNB')).toBe(9);
    expect(value('s3.EGYCASH-1.QNB')).toBe(0);
  });
});

// ── The column catalogue ────────────────────────────────────────────────────────────────────────

describe('ATM_REGISTER_COLUMNS', () => {
  it('binds the 49 columns A..AW, in order, each (header, occurrence) once', () => {
    expect(ATM_REGISTER_COLUMNS).toHaveLength(49);
    const letter = (n: number): string =>
      n <= 26 ? String.fromCharCode(64 + n) : `A${String.fromCharCode(64 + n - 26)}`;
    expect(ATM_REGISTER_COLUMNS.map((c) => c.excel)).toEqual(
      Array.from({ length: 49 }, (_, i) => letter(i + 1)),
    );
    const bindings = ATM_REGISTER_COLUMNS.map((c) => `${c.header}#${String(c.occurrence)}`);
    expect(new Set(bindings).size).toBe(49);
    expect(new Set(ATM_REGISTER_COLUMNS.map((c) => c.field)).size).toBe(49);
  });

  it('numbers each repeated header by its occurrence', () => {
    const occurrences = (header: string): [string, number][] =>
      ATM_REGISTER_COLUMNS.filter((c) => c.header === header).map((c) => [c.excel, c.occurrence]);
    expect(occurrences('Number of\nkeys')).toEqual([
      ['O', 0],
      ['Q', 1],
    ]);
    expect(occurrences('Number of\nloading cassettes')).toEqual([
      ['S', 0],
      ['Z', 1],
    ]);
    expect(occurrences('LOCATION\nGPS')).toEqual([
      ['AP', 0],
      ['AV', 1],
    ]);
    expect(occurrences('Cassette -1')).toEqual([
      ['T', 0],
      ['AF', 1],
    ]);
  });

  it('classes J..Q, AN and AU as K and only AO as S', () => {
    const byClass = (cls: string): string[] =>
      ATM_REGISTER_COLUMNS.filter((c) => c.sensitivity === cls).map((c) => c.excel);
    expect(byClass('K')).toEqual(['J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'AN', 'AU']);
    expect(byClass('S')).toEqual(['AO']);
  });

  it('displays the Location group together: A..AO, AP, AV, AQ..AU, AW', () => {
    expect(ATM_REGISTER_DISPLAY_ORDER).toHaveLength(49);
    // A..AO is 41 columns.
    expect(ATM_REGISTER_DISPLAY_ORDER.slice(41)).toEqual([
      'AP',
      'AV',
      'AQ',
      'AR',
      'AS',
      'AT',
      'AU',
      'AW',
    ]);
    expect(ATM_REGISTER_DISPLAY_ORDER.slice(0, 41)).toEqual(
      ATM_REGISTER_COLUMNS.slice(0, 41).map((c) => c.excel),
    );
  });
});
