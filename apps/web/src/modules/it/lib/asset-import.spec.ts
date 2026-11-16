// «رفع جماعي» — the upload screen's rules, proved without a DOM: every decision and warning has its
// words and its colour in both languages, a line the server calls unselectable can never be sent,
// «تحديد الكل» ticks and unticks only what it should, the request is exactly what the API's schema
// reads, the chips count and filter, a refusal is worded, and the template is the header row alone.
//
// «في الأصول عايز زرار Bulk Upload للأصول بنفس شكل عهدة الأفرع ويكون فى Preview الأول للى هيتضاف ويوضح لو
// فى تكرار أو تضارب مع بيانات موجوده وهكذا» (the owner, 2026-11-16). Fixture serials are invented.
import { describe, expect, it } from 'vitest';
import {
  IT_ASSET_IMPORT_COLUMNS,
  IT_ASSET_IMPORT_DECISIONS,
  IT_ASSET_IMPORT_WARNINGS,
  ItAssetImportFieldsSchema,
  ItAssetImportKindCategoriesSchema,
  ItAssetImportRowsSchema,
  type ItAssetImportDecision,
  type ItAssetImportRowDto,
  IT_ASSET_STATUSES,
  type ItAssetStatus,
  type Locale,
} from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { ApiError } from '../../../shared/lib/api-client';
import { buildXlsxBook } from '../../../shared/lib/xlsx-writer';
import {
  IMPORT_DECISION_TONE,
  allTicked,
  assetImportFields,
  assetImportTemplate,
  branchChangeRequest,
  carrySelection,
  decisionChips,
  decisionCountLabel,
  decisionLabel,
  defaultSelection,
  fillsShown,
  heldElsewhereWording,
  importErrorText,
  importFieldLabel,
  importFieldLabelKey,
  isRegisterChanged,
  keptRows,
  plannedBranchLabel,
  resultEntries,
  rowsInView,
  templateFileName,
  templateSheetName,
  toggleAll,
  toggleChip,
  toggleRow,
  warningLabel,
  withKindCategory,
} from './asset-import';

const tr =
  (locale: Locale) =>
  (key: string, params?: Record<string, string | number>): string =>
    translate(locale, key, params);
const ar = tr('ar');
const en = tr('en');

const BRANCH = '64b000000000000000000001';
const OTHER = '64b000000000000000000002';
const CATEGORY = '64c000000000000000000001';
const PRINTERS = '64c000000000000000000002';
const SHA = 'a'.repeat(64);
const PLAN = 'b'.repeat(64);

const names: Record<string, string> = { [OTHER]: 'المهندسين' };
const branchName = (id: string): string | undefined => names[id];

const line = (over: Partial<ItAssetImportRowDto> = {}): ItAssetImportRowDto => ({
  row: 2,
  kind: 'كمبيوتر مكتبي',
  name: 'Dell OptiPlex 7090',
  serial: 'ZQ7K2M1',
  tag: null,
  manufacturer: 'Dell',
  model: 'OptiPlex 7090',
  decision: 'new',
  warnings: [],
  asset: null,
  serialNumber: 'ZQ7K2M1',
  externalTag: null,
  categoryId: CATEGORY,
  fills: [],
  kept: [],
  fromBranchId: null,
  firstRow: null,
  near: null,
  message: null,
  selectable: true,
  selected: true,
  ...over,
});

const asset = (id: string, code: string) => ({
  id,
  assetCode: code,
  branchId: OTHER,
  status: 'inStock' as const,
});

describe('every decision has its words and its colour', () => {
  it('maps every decision of the contract to a tone, and nothing else', () => {
    expect(Object.keys(IMPORT_DECISION_TONE).sort()).toEqual([...IT_ASSET_IMPORT_DECISIONS].sort());
  });

  it('words each decision as the owner’s screen says it', () => {
    const say = (over: Partial<ItAssetImportRowDto>): string =>
      decisionLabel(ar, line(over), branchName);
    expect(say({ decision: 'new' })).toBe('جديد');
    expect(say({ decision: 'fill' })).toBe('تكملة بيانات');
    expect(say({ decision: 'move', fromBranchId: OTHER })).toBe('نقل من فرع المهندسين');
    expect(say({ decision: 'complete' })).toBe('موجود ومكتمل');
    expect(
      say({
        decision: 'heldElsewhere',
        fromBranchId: OTHER,
        asset: { ...asset('a-1', 'AST-00042'), status: 'assigned' },
      }),
    ).toBe('متسلَّم في فرع المهندسين — لا يُنقل');
    expect(say({ decision: 'outOfScope' })).toBe('خارج صلاحيتك');
    expect(say({ decision: 'duplicateInFile', firstRow: 3 })).toBe('مكرر — الصف 3');
    expect(say({ decision: 'ambiguous' })).toBe('يطابق أكثر من جهاز');
    expect(say({ decision: 'noIdentifier' })).toBe('بلا سيريال ولا ملصق');
    expect(say({ decision: 'unknownKind' })).toBe('نوع بلا فئة');
    expect(say({ decision: 'invalid' })).toBe('غير صالح');
  });

  // «متسلَّم» is a claim about a person: a device kept by maintenance or disposed is not «held».
  describe('a device left in another branch says why', () => {
    const held = (status: ItAssetStatus | null): ItAssetImportRowDto =>
      line({
        decision: 'heldElsewhere',
        fromBranchId: OTHER,
        asset: status === null ? null : { ...asset('a-1', 'AST-00042'), status },
        fills: ['manufacturer'],
        selected: false,
      });

    it('takes its words from the matched device’s status — every status covered', () => {
      const expected: Record<ItAssetStatus, string> = {
        assigned: 'assignedElsewhere',
        underMaintenance: 'inMaintenanceElsewhere',
        // Only an open maintenance order leaves an in-stock device of another branch where it is.
        inStock: 'inMaintenanceElsewhere',
        disposed: 'disposedElsewhere',
      };
      for (const status of IT_ASSET_STATUSES) {
        expect(heldElsewhereWording(held(status)), status).toBe(expected[status]);
      }
      // No device named on the line — the server decided it stays; nothing says why, so the
      // decision's own, neutral words.
      expect(heldElsewhereWording(held(null))).toBe('heldElsewhere');
    });

    it('words the badge accordingly, with the branch and without it', () => {
      const say = (status: ItAssetStatus | null, from: string | null = OTHER): string =>
        decisionLabel(ar, { ...held(status), fromBranchId: from }, branchName);
      expect(say('assigned')).toBe('متسلَّم في فرع المهندسين — لا يُنقل');
      expect(say('underMaintenance')).toBe('في الصيانة في فرع المهندسين — لا يُنقل');
      expect(say('inStock')).toBe('في الصيانة في فرع المهندسين — لا يُنقل');
      expect(say('disposed')).toBe('مستبعَد في فرع المهندسين');
      expect(say(null)).toBe('في فرع المهندسين — لا يُنقل');
      expect(say(null, null)).toBe('في فرع آخر — لا يُنقل');
      expect(say('assigned', null)).toBe('متسلَّم في فرع آخر — لا يُنقل');
      expect(say('inStock', null)).toBe('في الصيانة في فرع آخر — لا يُنقل');
      expect(say('underMaintenance', BRANCH)).toBe('في الصيانة في فرع آخر — لا يُنقل');
      expect(say('disposed', null)).toBe('مستبعَد في فرع آخر');
      expect(decisionLabel(en, held('inStock'), branchName)).toBe(
        'Under maintenance in branch المهندسين — not moved',
      );
      expect(decisionLabel(en, held('disposed'), branchName)).toBe('Disposed in branch المهندسين');
    });

    // The chip counts every line of the decision — held, kept by maintenance, disposed — and a line
    // naming no device says only what the server decided: neither may claim a holder.
    it('names the decision itself in neutral words — its chip, and a line naming no device', () => {
      expect(decisionCountLabel(ar, 'heldElsewhere')).toBe('في فرع آخر — لا يُنقل');
      expect(decisionCountLabel(en, 'heldElsewhere')).toBe('In another branch — not moved');
      expect(decisionLabel(en, held(null), branchName)).toBe('In branch المهندسين — not moved');
      for (const t of [ar, en]) {
        const generic = [
          decisionCountLabel(t, 'heldElsewhere'),
          decisionLabel(t, held(null), branchName),
          decisionLabel(t, { ...held(null), fromBranchId: null }, branchName),
        ];
        for (const words of generic) {
          expect(words).not.toContain('متسل');
          expect(words).not.toMatch(/held/iu);
        }
      }
      // Only a device somebody holds is called held.
      expect(decisionLabel(en, held('assigned'), branchName)).toBe(
        'Held in branch المهندسين — not moved',
      );
    });

    it('leaves every other decision’s words to its decision, whatever the device’s status', () => {
      const maintained = { ...asset('a-1', 'AST-00042'), status: 'underMaintenance' as const };
      expect(
        decisionLabel(
          ar,
          line({ decision: 'move', fromBranchId: OTHER, asset: maintained }),
          branchName,
        ),
      ).toBe('نقل من فرع المهندسين');
      expect(decisionLabel(ar, line({ decision: 'fill', asset: maintained }), branchName)).toBe(
        'تكملة بيانات',
      );
    });
  });

  it('still says what a line is when its branch or its first row is not known', () => {
    expect(decisionLabel(ar, line({ decision: 'move', fromBranchId: null }), branchName)).toBe(
      'نقل من فرع آخر',
    );
    expect(
      decisionLabel(ar, line({ decision: 'heldElsewhere', fromBranchId: BRANCH }), branchName),
    ).toBe('في فرع آخر — لا يُنقل');
    expect(decisionLabel(ar, line({ decision: 'duplicateInFile' }), branchName)).toBe(
      'مكرر في الملف',
    );
  });

  for (const [locale, t] of [
    ['ar', ar],
    ['en', en],
  ] as const) {
    it(`resolves every decision, its chip and every warning — ${locale}`, () => {
      for (const decision of IT_ASSET_IMPORT_DECISIONS) {
        for (const over of [
          { fromBranchId: OTHER, firstRow: 4 },
          { fromBranchId: null, firstRow: null },
        ]) {
          for (const status of [null, ...IT_ASSET_STATUSES]) {
            const matched = status === null ? null : { ...asset('a-1', 'AST-00042'), status };
            const words = decisionLabel(t, line({ decision, ...over, asset: matched }), branchName);
            expect(words, `${decision} ${String(status)}`).not.toContain('it.assets');
            expect(words, `${decision} ${String(status)}`).not.toContain('{{');
          }
        }
        const chip = decisionCountLabel(t, decision);
        expect(chip, decision).not.toContain('it.assets');
        expect(chip.trim()).not.toBe('');
      }
      for (const warning of IT_ASSET_IMPORT_WARNINGS) {
        for (const near of [null, { assetCode: 'AST-00031', serialNumber: 'ZQ7K2N1' }]) {
          const words = warningLabel(t, warning, { near });
          expect(words, warning).not.toContain('it.assets');
          expect(words, warning).not.toContain('{{');
        }
      }
    });
  }

  it('names the device a serial is close to, and says the doubt even when it cannot', () => {
    expect(
      warningLabel(ar, 'nearSerial', { near: { assetCode: 'AST-00031', serialNumber: 'ZQ7K2N1' } }),
    ).toBe('قريب من جهاز مسجَّل: AST-00031 — راجع الملصق');
    expect(warningLabel(ar, 'nearSerial', { near: null })).toBe(
      'قريب من جهاز مسجَّل — راجع الملصق',
    );
    expect(warningLabel(ar, 'productNumber', { near: null })).toBe('الملصق رقم منتج وليس سيريالًا');
  });
});

describe('the fields a line fills or keeps, in the asset screen’s words', () => {
  it('labels the specs, the accessories and the identity fields as the asset form does', () => {
    expect(importFieldLabel(ar, 'specs.processor')).toBe(ar('it.assets.specs.processor'));
    expect(importFieldLabel(ar, 'specs.memory')).toBe(ar('it.assets.specs.memory'));
    expect(importFieldLabel(ar, 'specs.systemType')).toBe(ar('it.assets.specs.systemType'));
    expect(importFieldLabel(ar, 'specs.storage')).toBe(ar('it.assets.specs.storage'));
    expect(importFieldLabel(ar, 'specs.displayAdapter')).toBe(ar('it.assets.specs.displayAdapter'));
    expect(importFieldLabel(ar, 'accessories')).toBe('المشتملات');
    expect(importFieldLabel(ar, 'externalTag')).toBe('الملصق المطبوع');
    expect(importFieldLabel(ar, 'manufacturer')).toBe(ar('it.assets.fields.manufacturer'));
    expect(importFieldLabel(ar, 'model')).toBe('الموديل');
  });

  it('shows a field it has no label for as the server named it, never as a key', () => {
    expect(importFieldLabelKey('somethingNew')).toBeNull();
    expect(importFieldLabel(ar, 'somethingNew')).toBe('somethingNew');
  });

  it('says «يُكمَّل» only where a tick writes it — never on a line out of reach', () => {
    const fills = ['specs.processor', 'accessories'];
    const writing: ItAssetImportDecision[] = ['new', 'fill', 'move', 'heldElsewhere'];
    for (const decision of IT_ASSET_IMPORT_DECISIONS) {
      const shown = fillsShown(line({ decision, fills, selectable: writing.includes(decision) }));
      expect(shown, decision).toEqual(writing.includes(decision) ? fills : []);
    }
    // The device out of reach still lacks those fields — the plan found them — but nothing is
    // written on that line.
    expect(fillsShown(line({ decision: 'outOfScope', fills, selectable: false }))).toEqual([]);
    // Nor on a line the server will not let through, whatever its decision.
    expect(fillsShown(line({ decision: 'heldElsewhere', fills, selectable: false }))).toEqual([]);
  });
});

describe('the ticks', () => {
  const rows = [
    line({ row: 2 }),
    line({ row: 3, decision: 'fill' }),
    // A doubt: selectable, NOT ticked when the preview opens.
    line({ row: 4, warnings: ['nearSerial'], selected: false }),
    line({ row: 5, decision: 'complete', selectable: false, selected: false }),
    line({ row: 6, decision: 'outOfScope', selectable: false, selected: false }),
    // Never trusted: a line the server cannot write is not ticked, whatever `selected` says.
    line({ row: 7, decision: 'invalid', selectable: false, selected: true }),
  ];

  it('opens with every selectable line the server ticked — a doubt left off', () => {
    expect([...defaultSelection(rows)].sort()).toEqual([2, 3]);
  });

  it('turns one line over, and never a line that cannot be written', () => {
    const start = defaultSelection(rows);
    expect([...toggleRow(start, rows[2]!)].sort()).toEqual([2, 3, 4]);
    expect([...toggleRow(start, rows[0]!)].sort()).toEqual([3]);
    expect([...toggleRow(start, rows[3]!)].sort()).toEqual([2, 3]);
  });

  it('«تحديد الكل» ticks every selectable line in view, the doubtful one included — then clears them', () => {
    const start = defaultSelection(rows);
    expect(allTicked(start, rows)).toBe(false);
    const all = toggleAll(start, rows);
    expect([...all].sort()).toEqual([2, 3, 4]);
    expect(allTicked(all, rows)).toBe(true);
    expect([...toggleAll(all, rows)]).toEqual([]);
  });

  it('works on the lines in view only — a chip’s — and leaves the others as they were', () => {
    const start = defaultSelection(rows);
    const fills = rowsInView(rows, 'fill');
    expect(allTicked(start, fills)).toBe(true);
    expect([...toggleAll(start, fills)]).toEqual([2]);
    // A view with nothing selectable is never «all ticked».
    expect(allTicked(start, rowsInView(rows, 'complete'))).toBe(false);
    expect([...toggleAll(start, rowsInView(rows, 'complete'))].sort()).toEqual([2, 3]);
  });

  it('sends the ticked writable lines, in the sheet’s order', () => {
    expect(keptRows(new Set([4, 7, 2, 5]), rows)).toEqual([2, 4]);
  });

  describe('a second preview of the same file', () => {
    const before = { rows, selection: new Set([3, 4]) };

    it('keeps the reviewer’s ticks on lines that still mean the same', () => {
      expect([...carrySelection(before, rows)].sort()).toEqual([3, 4]);
    });

    it('opens a line whose meaning changed with the server’s default', () => {
      const next = [
        // Was new, now a fill of a device somebody registered meanwhile: the default, ticked.
        line({ row: 2, decision: 'fill', asset: asset('a-1', 'AST-00040') }),
        // Was ticked by the reviewer; now carries a doubt: the default, unticked.
        line({ row: 3, decision: 'fill', warnings: ['nearSerial'], selected: false }),
        line({ row: 4, warnings: ['nearSerial'], selected: false }),
        line({ row: 5, decision: 'complete', selectable: false, selected: false }),
        // New in this preview — no earlier judgement.
        line({ row: 8 }),
      ];
      expect([...carrySelection(before, next)].sort()).toEqual([2, 4, 8]);
    });

    it('starts from the defaults when there is no earlier preview', () => {
      expect([...carrySelection(null, rows)].sort()).toEqual([2, 3]);
    });
  });
});

describe('the chips', () => {
  it('counts the decisions the file holds, in the catalogue’s order, without the zeros', () => {
    const counts = Object.fromEntries(IT_ASSET_IMPORT_DECISIONS.map((d) => [d, 0])) as Record<
      ItAssetImportDecision,
      number
    >;
    counts.invalid = 1;
    counts.new = 5;
    counts.move = 2;
    expect(decisionChips(counts)).toEqual([
      { decision: 'new', count: 5 },
      { decision: 'move', count: 2 },
      { decision: 'invalid', count: 1 },
    ]);
  });

  it('filters the table, and a chip pressed again shows every line', () => {
    const rows = [line({ row: 2 }), line({ row: 3, decision: 'move' })];
    expect(rowsInView(rows, 'move').map((r) => r.row)).toEqual([3]);
    expect(rowsInView(rows, null).map((r) => r.row)).toEqual([2, 3]);
    expect(toggleChip(null, 'move')).toBe('move');
    expect(toggleChip('move', 'move')).toBeNull();
    expect(toggleChip('move', 'new')).toBe('new');
  });
});

describe('the request', () => {
  const fields = (list: [string, string][]): Record<string, string> => Object.fromEntries(list);

  it('a first preview may go with no branch and no category — nothing at all', () => {
    expect(assetImportFields({ branchId: null, kindCategories: {} })).toEqual([]);
    expect(assetImportFields({ branchId: '', kindCategories: { طابعة: '' } })).toEqual([]);
  });

  it('a preview names the branch and the kinds filed by hand, in a fixed order — and passes the schema', () => {
    const list = assetImportFields({
      branchId: BRANCH,
      kindCategories: { 'كمبيوتر مكتبي': CATEGORY, طابعة: PRINTERS },
    });
    expect(list.map(([name]) => name)).toEqual(['branchId', 'kindCategories']);
    // The same choice made in another order is the same request.
    expect(
      assetImportFields({
        branchId: BRANCH,
        kindCategories: { طابعة: PRINTERS, 'كمبيوتر مكتبي': CATEGORY },
      }),
    ).toEqual(list);
    const parsed = ItAssetImportFieldsSchema.parse(fields(list));
    expect(parsed.apply).toBe(false);
    expect(
      ItAssetImportKindCategoriesSchema.parse(JSON.parse(parsed.kindCategories ?? '')),
    ).toEqual({ 'كمبيوتر مكتبي': CATEGORY, طابعة: PRINTERS });
  });

  it('an apply carries the lines kept and the preview’s two hashes — and passes the schema', () => {
    const list = assetImportFields({
      branchId: BRANCH,
      kindCategories: {},
      apply: { fileSha256: SHA, planHash: PLAN, rows: [2, 5, 9] },
    });
    expect(list.map(([name]) => name)).toEqual([
      'branchId',
      'apply',
      'fileSha256',
      'planHash',
      'rows',
    ]);
    const parsed = ItAssetImportFieldsSchema.parse(fields(list));
    expect(parsed).toMatchObject({
      apply: true,
      branchId: BRANCH,
      fileSha256: SHA,
      planHash: PLAN,
    });
    expect(ItAssetImportRowsSchema.parse(JSON.parse(parsed.rows ?? ''))).toEqual([2, 5, 9]);
  });

  it('a kind’s category picked, then handed back to the server’s own match', () => {
    const picked = withKindCategory({}, 'طابعة', PRINTERS);
    expect(picked).toEqual({ طابعة: PRINTERS });
    expect(withKindCategory(picked, 'طابعة', '')).toEqual({});
  });
});

describe('the branch the plan is for', () => {
  const kinds = { طابعة: PRINTERS };
  // The preview on screen was planned for BRANCH; «تأكيد» writes there.
  const onScreen = { branchId: BRANCH, kindCategories: kinds };

  it('before any preview, a change of the select sends nothing — «معاينة» takes it as it stands', () => {
    expect(branchChangeRequest(OTHER, null)).toBeNull();
    expect(branchChangeRequest('', null)).toBeNull();
  });

  it('«من اسم الورقة» over a preview plans the same file again WITHOUT a branch', () => {
    const request = branchChangeRequest('', onScreen);
    expect(request).toEqual({ branchId: null, kindCategories: kinds });
    // …which is a request with no branch at all: the server suggests one from the sheet's name.
    expect(assetImportFields(request ?? { branchId: BRANCH, kindCategories: {} })).toEqual([
      ['kindCategories', JSON.stringify(kinds)],
    ]);
  });

  it('another branch plans the file for it; the branch already planned sends nothing', () => {
    expect(branchChangeRequest(OTHER, onScreen)).toEqual({
      branchId: OTHER,
      kindCategories: kinds,
    });
    expect(branchChangeRequest(BRANCH, onScreen)).toBeNull();
  });

  it('names the planned branch in words — and still says it is the one chosen when unnamed', () => {
    expect(plannedBranchLabel(ar, OTHER, branchName)).toBe('المعاينة لفرع المهندسين');
    expect(plannedBranchLabel(en, OTHER, branchName)).toBe('Preview for branch المهندسين');
    expect(plannedBranchLabel(ar, BRANCH, branchName)).toBe('المعاينة للفرع المختار');
  });
});

describe('a refusal, in the reader’s words', () => {
  const LIMITS = { maxRows: 500, maxMb: 5 };
  const say = (error: unknown): { text: string; detail: string | null } =>
    importErrorText(error, ar, 'ar', LIMITS);

  // The API's own refusals, as it words them (`asset-import.service.ts`, `-sheet.ts`, `.controller.ts`).
  it('a changed register is a 409 — and read again, not reported as a failure', () => {
    const changed = new ApiError(
      'STALE_DOCUMENT',
      'the register changed since the preview — preview again',
      409,
    );
    expect(isRegisterChanged(changed)).toBe(true);
    expect(isRegisterChanged(new ApiError('FORBIDDEN', 'no', 403))).toBe(false);
    expect(isRegisterChanged(new Error('x'))).toBe(false);
    expect(say(changed).text).toBe(ar('it.assets.import.error.changed'));
  });

  // The reader's own caps are not multer's: a 1 MB file whose sheet unpacks past one branch's page
  // is not «larger than 5 MB».
  it('a workbook past the reader’s caps is larger than one branch’s sheet — not than 5 MB', () => {
    const sheetCap = (what: string): ApiError =>
      new ApiError(
        'VALIDATION_FAILED',
        "the workbook is larger than one branch's sheet — upload the custody sheet on its own (at most 500 lines)",
        422,
        [{ field: 'file', code: 'SHEET_TOO_LARGE', message: what }],
      );
    for (const what of ['xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml', 'entries', 'time']) {
      expect(say(sheetCap(what)), what).toEqual({
        text: 'الملف أكبر من ورقة فرع واحد — ارفع ورقة العهدة وحدها (حتى 500 سطر).',
        detail: null,
      });
      expect(importErrorText(sheetCap(what), en, 'en', LIMITS).text, what).toBe(
        'The file is larger than one branch’s sheet — upload the custody sheet on its own (at most 500 lines).',
      );
    }
    // multer's cap on the upload itself keeps its own words.
    const uploadCap = new ApiError('VALIDATION_FAILED', 'File exceeds the 5 MB cap', 422, [
      { field: 'file', code: 'TOO_LARGE', message: '5 MB' },
    ]);
    expect(say(uploadCap)).toEqual({ text: 'حجم الملف أكبر من 5 ميجابايت.', detail: null });
    expect(importErrorText(uploadCap, en, 'en', LIMITS).text).toBe('The file is larger than 5 MB.');
  });

  it('a branch out of reach, a file too large, a branch nobody chose', () => {
    expect(
      say(new ApiError('FORBIDDEN', 'itAsset.create does not reach this branch', 403)).text,
    ).toBe(ar('it.assets.import.error.forbidden'));
    const tooLarge = new ApiError('VALIDATION_FAILED', 'File exceeds the 5 MB cap', 422, [
      { field: 'file', code: 'TOO_LARGE', message: '5 MB' },
    ]);
    expect(say(tooLarge).text).toBe('حجم الملف أكبر من 5 ميجابايت.');
    expect(say(new ApiError('PAYLOAD_TOO_LARGE', 'too large', 413)).text).toBe(
      'حجم الملف أكبر من 5 ميجابايت.',
    );
    const noBranch = new ApiError(
      'BUSINESS_RULE_VIOLATION',
      "choose the branch the file is for — the sheet's name suggests none",
      422,
    );
    expect(say(noBranch)).toEqual({
      text: ar('it.assets.import.error.chooseBranch'),
      detail: null,
    });
  });

  it('a sheet it cannot read: the screen’s sentence, then the server’s naming what to fix', () => {
    const header = say(
      new ApiError(
        'BUSINESS_RULE_VIOLATION',
        'the header «سيريال (Serial)» is missing — column C of row 1 must be it',
        422,
      ),
    );
    expect(header.text).toBe(ar('it.assets.import.error.unreadable', { rows: 500 }));
    expect(header.detail).toContain('column C');
    // «branch's» in the sentence is not a branch to choose.
    const tooMany = say(
      new ApiError(
        'BUSINESS_RULE_VIOLATION',
        "the sheet has more than 500 lines — upload one branch's sheet at a time",
        422,
      ),
    );
    expect(tooMany.text).toBe(ar('it.assets.import.error.unreadable', { rows: 500 }));
  });

  it('a kind filed under a category that is no longer active — the detail names the kind', () => {
    const view = say(
      new ApiError(
        'BUSINESS_RULE_VIOLATION',
        'the category chosen for «طابعة» is not an active asset category',
        422,
      ),
    );
    expect(view.text).toBe(ar('it.assets.import.error.category'));
    expect(view.detail).toContain('«طابعة»');
  });

  it('anything else falls back to the shared wording', () => {
    expect(say(new TypeError('Failed to fetch')).text).toBe('خطأ في الشبكة — تحقق من اتصالك.');
  });
});

describe('the result', () => {
  it('lists what was done, in a fixed order, without the zeros', () => {
    expect(resultEntries({ created: 4, filled: 0, moved: 2, unchanged: 1 })).toEqual([
      { key: 'created', count: 4 },
      { key: 'moved', count: 2 },
      { key: 'unchanged', count: 1 },
    ]);
  });
});

describe('the template — the header row and nothing else', () => {
  it('is named after the branch, as the custody sheets are, so it comes back suggested', () => {
    expect(templateSheetName('المهندسين')).toBe('عهدة فرع المهندسين');
    expect(templateSheetName(null)).toBe('عهدة فرع');
    expect(templateSheetName('  ')).toBe('عهدة فرع');
    expect(templateFileName('نموذج رفع الأصول')).toBe('نموذج رفع الأصول.xlsx');
  });

  it('holds the contract’s columns in A..L of row 1, word for word, and leaves M empty', () => {
    const sheet = assetImportTemplate('عهدة فرع المهندسين');
    expect(sheet.cells.every((cell) => cell.row === 1)).toBe(true);
    expect(sheet.cells.map((cell) => cell.col)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    expect(sheet.cells.map((cell) => cell.value)).toEqual([...IT_ASSET_IMPORT_COLUMNS]);
    expect(sheet.rightToLeft).toBe(true);
  });

  it('writes a workbook whose first sheet starts at A1 — no «م» column before the header', async () => {
    const blob = buildXlsxBook([assetImportTemplate('عهدة فرع المهندسين')]);
    // A stored (uncompressed) zip: the parts are readable in the bytes as they are.
    const xml = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    expect(xml).toContain('<sheet name="عهدة فرع المهندسين"');
    expect(xml).toMatch(/<c r="A1"[^>]*><is><t xml:space="preserve">النوع<\/t>/u);
    expect(xml).toMatch(/<c r="L1"[^>]*><is><t xml:space="preserve">المشتملات<\/t>/u);
    expect(xml).not.toContain('r="M1"');
    expect(xml).not.toContain('r="A2"');
  });
});
