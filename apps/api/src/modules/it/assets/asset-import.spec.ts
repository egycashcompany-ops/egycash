// «رفع جماعي» — the asset register's bulk upload, without a database: «في الأصول عايز زرار Bulk Upload
// للأصول بنفس شكل عهدة الأفرع ويكون فى Preview الأول للى هيتضاف ويوضح لو فى تكرار أو تضارب مع
// بيانات موجوده» (2026-11-16). The sheet as it is read, what each line comes to (the go-live's
// planner, so its rules: found → fill only what is empty, in stock elsewhere → moved «يتنقل لفرع
// الملف», held elsewhere → stays), the caller's reach, the categories, the two doubts that leave a
// line unticked, the hash that ties the apply to the preview, and the apply's refusals. Over HTTP,
// against a real mongo: `tests/integration/it-assets-import.spec.ts`. Every serial and tag here is
// invented.
import { PassThrough, Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IT_ASSET_IMPORT_COLUMNS, IT_ASSET_IMPORT_DECISIONS } from '@ecms/contracts';
import {
  reduceToOneSheet,
  ZIP_MAX_ENTRIES,
  type OneSheetZipErrors,
} from '../../../shared/xlsx/one-sheet-zip';
import {
  assetImportPreview,
  editsBetween,
  importFileName,
  importRowsOf,
  importWords,
  invalidCellOf,
  invalidLineOf,
  kindCategoriesFor,
  kindsOf,
  modelWithoutMaker,
  moveCandidateIds,
  planAssetImport,
  planHashOf,
  rowsToWrite,
  suggestedBranchOf,
  type AssetImportScope,
  type ImportRegisterAsset,
  type ImportRow,
} from './asset-import-plan';
import {
  ASSET_IMPORT_SHEET_LIMITS,
  cellText,
  decodeXstring,
  fillMergedDown,
  numberText,
  parseAssetImportSheet,
  readAssetImportRows,
  readAssetImportWorkbook,
  readSlices,
  streamedCellValue,
  UTF8_BOM,
  UTF8_MAX_CONTINUATION,
  type AssetImportLine,
  type StreamedSheetRow,
} from './asset-import-sheet';

const BRANCH = 'branch-tanta';
const OTHER = 'branch-october';
const SCREEN = 'cat-screen';
const DESKTOP = 'cat-desktop';
const PHONE = 'cat-phone';

const CATEGORIES = new Map<string, string | null>([
  ['شاشة', SCREEN],
  ['كمبيوتر مكتبي', DESKTOP],
  ['هاتف IP', PHONE],
  ['جهاز غريب', null],
]);

const NO_SPECS: AssetImportLine['specs'] = {
  processor: null,
  memory: null,
  systemType: null,
  storage: null,
  displayAdapter: null,
};

const line = (row: number, over: Partial<AssetImportLine> = {}): AssetImportLine => ({
  row,
  kind: 'شاشة',
  name: 'Dell E2020H',
  serial: null,
  manufacturer: 'Dell',
  model: 'E2020H',
  tag: 'ZX9QK41',
  specs: NO_SPECS,
  accessories: [],
  ...over,
});

const asset = (over: Partial<ImportRegisterAsset> = {}): ImportRegisterAsset => ({
  id: 'asset-1',
  assetCode: 'AST-00001',
  serialNumber: 'QW7RT52',
  externalTag: null,
  branchId: BRANCH,
  status: 'inStock',
  currentAssignmentId: null,
  specs: null,
  accessories: [],
  manufacturer: 'Dell',
  model: 'E2020H',
  location: null,
  categoryId: SCREEN,
  ...over,
});

/** A caller whose every grant reaches every device, and the branch. */
const everything = (register: readonly ImportRegisterAsset[]): AssetImportScope => {
  const ids = new Set(register.map((entry) => entry.id));
  return { visible: ids, editable: ids, assignable: ids, assignReachesBranch: true };
};

const plan = (lines: AssetImportLine[], register: ImportRegisterAsset[]) =>
  planAssetImport({ lines, branchId: BRANCH, register, categories: CATEGORIES });

const rows = (
  lines: AssetImportLine[],
  register: ImportRegisterAsset[],
  scope: AssetImportScope = everything(register),
): ImportRow[] => importRowsOf(plan(lines, register), scope);

/** The one row a one-line plan makes. */
const only = (
  entry: AssetImportLine,
  register: ImportRegisterAsset[],
  scope?: AssetImportScope,
): ImportRow['dto'] => {
  const [first] = rows([entry], register, scope);
  if (first === undefined) throw new Error('no row');
  return first.dto;
};

// ── The sheet ───────────────────────────────────────────────────────────────────────────────

const workbook = async (
  data: unknown[][],
  options: { name?: string; hiddenFirst?: boolean; header?: readonly string[] } = {},
): Promise<Buffer> => {
  const book = new ExcelJS.Workbook();
  if (options.hiddenFirst === true) {
    const hidden = book.addWorksheet('ملاحظات');
    hidden.state = 'hidden';
    hidden.addRow(['لا شيء هنا']);
  }
  const sheet = book.addWorksheet(options.name ?? 'عهدة فرع طنطا');
  sheet.addRow([...(options.header ?? IT_ASSET_IMPORT_COLUMNS)]);
  for (const row of data) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
};

describe('reading the sheet — the branches’ custody sheet, word for word', () => {
  it('reads every typed line with its row number, cells as a person reads them, blank rows skipped', async () => {
    const buffer = await workbook([
      [
        'شاشة',
        'Dell E2020H',
        1234567890123456,
        'Dell',
        'Dell E2020H',
        '  CN0QK4   81 ',
        null,
        null,
        null,
        null,
        null,
        'كابل باور',
        'كابل HDMI',
      ],
      [],
      [
        { richText: [{ text: 'هاتف ' }, { text: 'IP' }] },
        { formula: '"Grand"&"stream"', result: 'Grandstream GXP1615' },
        '271FVCWQ90AB12CD',
        'Grandstream',
        'GXP1615',
        null,
        'Intel Core i5',
        '8 GB',
        'Windows 11',
        '256 GB SSD',
        'Intel UHD',
        null,
        'شاحن',
      ],
    ]);
    const sheet = await readAssetImportWorkbook(buffer);
    expect(sheet.sheetName).toBe('عهدة فرع طنطا');
    expect(sheet.lines).toEqual([
      {
        row: 2,
        kind: 'شاشة',
        name: 'Dell E2020H',
        // A long serial typed as a number reads as its digits — never «1.2e+15».
        serial: '1234567890123456',
        manufacturer: 'Dell',
        model: 'Dell E2020H',
        tag: 'CN0QK4 81',
        specs: NO_SPECS,
        accessories: ['كابل باور', 'كابل HDMI'],
      },
      {
        row: 4,
        kind: 'هاتف IP',
        name: 'Grandstream GXP1615',
        serial: '271FVCWQ90AB12CD',
        manufacturer: 'Grandstream',
        model: 'GXP1615',
        tag: null,
        specs: {
          processor: 'Intel Core i5',
          memory: '8 GB',
          systemType: 'Windows 11',
          storage: '256 GB SSD',
          displayAdapter: 'Intel UHD',
        },
        accessories: ['شاحن'],
      },
    ]);
    expect(sheet.lines[0]?.serial).not.toMatch(/e\+/u);
  });

  it('writes numbers without an exponent, and unwraps every kind of cell', () => {
    expect(numberText(1.2e15)).toBe('1200000000000000');
    expect(numberText(1e21)).toBe('1000000000000000000000');
    expect(numberText(4521)).toBe('4521');
    expect(cellText(1.2e15)).toBe('1200000000000000');
    expect(cellText({ formula: 'A1', result: 987654321012 })).toBe('987654321012');
    expect(cellText({ richText: [{ text: ' Dell ' }, { text: ' E2020H' }] })).toBe('Dell E2020H');
    expect(cellText({ text: 'رابط', hyperlink: 'https://example.invalid' })).toBe('رابط');
    expect(cellText({ error: '#N/A' })).toBeNull();
    expect(cellText('   ')).toBeNull();
    expect(cellText(null)).toBeNull();
  });

  it('decodes Excel’s _xHHHH_ escapes as Excel and ExcelJS do — left to right, an escaped _ once', () => {
    expect(decodeXstring('كيبورد_x000D_\nماوس')).toBe('كيبورد\r\nماوس');
    expect(decodeXstring('ABC123_x000d_')).toBe('ABC123\r');
    expect(decodeXstring('_x005F_x0041_')).toBe('_x0041_');
    expect(decodeXstring('_x0041_x0042_')).toBe('Ax0042_');
    expect(decodeXstring('__x0041_')).toBe('_A');
    expect(decodeXstring('_xD83D__xDE00_')).toBe('\u{1F600}');
    expect(decodeXstring('_x00_ _x00G1_ x0041_ _X0041_')).toBe('_x00_ _x00G1_ x0041_ _X0041_');
    // What the stream hands over, decoded before it is cleaned: a string, each run of rich text on
    // its own (an escape never spans two), a formula's text.
    expect(cellText(streamedCellValue('ABC123_x000D_'))).toBe('ABC123');
    expect(
      cellText(
        streamedCellValue({
          richText: [{ text: 'شاشة_x000D_' }, { font: { bold: true }, text: '\nديل' }],
        }),
      ),
    ).toBe('شاشة ديل');
    expect(cellText(streamedCellValue({ richText: [{ text: '_x00' }, { text: '41_' }] }))).toBe(
      '_x0041_',
    );
    expect(cellText(streamedCellValue({ formula: 'A1', result: 'X_x000D_Y' }))).toBe('X Y');
    // One shared string the reader caches for every cell that names it: decoded afresh each time,
    // never changed — a second cell must not read «A».
    const shared = { richText: [{ text: '_x005F_x0041_' }] };
    expect(cellText(streamedCellValue(shared))).toBe('_x0041_');
    expect(cellText(streamedCellValue(shared))).toBe('_x0041_');
    expect(streamedCellValue(42)).toBe(42);
    // `xlsx.load` hands its values decoded: `cellText` itself decodes nothing again.
    expect(cellText('_x0041_')).toBe('_x0041_');
  });

  it('compares the header folded — spacing and the Latin parts’ case aside', () => {
    const header = IT_ASSET_IMPORT_COLUMNS.map((label) =>
      label === 'سيريال (Serial)' ? '  سيريال   (SERIAL) ' : label,
    );
    const sheet = parseAssetImportSheet('Sheet1', [header, ['شاشة', 'Dell', 'QW7RT52']]);
    expect(sheet.lines).toHaveLength(1);
  });

  it('refuses a header missing, naming it — 422', async () => {
    const header = IT_ASSET_IMPORT_COLUMNS.map((label) => (label === 'الموديل' ? 'موديل' : label));
    await expect(readAssetImportWorkbook(await workbook([], { header }))).rejects.toMatchObject({
      httpStatus: 422,
      message: expect.stringContaining('«الموديل» is missing') as unknown,
    });
  });

  it('refuses a header out of place, naming where it is — 422', () => {
    const header: string[] = [...IT_ASSET_IMPORT_COLUMNS];
    [header[2], header[5]] = [header[5] ?? '', header[2] ?? ''];
    expect(() => parseAssetImportSheet('Sheet1', [header])).toThrow(
      'the header «سيريال (Serial)» is in column F — it must be in column C',
    );
  });

  it('takes 500 lines and refuses 501 — 422', () => {
    const lines = (count: number) => [
      [...IT_ASSET_IMPORT_COLUMNS],
      ...Array.from({ length: count }, (_, index) => ['شاشة', 'Dell', `SN${String(index)}`]),
    ];
    expect(parseAssetImportSheet('Sheet1', lines(500)).lines).toHaveLength(500);
    expect(() => parseAssetImportSheet('Sheet1', lines(501))).toThrow('more than 500 lines');
  });

  it('reads the first VISIBLE worksheet', async () => {
    const sheet = await readAssetImportWorkbook(
      await workbook([['شاشة', 'Dell', 'QW7RT52']], { hiddenFirst: true, name: 'عهدة فرع بنها' }),
    );
    expect(sheet.sheetName).toBe('عهدة فرع بنها');
    expect(sheet.lines.map((entry) => entry.serial)).toEqual(['QW7RT52']);
  });

  it('refuses a file that is no workbook — 422', async () => {
    await expect(readAssetImportWorkbook(Buffer.from('not a zip'))).rejects.toMatchObject({
      httpStatus: 422,
    });
  });
});

// ── Never inflated whole ───────────────────────────────────────────────────────────────────

describe('the workbook is never inflated whole — one sheet, under caps, stopped past the cap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** What a read refused with. */
  const refusalOf = async (work: Promise<unknown>): Promise<Record<string, unknown>> => {
    try {
      await work;
    } catch (error) {
      return error as Record<string, unknown>;
    }
    throw new Error('nothing was refused');
  };

  /**
   * The reader's own caps' words — never multer's `TOO_LARGE` («larger than 5 MB» on the screen),
   * which a 1 MB file whose sheet unpacks past one branch's page is not.
   */
  const LARGER_THAN_A_PAGE =
    "the workbook is larger than one branch's sheet — upload the custody sheet on its own (at most 500 lines)";

  /**
   * Spies on what would read on: ExcelJS loading the workbook WHOLE (`xlsx.load` — what the
   * reader must never do), JSZip opening the file, ExcelJS streaming the sheet. The spy calls what
   * it wraps without `new`, so the streaming reader's is built here, by hand.
   */
  const readers = () => {
    const Reader = ExcelJS.stream.xlsx.WorkbookReader;
    type ReaderArgs = ConstructorParameters<typeof Reader>;
    const xlsx = Object.getPrototypeOf(new ExcelJS.Workbook().xlsx) as {
      load: (...args: unknown[]) => Promise<unknown>;
    };
    return {
      loadedWhole: vi.spyOn(xlsx, 'load'),
      opened: vi.spyOn(JSZip, 'loadAsync'),
      streamed: vi
        .spyOn(ExcelJS.stream.xlsx, 'WorkbookReader')
        .mockImplementation(
          (...args: ReaderArgs): InstanceType<typeof Reader> => new Reader(...args),
        ),
    };
  };

  it('control: a sheet within its caps is opened and streamed — never loaded whole', async () => {
    const { loadedWhole, opened, streamed } = readers();
    const sheet = await readAssetImportWorkbook(await workbook([['شاشة', 'Dell', 'QW7RT52']]));
    expect(sheet.lines).toHaveLength(1);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(streamed).toHaveBeenCalledTimes(1);
    expect(loadedWhole).not.toHaveBeenCalled();
  });

  it('more entries than a workbook carries — 422 SHEET_TOO_LARGE before JSZip opens anything', async () => {
    const zip = new JSZip();
    for (let i = 0; i <= ZIP_MAX_ENTRIES; i += 1) zip.file(`e${String(i)}`, '');
    const upload = await zip.generateAsync({ type: 'nodebuffer' });
    const { loadedWhole, opened, streamed } = readers();
    expect(await refusalOf(readAssetImportWorkbook(upload))).toMatchObject({
      httpStatus: 422,
      message: LARGER_THAN_A_PAGE,
      details: [{ field: 'file', code: 'SHEET_TOO_LARGE', message: 'entries' }],
    });
    expect(loadedWhole).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
    expect(streamed).not.toHaveBeenCalled();
  });

  it('a sheet past its inflated cap — 422 naming the sheet, never streamed', async () => {
    const upload = await workbook(
      Array.from({ length: 50 }, (_, index) => ['شاشة', 'Dell E2020H', `QW7RT${String(index)}`]),
    );
    const { loadedWhole, streamed } = readers();
    expect(
      await refusalOf(
        readAssetImportWorkbook(upload, { ...ASSET_IMPORT_SHEET_LIMITS, sheetBytes: 1024 }),
      ),
    ).toMatchObject({
      httpStatus: 422,
      message: LARGER_THAN_A_PAGE,
      details: [{ field: 'file', code: 'SHEET_TOO_LARGE', message: 'xl/worksheets/sheet1.xml' }],
    });
    expect(loadedWhole).not.toHaveBeenCalled();
    expect(streamed).not.toHaveBeenCalled();
    // The caps themselves fit a whole page: 500 lines, every one read.
    const page = await workbook(
      Array.from({ length: 500 }, (_, index) => ['شاشة', 'Dell E2020H', `QW7RT${String(index)}`]),
    );
    expect((await readAssetImportWorkbook(page)).lines).toHaveLength(500);
  });

  it('more than 500 lines — 422, refused at the 501st and nothing after it read', async () => {
    let pulled = 0;
    const endless = async function* (): AsyncGenerator<StreamedSheetRow> {
      yield { number: 1, values: [undefined, ...IT_ASSET_IMPORT_COLUMNS] };
      for (let number = 2; ; number += 1) {
        pulled = number;
        // A blank row now and then — skipped, and not counted as a line.
        yield number % 10 === 0
          ? { number, values: [] }
          : { number, values: [undefined, 'شاشة', 'Dell', `SN${String(number)}`] };
      }
    };
    expect(await refusalOf(readAssetImportRows('Sheet1', endless()))).toMatchObject({
      httpStatus: 422,
      message: expect.stringContaining('more than 500 lines') as unknown,
    });
    // Rows 2..557 are 501 lines and 55 blank rows: row 557 is the 501st line, and the last pulled.
    expect(pulled).toBe(557);

    const over = await workbook(
      Array.from({ length: 600 }, (_, index) => ['شاشة', 'Dell', `SN${String(index)}`]),
    );
    expect(await refusalOf(readAssetImportWorkbook(over))).toMatchObject({
      httpStatus: 422,
      message: expect.stringContaining('more than 500 lines') as unknown,
    });
  });

  it('a read past its deadline — 422 SHEET_TOO_LARGE naming the time, inflating or streaming', async () => {
    const upload = await workbook([['شاشة', 'Dell', 'QW7RT52']]);
    const { streamed } = readers();
    expect(
      await refusalOf(
        readAssetImportWorkbook(upload, { ...ASSET_IMPORT_SHEET_LIMITS, timeMs: -1 }),
      ),
    ).toMatchObject({
      httpStatus: 422,
      message: LARGER_THAN_A_PAGE,
      details: [{ field: 'file', code: 'SHEET_TOO_LARGE', message: 'time' }],
    });
    expect(streamed).not.toHaveBeenCalled();
    const header = async function* (): AsyncGenerator<StreamedSheetRow> {
      yield { number: 1, values: [undefined, ...IT_ASSET_IMPORT_COLUMNS] };
    };
    expect(await refusalOf(readAssetImportRows('Sheet1', header(), Date.now() - 1))).toMatchObject({
      httpStatus: 422,
      message: LARGER_THAN_A_PAGE,
      details: [{ field: 'file', code: 'SHEET_TOO_LARGE', message: 'time' }],
    });
  });

  /**
   * What the streaming reader is fed, chunk by chunk: the source `Readable.from` is given, each
   * chunk counted as the reader pulls it. The reduced zip handed whole is ONE chunk — and ExcelJS
   * then parses the whole sheet into events before the first row, however soon the read stops.
   */
  const fedChunks = (): number[] => {
    const from = Readable.from.bind(Readable);
    const fed: number[] = [];
    vi.spyOn(Readable, 'from').mockImplementation((source, options) => {
      if (Buffer.isBuffer(source)) {
        fed.push(source.length);
        return from(source, options);
      }
      const counted = async function* (): AsyncGenerator<Buffer> {
        for await (const chunk of source as AsyncIterable<Buffer>) {
          fed.push(chunk.length);
          yield chunk;
        }
      };
      return from(counted(), options);
    });
    return fed;
  };

  const sum = (sizes: readonly number[]): number => sizes.reduce((total, size) => total + size, 0);

  /** How many bytes the reader is handed for an upload: its reduced zip. */
  const handedBytes = async (upload: Buffer): Promise<number> => {
    const errors: OneSheetZipErrors = {
      unreadable: () => new Error('unreadable'),
      tooLarge: (what) => new Error(what),
      missingSheet: () => new Error('missing'),
    };
    const reduced = await reduceToOneSheet(
      upload,
      'firstVisible',
      ASSET_IMPORT_SHEET_LIMITS,
      Number.POSITIVE_INFINITY,
      errors,
    );
    return reduced.buffer.length;
  };

  it('feeds the reader in slices — parsed as it streams, a long sheet left unread past its 501st line', async () => {
    const slice = { ...ASSET_IMPORT_SHEET_LIMITS, chunkBytes: 1024 };
    const lines = (count: number) =>
      Array.from({ length: count }, (_, index) => ['شاشة', 'Dell E2020H', `QW7RT${String(index)}`]);

    // A page: read to its end, slice after slice, none larger than a slice (and the three bytes a
    // cut may move so as not to split a character).
    const page = await workbook(lines(20));
    let fed = fedChunks();
    expect((await readAssetImportWorkbook(page, slice)).lines).toHaveLength(20);
    expect(fed.length).toBeGreaterThan(1);
    expect(Math.max(...fed)).toBeLessThanOrEqual(1024 + UTF8_MAX_CONTINUATION);
    expect(sum(fed)).toBe(await handedBytes(page));
    vi.restoreAllMocks();

    // 5 000 lines: refused at the 501st having pulled well under half of what it was handed — the
    // rest never parsed.
    const long = await workbook(lines(5000));
    fed = fedChunks();
    expect(await refusalOf(readAssetImportWorkbook(long, slice))).toMatchObject({
      httpStatus: 422,
      message: expect.stringContaining('more than 500 lines') as unknown,
    });
    expect(fed.length).toBeGreaterThan(1);
    expect(sum(fed)).toBeLessThan((await handedBytes(long)) / 2);
    vi.restoreAllMocks();

    // Production's slices: 64 KB.
    expect(ASSET_IMPORT_SHEET_LIMITS.chunkBytes).toBe(64 * 1024);
    fed = fedChunks();
    await refusalOf(readAssetImportWorkbook(long));
    expect(fed.length).toBeGreaterThan(1);
    expect(Math.max(...fed)).toBeLessThanOrEqual(64 * 1024 + UTF8_MAX_CONTINUATION);
  });

  it('a slice is a view of the buffer, never a copy', () => {
    const buffer = Buffer.from('0123456789');
    const slices = [...readSlices(buffer, 4)];
    expect(slices.map((part) => part.toString())).toEqual(['0123', '4567', '89']);
    expect(slices.every((part) => part.buffer === buffer.buffer)).toBe(true);
    expect([...readSlices(Buffer.alloc(0), 4)]).toEqual([]);
  });
});

// ── No slice splits a character ────────────────────────────────────────────────────────────

/**
 * ExcelJS's `parse-sax` decodes every piece it is handed ON ITS OWN (`textDecoder.decode(chunk)`,
 * no `{stream: true}`), and unzipper hands the XML on in pieces that end where the slices end: a
 * cut inside a two-byte Arabic letter became two U+FFFD, written to the register — «ما��س ديل …»
 * on 8 of 17 realistic pages (2026-11-16); a cut just before a U+FEFF lost it, the decoder taking
 * it for a byte-order mark («معالجإنتل»). What is read must be EXACTLY what `xlsx.load` reads —
 * or, where `xlsx.load` itself is wrong, what Excel shows: its `_xHHHH_` escapes decoded, inline
 * rich text read whole.
 */
describe('no slice splits a character — the text read is the text typed', () => {
  /** A seeded generator (mulberry32), so a failure replays. */
  const seeded = (seed: number): (() => number) => {
    let state = seed;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), state | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /**
   * Characters of every UTF-8 length: ASCII, Arabic letters, Arabic presentation forms, symbols —
   * and U+FEFF, which a decoder drops from the start of what it decodes.
   */
  const RANGES: readonly (readonly [number, number])[] = [
    [0x20, 0x7e],
    [0x0621, 0x064a],
    [0xfe70, 0xfefc],
    [0x1f300, 0x1f5ff],
    [0xfeff, 0xfeff],
  ];

  const randomText = (random: () => number, length: number): string =>
    Array.from({ length }, () => {
      const [from, to] = RANGES[Math.floor(random() * RANGES.length)] ?? [0x20, 0x20];
      return String.fromCodePoint(from + Math.floor(random() * (to - from + 1)));
    }).join('');

  const isContinuation = (byte: number | undefined): boolean => ((byte ?? 0) & 0xc0) === 0x80;

  const startsWithBom = (bytes: Buffer): boolean =>
    bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM);

  /** The slice without the U+FEFF it ends with — what may not pass `size + 3`. */
  const withoutTrailingBoms = (slice: Buffer): number => {
    let length = slice.length;
    while (length >= 3 && slice.subarray(length - 3, length).equals(UTF8_BOM)) length -= 3;
    return length;
  };

  /**
   * Each piece decoded on its own, as `parse-sax` decodes what it is handed — a U+FEFF at the
   * start of one dropped, as the decoder drops a byte-order mark.
   */
  const decodedApart = (pieces: readonly Buffer[]): string =>
    pieces.map((piece) => new TextDecoder().decode(piece)).join('');

  it('cuts only between characters, never before a U+FEFF — random UTF-8, every slice size from 1 to 64', () => {
    const random = seeded(20261116);
    const failures: string[] = [];
    let cases = 0;
    let bomsAtACut = 0;
    for (let sample = 0; sample < 100; sample += 1) {
      const text = randomText(random, Math.floor(random() * 160));
      const buffer = Buffer.from(text, 'utf8');
      // The text decoded whole: a U+FEFF that starts the text is a byte-order mark to it too.
      const whole = new TextDecoder().decode(buffer);
      for (let size = 1; size <= 64; size += 1) {
        cases += 1;
        const slices = [...readSlices(buffer, size)];
        bomsAtACut += slices.filter((slice) => withoutTrailingBoms(slice) < slice.length).length;
        const problems = [
          Buffer.concat(slices).equals(buffer) ? null : 'not the buffer, in order',
          slices.every((slice) => slice.length > 0) ? null : 'an empty slice',
          slices.every((slice) => withoutTrailingBoms(slice) <= size + UTF8_MAX_CONTINUATION)
            ? null
            : 'a slice past size + 3, U+FEFF aside',
          // A cut never falls before a continuation byte: no slice but the first starts with one.
          slices.slice(1).some((slice) => isContinuation(slice[0]))
            ? 'a slice starting inside a character'
            : null,
          // …nor before a U+FEFF: a BOM ends a slice, never starts one.
          slices.slice(1).some(startsWithBom) ? 'a slice starting with U+FEFF' : null,
          decodedApart(slices) === whole ? null : 'decoded apart, not the text',
        ].filter((problem): problem is string => problem !== null);
        if (problems.length > 0) {
          failures.push(`sample ${String(sample)}, size ${String(size)}: ${problems.join(', ')}`);
        }
      }
    }
    expect(cases).toBe(6400);
    expect(failures.slice(0, 5)).toEqual([]);
    // The ranges mean something: many a cut landed before a U+FEFF and moved past it.
    expect(bomsAtACut).toBeGreaterThan(100);
  });

  it('moves a cut past a U+FEFF, and past the ones right after it — they end the slice', () => {
    const bom = UTF8_BOM.toString('utf8');
    // «ab», three U+FEFF, «cd»: the cut at 3 falls inside the first, moves to its end, then past
    // the other two.
    const buffer = Buffer.from(`ab${bom}${bom}${bom}cd`, 'utf8');
    const slices = [...readSlices(buffer, 3)];
    expect(slices.map((slice) => slice.length)).toEqual([11, 2]);
    expect(decodedApart(slices)).toBe(`ab${bom}${bom}${bom}cd`);
    // A cut right before one: «معالج» is ten bytes.
    const word = Buffer.from(`معالج${bom}إنتل`, 'utf8');
    expect([...readSlices(word, 10)].map((slice) => slice.toString('utf8'))).toEqual([
      `معالج${bom}`,
      'إنتل',
    ]);
    expect(decodedApart([...readSlices(word, 10)])).toBe(`معالج${bom}إنتل`);
    // Without the move, the second piece would start with it, and the decoder drop it.
    expect(decodedApart([word.subarray(0, 10), word.subarray(10)])).toBe('معالجإنتل');
  });

  it('moves a cut at most three bytes — bytes that are no UTF-8 (the zip’s headers) stay bounded', () => {
    const random = seeded(7);
    for (let sample = 0; sample < 50; sample += 1) {
      const buffer = Buffer.from(
        Array.from({ length: Math.floor(random() * 300) }, () => Math.floor(random() * 256)),
      );
      for (const size of [1, 2, 5, 64]) {
        const slices = [...readSlices(buffer, size)];
        expect(Buffer.concat(slices).equals(buffer)).toBe(true);
        expect(slices.every((slice) => slice.length > 0)).toBe(true);
        expect(
          slices.every((slice) => withoutTrailingBoms(slice) <= size + UTF8_MAX_CONTINUATION),
        ).toBe(true);
      }
    }
    // A crafted run of continuation bytes cannot stretch one slice over itself.
    expect([...readSlices(Buffer.alloc(20, 0x80), 4)].map((slice) => slice.length)).toEqual([
      7, 7, 6,
    ]);
  });

  // ── Whole workbooks, against `xlsx.load` ──

  const errors: OneSheetZipErrors = {
    unreadable: () => new Error('unreadable'),
    tooLarge: (what) => new Error(what),
    missingSheet: () => new Error('missing'),
  };

  /** The zip the reader is handed — the one the slices cut. */
  const reducedOf = async (upload: Buffer): Promise<Buffer> =>
    (
      await reduceToOneSheet(
        upload,
        'firstVisible',
        ASSET_IMPORT_SHEET_LIMITS,
        Number.POSITIVE_INFINITY,
        errors,
      )
    ).buffer;

  /** Where a part's bytes sit in a STORE zip: [start, end) of its data, from the local headers. */
  const partRange = (zip: Buffer, name: string): readonly [number, number] => {
    for (let at = 0; zip.readUInt32LE(at) === 0x04034b50;) {
      const size = zip.readUInt32LE(at + 18);
      const nameLength = zip.readUInt16LE(at + 26);
      const data = at + 30 + nameLength + zip.readUInt16LE(at + 28);
      if (zip.toString('utf8', at + 30, at + 30 + nameLength) === name) return [data, data + size];
      at = data + size;
    }
    throw new Error(`no ${name} in the zip`);
  };

  /** How many production cuts (every 64 KB) of the reduced zip fall inside a letter of `part`. */
  const cutsInsideALetter = (zip: Buffer, part: string): number => {
    const [start, end] = partRange(zip, part);
    let inside = 0;
    for (
      let cut = ASSET_IMPORT_SHEET_LIMITS.chunkBytes;
      cut < end;
      cut += ASSET_IMPORT_SHEET_LIMITS.chunkBytes
    ) {
      if (cut > start && isContinuation(zip[cut])) inside += 1;
    }
    return inside;
  };

  /** The lines `xlsx.load` reads — the whole-workbook reader the streaming one must agree with. */
  const loadedLines = async (upload: Buffer): Promise<AssetImportLine[]> => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(upload as unknown as ArrayBuffer);
    const [sheet] = book.worksheets;
    if (sheet === undefined) throw new Error('no worksheet');
    const grid = Array.from({ length: sheet.rowCount }, (_, index) => {
      const values = sheet.getRow(index + 1).values;
      return Array.isArray(values) ? values.slice(1) : [];
    });
    return parseAssetImportSheet(sheet.name, grid).lines;
  };

  const KINDS = ['شاشة', 'لاب توب', 'طابعة', 'كمبيوتر مكتبي', 'ماوس', 'كيبورد', 'سكانر'];
  const HOLDERS = ['وليد صفوت جلال', 'شريف ممدوح فاروق', 'سامح نبيل'];

  /**
   * A branch's line as it is typed: Arabic in every text column (serials and tags invented).
   * `pad` — zeros before the office number, to move every byte after it.
   */
  const arabicLine = (index: number, pad = ''): unknown[] => {
    const kind = KINDS[index % KINDS.length] ?? 'شاشة';
    const holder = HOLDERS[index % HOLDERS.length] ?? 'سامح نبيل';
    return [
      kind,
      `${kind} ديل — عهدة ${holder} — مكتب ${pad}${String(index)}`,
      `QW${String(index)}RT`,
      'Dell',
      'E2020H',
      `ZX${String(index)}K`,
      `معالج إنتل كور آي ${String(index % 9)} الجيل ${String(index % 13)}`,
      `${String(index % 32)} جيجا`,
      'نظام تشغيل ويندوز ٦٤ بت',
      `${String(index % 7)} تيرا`,
      'كارت شاشة مدمج',
      `كابل باور رقم ${String(index)}`,
      null,
    ];
  };

  /**
   * The same workbook with every text written INLINE in the sheet (`t="inlineStr"`, as the fuel
   * companies' sheets come) — no shared-strings part at all.
   */
  const inlined = async (upload: Buffer): Promise<Buffer> => {
    const zip = await JSZip.loadAsync(upload);
    const part = async (name: string): Promise<string> => {
      const file = zip.file(name);
      if (file === null) throw new Error(`no ${name}`);
      return file.async('string');
    };
    const strings = [...(await part('xl/sharedStrings.xml')).matchAll(/<si>(.*?)<\/si>/gsu)].map(
      (match) => (match[1] ?? '').replace(/<\/?t\b[^>]*>/gu, ''),
    );
    const sheet = await part('xl/worksheets/sheet1.xml');
    zip.file(
      'xl/worksheets/sheet1.xml',
      sheet.replace(
        /<c ([^>]*?)t="s"([^>]*)><v>(\d+)<\/v><\/c>/gu,
        (_cell, before: string, after: string, index: string) =>
          `<c ${before}t="inlineStr"${after}><is><t>${strings[Number(index)] ?? ''}</t></is></c>`,
      ),
    );
    zip.remove('xl/sharedStrings.xml');
    zip.file(
      '[Content_Types].xml',
      (await part('[Content_Types].xml')).replace(/<Override[^>]*sharedStrings[^>]*\/>/u, ''),
    );
    zip.file(
      'xl/_rels/workbook.xml.rels',
      (await part('xl/_rels/workbook.xml.rels')).replace(
        /<Relationship[^>]*sharedStrings[^>]*\/>/u,
        '',
      ),
    );
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  };

  /**
   * A page of `count` Arabic lines whose 64 KB cut falls inside a letter of the part that carries
   * its text — the shared strings, or (inline) the sheet. The first line's office number is padded
   * a zero at a time until it does.
   */
  const pageCutInsideALetter = async (
    count: number,
    strings: 'shared' | 'inline',
  ): Promise<Buffer> => {
    const part = strings === 'shared' ? 'xl/sharedStrings.xml' : 'xl/worksheets/sheet1.xml';
    for (let pad = 0; pad < 16; pad += 1) {
      const shared = await workbook(
        Array.from({ length: count }, (_, index) =>
          arabicLine(index, index === 0 ? '0'.repeat(pad) : ''),
        ),
      );
      const upload = strings === 'shared' ? shared : await inlined(shared);
      if (cutsInsideALetter(await reducedOf(upload), part) > 0) return upload;
    }
    throw new Error('no page put a 64 KB cut inside a letter');
  };

  /** Every cell's text, read in slices of `chunkBytes`. */
  const streamedLines = async (upload: Buffer, chunkBytes: number): Promise<AssetImportLine[]> =>
    (await readAssetImportWorkbook(upload, { ...ASSET_IMPORT_SHEET_LIMITS, chunkBytes })).lines;

  it.each(['shared', 'inline'] as const)(
    'reads %s strings exactly as `xlsx.load` does — 1 KB slices, and 64 KB cut inside a letter',
    async (strings) => {
      const upload = await pageCutInsideALetter(400, strings);
      if (strings === 'inline') {
        expect((await JSZip.loadAsync(upload)).file('xl/sharedStrings.xml')).toBeNull();
      }
      const expected = await loadedLines(upload);
      expect(expected).toHaveLength(400);
      expect(expected.some((entry) => entry.name?.includes('عهدة وليد صفوت جلال'))).toBe(true);
      for (const chunkBytes of [1024, ASSET_IMPORT_SHEET_LIMITS.chunkBytes]) {
        const lines = await streamedLines(upload, chunkBytes);
        expect(JSON.stringify(lines)).not.toContain('�');
        expect(lines).toEqual(expected);
      }
    },
  );

  it('the reviewer’s sweep — 100 to 500 lines, production slices: every page exact', async () => {
    let cutInsideALetter = 0;
    for (let count = 100; count <= 500; count += 25) {
      // Pages that only grow share their first 64 KB — one cut, tested 17 times. A zero more
      // before the first office number on each page (four in turn) moves the cut a byte.
      const pad = '0'.repeat((count / 25) % 4);
      const upload = await workbook(
        Array.from({ length: count }, (_, index) => arabicLine(index, index === 0 ? pad : '')),
      );
      const zip = await reducedOf(upload);
      cutInsideALetter +=
        cutsInsideALetter(zip, 'xl/sharedStrings.xml') +
        cutsInsideALetter(zip, 'xl/worksheets/sheet1.xml');
      expect(await streamedLines(upload, ASSET_IMPORT_SHEET_LIMITS.chunkBytes)).toEqual(
        await loadedLines(upload),
      );
    }
    // The sweep means something: some page's 64 KB cut falls inside a letter.
    expect(cutInsideALetter).toBeGreaterThan(0);
  });

  // ── U+FEFF at a production cut ──

  /** A U+FEFF for every space of a line's text — where one was lost, two words read as one. */
  const withBoms = (cells: unknown[]): unknown[] =>
    cells.map((cell) => (typeof cell === 'string' ? cell.replace(/ /gu, '\uFEFF') : cell));

  /**
   * How many cuts of `part` fell right before a U+FEFF when a cut stepped past continuation bytes
   * only — 64 KB slices of the reduced zip, cut by the rule before this one.
   */
  const continuationOnlyCutsBeforeABom = (zip: Buffer, part: string): number => {
    const [start, end] = partRange(zip, part);
    let found = 0;
    for (let at = 0; at < zip.length;) {
      let cut = Math.min(at + ASSET_IMPORT_SHEET_LIMITS.chunkBytes, zip.length);
      for (let moved = 0; moved < UTF8_MAX_CONTINUATION && isContinuation(zip[cut]); moved += 1) {
        cut += 1;
      }
      if (cut > start && cut < end && startsWithBom(zip.subarray(cut))) found += 1;
      at = cut;
    }
    return found;
  };

  /**
   * The reviewer's `feff-sst.xlsx` and `feff-inline.xlsx`, made here: a page of `count` lines with
   * U+FEFF between their words, whose 64 KB cut fell right before one in the part that carries the
   * text. The first line's office number is padded a zero at a time until it does.
   */
  const pageCutBeforeABom = async (
    count: number,
    strings: 'shared' | 'inline',
  ): Promise<Buffer> => {
    const part = strings === 'shared' ? 'xl/sharedStrings.xml' : 'xl/worksheets/sheet1.xml';
    for (let pad = 0; pad < 64; pad += 1) {
      const shared = await workbook(
        Array.from({ length: count }, (_, index) =>
          withBoms(arabicLine(index, index === 0 ? '0'.repeat(pad) : '')),
        ),
      );
      const upload = strings === 'shared' ? shared : await inlined(shared);
      if (continuationOnlyCutsBeforeABom(await reducedOf(upload), part) > 0) return upload;
    }
    throw new Error('no page put a 64 KB cut before a U+FEFF');
  };

  it.each(['shared', 'inline'] as const)(
    'reads %s strings with U+FEFF exactly as `xlsx.load` does — a 64 KB cut right before one',
    async (strings) => {
      const upload = await pageCutBeforeABom(400, strings);
      const expected = await loadedLines(upload);
      expect(expected).toHaveLength(400);
      // U+FEFF is whitespace to a cell's cleaning: the words read apart, never «معالجإنتل».
      expect(expected[0]?.specs.processor).toBe('معالج إنتل كور آي 0 الجيل 0');
      expect(await streamedLines(upload, ASSET_IMPORT_SHEET_LIMITS.chunkBytes)).toEqual(expected);
    },
  );

  // ── Excel's escapes ──

  /** The workbook with one part's XML edited — Excel's spellings, which ExcelJS's writer never writes. */
  const patched = async (
    upload: Buffer,
    part: string,
    edit: (xml: string) => string,
  ): Promise<Buffer> => {
    const zip = await JSZip.loadAsync(upload);
    const file = zip.file(part);
    if (file === null) throw new Error(`no ${part}`);
    zip.file(part, edit(await file.async('string')));
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  };

  /** One line whose name, serial and first accessory are markers, to be spelt as Excel spells them. */
  const markedLine = [
    'شاشة',
    'NAME-MARK',
    'SERIAL-MARK',
    'Dell',
    'E2020H',
    'ZX9QK41',
    null,
    null,
    null,
    null,
    null,
    'ACCESSORY-MARK',
  ];

  it('decodes a shared string’s _x000D_ — the carriage return Excel stores so, as `xlsx.load` does', async () => {
    const upload = await patched(await workbook([markedLine]), 'xl/sharedStrings.xml', (xml) =>
      xml
        .replace('NAME-MARK', 'شاشة ديل_x000D_\nالدور الثاني')
        .replace('SERIAL-MARK', 'QW7RT52_x000D_')
        .replace('ACCESSORY-MARK', 'كيبورد_x000D_\nماوس'),
    );
    const lines = await streamedLines(upload, ASSET_IMPORT_SHEET_LIMITS.chunkBytes);
    expect(lines[0]).toMatchObject({
      name: 'شاشة ديل الدور الثاني',
      // The serial a device of the register carries — never «QW7RT52_x000D_», matching none.
      serial: 'QW7RT52',
      accessories: ['كيبورد ماوس'],
    });
    expect(lines).toEqual(await loadedLines(upload));
  });

  it('reads an escaped underscore once — a typed «_x0041_», stored _x005F_x0041_, stays «_x0041_»', async () => {
    const upload = await patched(await workbook([markedLine]), 'xl/sharedStrings.xml', (xml) =>
      xml.replace('NAME-MARK', 'جهاز_x005F_x0041_').replace('SERIAL-MARK', 'QW_x005F_7RT52'),
    );
    const lines = await streamedLines(upload, ASSET_IMPORT_SHEET_LIMITS.chunkBytes);
    expect(lines[0]).toMatchObject({ name: 'جهاز_x0041_', serial: 'QW_7RT52' });
    expect(lines).toEqual(await loadedLines(upload));
  });

  it('decodes an inline string’s escapes too — Excel does, though `xlsx.load` leaves them there', async () => {
    const upload = await patched(
      await inlined(await workbook([markedLine])),
      'xl/worksheets/sheet1.xml',
      (xml) =>
        xml
          .replace('NAME-MARK', 'شاشة_x000D_\nديل')
          .replace('SERIAL-MARK', 'QW7RT52_x000d_')
          .replace('ACCESSORY-MARK', 'كيبورد_x005F_x000D_ماوس'),
    );
    const lines = await streamedLines(upload, ASSET_IMPORT_SHEET_LIMITS.chunkBytes);
    expect(lines[0]).toMatchObject({
      name: 'شاشة ديل',
      serial: 'QW7RT52',
      accessories: ['كيبورد_x000D_ماوس'],
    });
    // `xlsx.load` decodes a shared string's escapes, never an inline `<t>`'s — wrong there.
    expect((await loadedLines(upload))[0]?.name).toBe('شاشة_x000D_ ديل');
  });

  // ── Inline rich text ──

  it('reads inline rich text whole — the reviewer’s rich-inline.xlsx, ExcelJS’s streaming writer’s', async () => {
    const sink = new PassThrough();
    const written: Buffer[] = [];
    sink.on('data', (chunk: Buffer) => written.push(chunk));
    const book = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: sink });
    const sheet = book.addWorksheet('عهدة فرع طنطا');
    sheet.addRow([...IT_ASSET_IMPORT_COLUMNS]).commit();
    sheet
      .addRow([
        'شاشة',
        { richText: [{ text: 'شاشة ديل ' }, { font: { bold: true }, text: 'E2020H' }] },
        'QW1RT',
        'Dell',
        'E2020H',
        'ZX1K',
        null,
        null,
        null,
        null,
        null,
        { richText: [{ text: 'كابل باور ' }, { font: { italic: true }, text: 'و HDMI' }] },
      ])
      .commit();
    sheet.commit();
    await book.commit();
    const upload = Buffer.concat(written);
    const zip = await JSZip.loadAsync(upload);
    // Inline, as runs: no shared strings at all.
    expect(zip.file('xl/sharedStrings.xml')).toBeNull();
    expect(await zip.file('xl/worksheets/sheet1.xml')?.async('string')).toContain('<is><r>');
    const lines = await streamedLines(upload, ASSET_IMPORT_SHEET_LIMITS.chunkBytes);
    expect(lines[0]).toMatchObject({ name: 'شاشة ديل E2020H', accessories: ['كابل باور و HDMI'] });
    expect(lines).toEqual(await loadedLines(upload));
  });

  it('reads generated inline runs as `xlsx.load` does — spacing, entities, escapes run by run', async () => {
    const runs: Record<string, string> = {
      // Laid out over lines, a run's own space unmarked by xml:space.
      'NAME-MARK':
        '\n  <r><t>شاشة </t></r>\n  <r><rPr><b/><rFont val="Arial"/></rPr><t>ديل</t></r>\n',
      // Escaped entities, as written.
      'SERIAL-MARK': '<r><t>QW&amp;</t></r><r><rPr><i/></rPr><t>&lt;7RT52&gt;</t></r>',
      // An escape whole in one run, and an empty run.
      'ACCESSORY-MARK':
        '<r><t>كابل_x000D_</t></r><r><t/></r><r><t xml:space="preserve">\nباور</t></r>',
    };
    const upload = await patched(
      await inlined(await workbook([markedLine])),
      'xl/worksheets/sheet1.xml',
      (xml) =>
        Object.entries(runs).reduce(
          (sheet, [marker, content]) =>
            sheet.replace(`<is><t>${marker}</t></is>`, `<is>${content}</is>`),
          xml,
        ),
    );
    expect(
      await (await JSZip.loadAsync(upload)).file('xl/worksheets/sheet1.xml')?.async('string'),
    ).toContain('<rFont val="Arial"/>');
    const lines = await streamedLines(upload, ASSET_IMPORT_SHEET_LIMITS.chunkBytes);
    expect(lines[0]).toMatchObject({
      name: 'شاشة ديل',
      serial: 'QW&<7RT52>',
      accessories: ['كابل باور'],
    });
    expect(lines).toEqual(await loadedLines(upload));
  });

  it('never lets one run finish another’s escape — «_x00» then «41_» is «_x0041_», as Excel shows', async () => {
    const upload = await patched(
      await inlined(await workbook([markedLine])),
      'xl/worksheets/sheet1.xml',
      (xml) =>
        xml
          .replace('<is><t>NAME-MARK</t></is>', '<is><r><t>جهاز_x00</t></r><r><t>41_</t></r></is>')
          .replace(
            '<is><t>SERIAL-MARK</t></is>',
            '<is><r><t>QW7RT52_</t></r><r><t>x0041_</t></r></is>',
          ),
    );
    const lines = await streamedLines(upload, ASSET_IMPORT_SHEET_LIMITS.chunkBytes);
    expect(lines[0]).toMatchObject({ name: 'جهاز_x0041_', serial: 'QW7RT52_x0041_' });
    expect(lines).toEqual(await loadedLines(upload));
  });
});

describe('merged cells — a «النوع» merged down a block is every line\u2019s kind', () => {
  const merged = async (merges: string[]): Promise<Buffer> => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('عهدة فرع طنطا');
    sheet.addRow([...IT_ASSET_IMPORT_COLUMNS]);
    sheet.addRow([
      'شاشة',
      'Dell E2423H',
      null,
      'Dell',
      null,
      'MRG0001',
      null,
      null,
      null,
      null,
      null,
      'كابل HDMI',
    ]);
    sheet.addRow([null, 'Dell E2423H', null, 'Dell', null, 'MRG0002']);
    sheet.addRow([null, 'Dell E2020H', null, 'Dell', null, 'MRG0003']);
    sheet.addRow([
      'كمبيوتر مكتبي',
      'Dell OptiPlex 7090',
      null,
      'Dell',
      null,
      'MRG0004',
      null,
      null,
      null,
      null,
      null,
      'Keyboard',
    ]);
    for (const range of merges) sheet.mergeCells(range);
    return Buffer.from(await book.xlsx.writeBuffer());
  };

  it('fills a merged kind down its column, as Excel shows it and `xlsx.load` reads it', async () => {
    const upload = await merged(['A2:A4']);
    const { lines } = await readAssetImportWorkbook(upload);
    expect(lines.map((line) => [line.row, line.kind])).toEqual([
      [2, 'شاشة'],
      [3, 'شاشة'],
      [4, 'شاشة'],
      [5, 'كمبيوتر مكتبي'],
    ]);
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(upload as unknown as ArrayBuffer);
    expect(loaded.worksheets[0]?.getCell('A4').value).toBe('شاشة');
  });

  it('never across: a value merged over the two accessories columns is one accessory', async () => {
    const { lines } = await readAssetImportWorkbook(await merged(['L2:M2', 'L5:M5']));
    expect(lines.find((line) => line.row === 2)?.accessories).toEqual(['كابل HDMI']);
    expect(lines.find((line) => line.row === 5)?.accessories).toEqual(['Keyboard']);
  });

  it('leaves the header\u2019s own merge alone — «المشتملات» over L and M', async () => {
    const { lines } = await readAssetImportWorkbook(await merged(['L1:M1', 'A2:A3']));
    expect(lines.map((line) => line.kind)).toEqual(['شاشة', 'شاشة', null, 'كمبيوتر مكتبي']);
  });

  it('keeps a value a merged cell holds of its own, and gives nothing to rows never read', () => {
    const rows = [
      { row: 1, cells: ['النوع'] },
      { row: 2, cells: ['شاشة', 'a'] },
      { row: 3, cells: ['طابعة', 'b'] },
      { row: 5, cells: [null, 'c'] },
    ];
    const filled = fillMergedDown(rows, ['A2:A5', 'Z2:Z9', 'A7:A9', 'B2']);
    expect(filled.map((entry) => entry.cells[0])).toEqual(['النوع', 'شاشة', 'طابعة', 'شاشة']);
    expect(rows[3]?.cells[0]).toBeNull();
    expect(fillMergedDown(rows, [])).toEqual(rows);
  });
});

// ── What each line comes to ────────────────────────────────────────────────────────────────

describe('what each line comes to — the go-live’s rules', () => {
  it('a device the register does not hold is new: the tag its serial number, the serial its printed tag', () => {
    const dto = only(line(2, { serial: 'CN0ABC123', tag: 'ZX9QK41' }), [asset()]);
    expect(dto).toMatchObject({
      decision: 'new',
      serialNumber: 'ZX9QK41',
      externalTag: 'CN0ABC123',
      categoryId: SCREEN,
      asset: null,
      warnings: [],
      selectable: true,
      selected: true,
    });
  });

  it('files a new device’s model without a leading copy of its maker', () => {
    expect(modelWithoutMaker('Dell OptiPlex 7090', 'Dell')).toBe('OptiPlex 7090');
    expect(modelWithoutMaker('dell  OptiPlex 7090'.replace(/\s+/gu, ' '), 'Dell')).toBe(
      'OptiPlex 7090',
    );
    expect(modelWithoutMaker('OptiPlex 7090', 'Dell')).toBe('OptiPlex 7090');
    expect(modelWithoutMaker('Dell', 'Dell')).toBe('Dell');
    expect(modelWithoutMaker(null, 'Dell')).toBeNull();
    const [entry] = plan([line(2, { model: 'Dell E2020H' })], []).entries;
    expect(entry?.outcome === 'planned' && entry.decision.row.model).toBe('E2020H');
  });

  it('a kind with no category is unknownKind — not writable until one is chosen', () => {
    const dto = only(line(2, { kind: 'جهاز غريب' }), []);
    expect(dto).toMatchObject({
      decision: 'unknownKind',
      categoryId: null,
      serialNumber: 'ZX9QK41',
      selectable: false,
      selected: false,
    });
  });

  it('a new line with no name, no kind, or a value past the register’s limit is invalid', () => {
    expect(only(line(2, { name: null }), [])).toMatchObject({
      decision: 'invalid',
      message: expect.stringContaining('column B') as unknown,
      selectable: false,
    });
    expect(only(line(2, { kind: null }), [])).toMatchObject({
      decision: 'invalid',
      message: expect.stringContaining('column A') as unknown,
    });
    const long = only(line(2, { serial: 'X'.repeat(121) }), []);
    expect(long).toMatchObject({ decision: 'invalid', selectable: false });
    expect(long.message).toContain('column C');
    expect(invalidCellOf(line(2, { accessories: ['ك'.repeat(201)] }))).toContain('200');
    expect(invalidCellOf(line(2))).toBeNull();
    expect(invalidLineOf(line(2))).toBeNull();
  });

  it('a line that cannot be written never takes a device from a later line — decided before planning', () => {
    // Row 2 names no device; row 3 is the same tag, whole: row 3 is the new device, and tickable.
    const result = rows([line(2, { name: null }), line(3)], []).map((row) => row.dto);
    expect(result.map((row) => [row.row, row.decision, row.selectable, row.firstRow])).toEqual([
      [2, 'invalid', false, null],
      [3, 'new', true, null],
    ]);
    expect(result[1]).toMatchObject({ serialNumber: 'ZX9QK41', selected: true });
    // No kind on a line for a device the register holds: invalid, and the next line fills it.
    const found = rows(
      [
        line(2, { kind: null, tag: 'QW7RT52', accessories: ['ماوس'] }),
        line(3, { tag: 'QW7RT52', accessories: ['ماوس'] }),
      ],
      [asset()],
    ).map((row) => [row.dto.row, row.dto.decision]);
    expect(found).toEqual([
      [2, 'invalid'],
      [3, 'fill'],
    ]);
    // Nor does it ask the planner anything: the plan holds no decision for it.
    const [entry] = plan([line(2, { name: null })], []).entries;
    expect(entry?.outcome).toBe('invalid');
  });

  it('a line with neither serial nor tag — «لو مفيش تاجات فخلاص متضيفهمش»', () => {
    expect(only(line(2, { serial: null, tag: null }), [])).toMatchObject({
      decision: 'noIdentifier',
      selectable: false,
    });
  });

  it('a device of the branch fills only what it lacks — a typed value kept and reported', () => {
    const dto = only(
      line(2, {
        tag: 'qw7rt52',
        specs: { ...NO_SPECS, processor: 'Intel Core i7', memory: '16 GB' },
      }),
      [asset({ specs: { processor: 'Intel Core i5' } })],
    );
    expect(dto).toMatchObject({
      decision: 'fill',
      asset: { id: 'asset-1', assetCode: 'AST-00001', branchId: BRANCH, status: 'inStock' },
      fills: ['specs.memory'],
      kept: [{ field: 'specs.processor', register: 'Intel Core i5', sheet: 'Intel Core i7' }],
      fromBranchId: null,
      selectable: true,
      selected: true,
    });
  });

  it('a device of the branch with nothing to fill is complete — nothing to write', () => {
    expect(only(line(2, { tag: 'QW7RT52' }), [asset()])).toMatchObject({
      decision: 'complete',
      asset: { assetCode: 'AST-00001' },
      selectable: false,
    });
  });

  it('finds an October all-in-one by its barcode’s «S» twin', () => {
    const dto = only(line(2, { kind: 'كمبيوتر مكتبي', serial: 'MP30ABC1', tag: null }), [
      asset({ serialNumber: 'SMP30ABC1', categoryId: DESKTOP }),
    ]);
    expect(dto).toMatchObject({ decision: 'complete', asset: { assetCode: 'AST-00001' } });
  });

  it('in stock in another branch: moved to the chosen one — «يتنقل لفرع الملف»', () => {
    const dto = only(line(2, { tag: 'QW7RT52' }), [
      asset({ branchId: OTHER, location: 'مخزن IT' }),
    ]);
    expect(dto).toMatchObject({
      decision: 'move',
      fromBranchId: OTHER,
      asset: { branchId: OTHER },
      selectable: true,
      selected: true,
    });
  });

  it('held in another branch: stays, filled when it lacks something — nothing to write otherwise', () => {
    const held = asset({ branchId: OTHER, status: 'assigned', currentAssignmentId: 'interval-1' });
    expect(only(line(2, { tag: 'QW7RT52', accessories: ['كابل باور'] }), [held])).toMatchObject({
      decision: 'heldElsewhere',
      fromBranchId: OTHER,
      fills: ['accessories'],
      selectable: true,
    });
    expect(only(line(2, { tag: 'QW7RT52' }), [held])).toMatchObject({
      decision: 'heldElsewhere',
      fills: [],
      selectable: false,
      selected: false,
    });
  });

  it('under an open maintenance order in another branch: never moved — held elsewhere, still filled', () => {
    // Opening an order leaves it in stock: only the order says the technician has it.
    const ordered = asset({ branchId: OTHER, location: 'مخزن IT' });
    const lines = [line(2, { tag: 'QW7RT52', accessories: ['كابل باور'] })];
    const unaware = plan(lines, [ordered]);
    // The devices the plan would move — the ones asked about.
    expect(moveCandidateIds(unaware)).toEqual(['asset-1']);
    const held = planAssetImport({
      lines,
      branchId: BRANCH,
      register: [ordered],
      categories: CATEGORIES,
      maintained: new Set(['asset-1']),
    });
    expect(moveCandidateIds(held)).toEqual([]);
    const [heldRow] = importRowsOf(held, everything([ordered]));
    expect(heldRow?.dto).toMatchObject({
      decision: 'heldElsewhere',
      asset: { id: 'asset-1', branchId: OTHER, status: 'inStock' },
      fromBranchId: OTHER,
      fills: ['accessories'],
      message: 'an open maintenance order holds it — it is not moved',
      selectable: true,
      selected: true,
    });
    // What a ticked row writes: the fill, and no move.
    expect(heldRow?.decision?.kind === 'found' && heldRow.decision.move).toBeNull();
    // An order opened between the preview and the apply changes the plan: its hash refuses it.
    expect(planHashOf(BRANCH, importRowsOf(held, everything([ordered])))).not.toBe(
      planHashOf(BRANCH, importRowsOf(unaware, everything([ordered]))),
    );
    // Nothing to fill: nothing to write at all.
    const idle = planAssetImport({
      lines: [line(2, { tag: 'QW7RT52' })],
      branchId: BRANCH,
      register: [ordered],
      categories: CATEGORIES,
      maintained: new Set(['asset-1']),
    });
    expect(importRowsOf(idle, everything([ordered]))[0]?.dto).toMatchObject({
      decision: 'heldElsewhere',
      selectable: false,
    });
  });

  it('a second line for one device is a duplicate of the first — the first wins', () => {
    const result = rows(
      [
        line(2, { tag: 'QW7RT52' }),
        line(3, { tag: 'NEW0001' }),
        line(4, { serial: 'qw7rt52', tag: null }),
        line(5, { tag: 'new0001' }),
      ],
      [asset()],
    ).map((row) => row.dto);
    expect(result.map((row) => [row.row, row.decision, row.firstRow])).toEqual([
      [2, 'complete', null],
      [3, 'new', null],
      [4, 'duplicateInFile', 2],
      [5, 'duplicateInFile', 3],
    ]);
    expect(result[2]?.asset?.assetCode).toBe('AST-00001');
    expect(result.slice(2).every((row) => !row.selectable)).toBe(true);
  });

  it('two devices answer to one line: ambiguous — neither guessed at, neither named', () => {
    const dto = only(line(2, { serial: 'QW7RT52', tag: 'PL0MN33' }), [
      asset(),
      asset({ id: 'asset-2', assetCode: 'AST-00002', serialNumber: 'PL0MN33' }),
    ]);
    expect(dto).toMatchObject({ decision: 'ambiguous', asset: null, selectable: false });
    expect(dto.message).not.toContain('AST-');
  });
});

// ── The caller's reach ─────────────────────────────────────────────────────────────────────

describe('the caller’s reach', () => {
  const none: AssetImportScope = {
    visible: new Set(),
    editable: new Set(),
    assignable: new Set(),
    assignReachesBranch: true,
  };
  const seeing = (over: Partial<AssetImportScope>): AssetImportScope => ({
    ...none,
    visible: new Set(['asset-1']),
    ...over,
  });

  it('a device they may not see is out of scope — never named: no code, no branch, no values', () => {
    const dto = only(
      line(2, { tag: 'QW7RT52', specs: { ...NO_SPECS, processor: 'Intel Core i7' } }),
      [asset({ branchId: OTHER, specs: { memory: '8 GB' } })],
      none,
    );
    expect(dto).toMatchObject({
      decision: 'outOfScope',
      asset: null,
      fills: [],
      kept: [],
      fromBranchId: null,
      selectable: false,
    });
    expect(dto.message).toContain('itAsset.view');
  });

  it('a fill needs itAsset.edit over the device', () => {
    const entry = line(2, { tag: 'QW7RT52', accessories: ['ماوس'] });
    expect(only(entry, [asset()], seeing({}))).toMatchObject({
      decision: 'outOfScope',
      asset: { assetCode: 'AST-00001' },
      message: 'itAsset.edit does not reach this asset',
      selectable: false,
    });
    expect(only(entry, [asset()], seeing({ editable: new Set(['asset-1']) })).decision).toBe(
      'fill',
    );
  });

  it('a move needs itAsset.assign over the device AND the branch chosen', () => {
    const entry = line(2, { tag: 'QW7RT52' });
    const elsewhere = [asset({ branchId: OTHER })];
    expect(only(entry, elsewhere, seeing({})).message).toBe(
      'itAsset.assign does not reach this asset',
    );
    expect(
      only(
        entry,
        elsewhere,
        seeing({ assignable: new Set(['asset-1']), assignReachesBranch: false }),
      ).message,
    ).toBe('itAsset.assign does not reach the branch chosen');
    expect(only(entry, elsewhere, seeing({ assignable: new Set(['asset-1']) })).decision).toBe(
      'move',
    );
  });
});

// ── The two doubts ─────────────────────────────────────────────────────────────────────────

describe('warnings — writable, but not ticked', () => {
  it('nearSerial: a character or two off a device of the branch and category the file does not list', () => {
    const register = [asset({ serialNumber: 'QW7RT52' })];
    const dto = only(line(2, { tag: 'QW7RT58' }), register);
    expect(dto).toMatchObject({
      decision: 'new',
      warnings: ['nearSerial'],
      near: { assetCode: 'AST-00001', serialNumber: 'QW7RT52' },
      selectable: true,
      selected: false,
    });
    // Out of the caller's sight: the doubt said, the device not named.
    expect(
      only(line(2, { tag: 'QW7RT58' }), register, {
        visible: new Set(),
        editable: new Set(),
        assignable: new Set(),
        assignReachesBranch: true,
      }),
    ).toMatchObject({ warnings: ['nearSerial'], near: null });
  });

  it('is not a doubt for another branch, another category, three edits, or a device the file lists', () => {
    expect(only(line(2, { tag: 'QW7RT58' }), [asset({ branchId: OTHER })]).warnings).toEqual([]);
    expect(only(line(2, { tag: 'QW7RT58' }), [asset({ categoryId: DESKTOP })]).warnings).toEqual(
      [],
    );
    expect(only(line(2, { tag: 'QW7XY58' }), [asset()]).warnings).toEqual([]);
    const listed = rows([line(2, { tag: 'QW7RT52' }), line(3, { tag: 'QW7RT58' })], [asset()]);
    expect(listed[1]?.dto.warnings).toEqual([]);
    expect(editsBetween('QW7RT52', 'QW7RT58')).toBe(1);
  });

  it('productNumber: no serial, and the tag is HP’s product number', () => {
    expect(only(line(2, { kind: 'كمبيوتر مكتبي', tag: 'L8T14AV' }), [])).toMatchObject({
      decision: 'new',
      warnings: ['productNumber'],
      selectable: true,
      selected: false,
    });
    expect(
      only(line(2, { kind: 'كمبيوتر مكتبي', serial: 'CZC7RT52', tag: 'L8T14AV' }), []).warnings,
    ).toEqual([]);
  });
});

// ── Categories and the suggested branch ────────────────────────────────────────────────────

describe('each kind’s category', () => {
  const live = [
    { id: 'c-screen', name: { ar: 'شاشات', en: 'Monitors' }, isActive: true },
    { id: 'c-laptop', name: { ar: 'لاب توب', en: 'Laptop' }, isActive: true },
    { id: 'c-aio', name: { ar: 'كمبيوتر All in One', en: 'All in One' }, isActive: true },
    { id: 'c-old-printer', name: { ar: 'طابعة', en: 'Printer' }, isActive: false },
    { id: 'c-routers', name: { ar: 'راوتر', en: 'Router' }, isActive: true },
  ];

  it('the one chosen, else a live category by name, else the go-live’s kind — active only', () => {
    const categories = kindCategoriesFor(
      ['شاشة', 'لابتوب', 'Lenovo neo 50a', 'طابعة', 'راوتر', 'هاتف IP', 'كاميرا'],
      live,
      new Map([['كاميرا', 'c-chosen']]),
    );
    expect(Object.fromEntries(categories)).toEqual({
      شاشة: 'c-screen',
      لابتوب: 'c-laptop',
      'Lenovo neo 50a': 'c-aio',
      // Retired: no place to file a new device.
      طابعة: null,
      راوتر: 'c-routers',
      'هاتف IP': null,
      كاميرا: 'c-chosen',
    });
  });

  it('lists the kinds in the order they first appear, with their lines', () => {
    expect([
      ...kindsOf([line(2), line(3, { kind: 'هاتف IP' }), line(4), line(5, { kind: null })]),
    ]).toEqual([
      ['شاشة', 2],
      ['هاتف IP', 1],
    ]);
  });
});

describe('the branch the sheet’s name suggests', () => {
  const branches = [
    { id: 'b-tanta', name: { ar: 'طنطا', en: 'Tanta' }, status: 'active' as const },
    { id: 'b-alex', name: { ar: 'الإسكندرية', en: 'Alexandria' }, status: 'active' as const },
    { id: 'b-shorouk', name: { ar: 'الشروق', en: 'Shorouk' }, status: 'active' as const },
    { id: 'b-closed', name: { ar: 'بنها', en: 'Benha' }, status: 'inactive' as const },
  ];

  it('«عهدة فرع X» — by the branch’s name, folded, or by the go-live’s spelling of it', () => {
    expect(suggestedBranchOf('عهدة فرع طنطا', branches)).toBe('b-tanta');
    expect(suggestedBranchOf('عهده فرع الاسكندريه', branches)).toBe('b-alex');
    expect(suggestedBranchOf('عهدة فرع وصال', branches)).toBe('b-shorouk');
  });

  it('nothing for another name, an inactive branch, or two branches answering', () => {
    expect(suggestedBranchOf('Sheet1', branches)).toBeNull();
    expect(suggestedBranchOf('عهدة فرع بنها', branches)).toBeNull();
    expect(
      suggestedBranchOf('عهدة فرع طنطا', [
        ...branches,
        { id: 'b-tanta-2', name: { ar: 'طنطا', en: 'Tanta 2' }, status: 'active' },
      ]),
    ).toBeNull();
  });
});

// ── The preview, its hash, and the apply's refusals ───────────────────────────────────────

describe('the preview and its hash', () => {
  const lines = [
    line(2, { tag: 'NEW0001' }),
    line(3, { tag: 'QW7RT52', accessories: ['كابل'] }),
    line(4, { serial: null, tag: null }),
  ];

  const previewOf = (register: ImportRegisterAsset[], branchId = BRANCH) => {
    const planned = planAssetImport({ lines, branchId, register, categories: CATEGORIES });
    const result = importRowsOf(planned, everything(register));
    return assetImportPreview({
      fileSha256: 'f'.repeat(64),
      sheetName: 'عهدة فرع طنطا',
      suggestedBranchId: BRANCH,
      plan: planned,
      lines,
      rows: result,
    });
  };

  it('counts every decision and lists the kinds with their categories', () => {
    const preview = previewOf([asset()]);
    expect(Object.keys(preview.counts)).toEqual([...IT_ASSET_IMPORT_DECISIONS]);
    expect(preview.counts).toMatchObject({ new: 1, fill: 1, noIdentifier: 1, move: 0 });
    expect(preview.kinds).toEqual([{ kind: 'شاشة', categoryId: SCREEN, rows: 3 }]);
    expect(preview).toMatchObject({ branchId: BRANCH, suggestedBranchId: BRANCH });
  });

  it('the same plan hashes the same; a changed decision, or another branch, hashes otherwise', () => {
    const first = previewOf([asset()]);
    expect(previewOf([asset()]).planHash).toBe(first.planHash);
    expect(first.planHash).toMatch(/^[0-9a-f]{64}$/u);
    // Moved to another branch meanwhile: row 3 is a move now.
    expect(previewOf([asset({ branchId: OTHER })]).planHash).not.toBe(first.planHash);
    // Somebody registered row 2's device meanwhile.
    expect(
      previewOf([
        asset(),
        asset({ id: 'asset-9', assetCode: 'AST-00009', serialNumber: 'NEW0001' }),
      ]).planHash,
    ).not.toBe(first.planHash);
    const planned = planAssetImport({
      lines,
      branchId: BRANCH,
      register: [asset()],
      categories: CATEGORIES,
    });
    expect(planHashOf(OTHER, importRowsOf(planned, everything([asset()])))).not.toBe(
      first.planHash,
    );
  });
});

describe('the apply’s refusals — the preview that was seen, or nothing', () => {
  const result = rows(
    [line(2, { tag: 'NEW0001' }), line(3, { tag: 'QW7RT52' }), line(4, { tag: 'NEW0002' })],
    [asset()],
  );
  const hash = planHashOf(BRANCH, result);
  const seen = { fileSha256: 'a'.repeat(64), planHash: hash };

  it('writes the rows asked for, once each, in the sheet’s order', () => {
    expect(rowsToWrite(result, seen, seen, [4, 2, 4]).map((row) => row.dto.row)).toEqual([2, 4]);
  });

  /** What a refusal threw. */
  const refusal = (wanted: number[], now = seen): unknown => {
    try {
      rowsToWrite(result, seen, now, wanted);
    } catch (error) {
      return error;
    }
    throw new Error('nothing was refused');
  };

  it('another file, or another plan — 409', () => {
    expect(refusal([2], { ...seen, fileSha256: 'b'.repeat(64) })).toMatchObject({
      httpStatus: 409,
    });
    expect(refusal([2], { ...seen, planHash: 'c'.repeat(64) })).toMatchObject({
      httpStatus: 409,
      message: 'the register changed since the preview — preview again',
    });
  });

  it('a row that is no line of the file, or cannot be written — 422', () => {
    expect(refusal([2, 9])).toMatchObject({
      httpStatus: 422,
      message: 'row(s) 9 are not lines of the file',
    });
    // Row 3 is complete: nothing to write.
    expect(refusal([3])).toMatchObject({ httpStatus: 422, message: 'row(s) 3 cannot be written' });
  });
});

describe('the words the register keeps', () => {
  it('names the upload in the notes and the history — the go-live’s sentences', () => {
    const words = importWords('  عهدة فرع طنطا.xlsx ', 'فرع طنطا');
    expect(words.notes).toBe('من ملف «عهدة فرع طنطا.xlsx» — رفع جماعي');
    expect(words.updated(['specs.processor', 'accessories'])).toBe(
      'أُضيفت من ملف «عهدة فرع طنطا.xlsx» — رفع جماعي: المعالج، المشتملات',
    );
    expect(words.transferred(null)).toBe(
      'نُقل إلى فرع طنطا حسب ملف «عهدة فرع طنطا.xlsx» — رفع جماعي',
    );
    expect(words.transferred('مخزن IT')).toBe(
      'نُقل إلى فرع طنطا حسب ملف «عهدة فرع طنطا.xlsx» — رفع جماعي — وأُزيل الموقع السابق «مخزن IT»',
    );
  });

  it('cuts a long upload name to a sane length', () => {
    const name = importFileName(`${'ملف '.repeat(60)}.xlsx`);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith('…')).toBe(true);
  });
});
