// The register's contract, pinned: the status rule (D1), the ONE active definition (D7), the input
// schemas' refusals, the per-bank ID shapes (D6, warnings only), and above all the Data Report
// fold — the single function both the report page and the import's 57-number check run, so a drift
// here would make the page and the cut-over check disagree about the same cell.
//
// Every value below is synthetic. No figure, code or combination from the owner's workbook is used
// except the published Data Report COUNTS (spec §6.5), which are totals, not records.
import { describe, expect, it } from 'vitest';
import {
  ATM_BANK_CODES,
  ATM_DATA_REPORT_CELLS,
  ATM_DEFAULT_BANK_LABELS_SETTING,
  ATM_REGISTER_BRANCH_CODES,
  ATM_REGISTER_COLUMNS,
  ATM_REGISTER_DISPLAY_ORDER,
  ATM_REPORT_SECTION3_BANKS,
  ATM_REPORT_SECTION3_BRANCHES,
  AtmRegisterBankLabelsSettingSchema,
  AtmRegisterBranchCodesSettingSchema,
  AtmRegisterDateSchema,
  ExportAtmRegisterEntriesQuerySchema,
  HandoverAtmRegisterEntrySchema,
  ListAtmRegisterEntriesQuerySchema,
  ReceiveAtmRegisterEntrySchema,
  UpdateAtmRegisterEntrySchema,
  atmRegisterIdFormatOk,
  deriveAtmRegisterStatus,
  foldAtmRegisterReport,
  isAtmRegisterActive,
  readAtmReportCell,
  type AtmBankCode,
  type AtmRegisterBranchCode,
  type AtmRegisterReportGroup,
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
  it('parse multi-value filters and refuse unknown banks', () => {
    const parsed = ListAtmRegisterEntriesQuerySchema.parse({ banks: 'NBE,BM', statuses: 'open' });
    expect(parsed.banks).toEqual(['NBE', 'BM']);
    expect(parsed.statuses).toEqual(['open']);
    expect(ListAtmRegisterEntriesQuerySchema.safeParse({ banks: 'XYZ' }).success).toBe(false);
  });

  it('export takes the filters without a page', () => {
    expect(ExportAtmRegisterEntriesQuerySchema.safeParse({ withIssues: 'true' }).success).toBe(
      true,
    );
    expect(ExportAtmRegisterEntriesQuerySchema.safeParse({ page: '2' }).success).toBe(false);
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

  it('bank labels: each bank once; the default covers all six', () => {
    expect(
      AtmRegisterBankLabelsSettingSchema.safeParse([
        { bankCode: 'NBE', label: 'NBE' },
        { bankCode: 'NBE', label: 'NBE FOREX' },
      ]).success,
    ).toBe(false);
    expect(
      AtmRegisterBankLabelsSettingSchema.safeParse(ATM_DEFAULT_BANK_LABELS_SETTING).success,
    ).toBe(true);
    expect(ATM_DEFAULT_BANK_LABELS_SETTING.map((r) => r.bankCode)).toEqual([...ATM_BANK_CODES]);
    expect(ATM_DEFAULT_BANK_LABELS_SETTING.find((r) => r.bankCode === 'BM')?.label).toBe('MISR');
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
          ? SNAPSHOT_SECTION1[ref.isTotal ? 'total' : (ref.bankCode as AtmBankCode)]
          : ref.section === 2
            ? SNAPSHOT_SECTION2[ref.isTotal ? 'total' : (ref.branchCode as AtmRegisterBranchCode)]
            : SNAPSHOT_SECTION3[ref.branchCode as AtmRegisterBranchCode][
                ATM_REPORT_SECTION3_BANKS.indexOf(ref.bankCode as AtmBankCode)
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
