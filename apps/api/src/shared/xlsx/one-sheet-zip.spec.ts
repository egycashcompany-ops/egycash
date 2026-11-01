// The in-memory one-sheet reducer (the fuel-card sheet reconciliation's): which sheet it keeps, in
// what order, the stand-in shared strings, the entry count before JSZip opens anything (SEC-13),
// and its refusals. Its caller-facing behaviour stays pinned by read-fuel-sheet.spec.ts.
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_SHARED_STRINGS,
  ZIP_MAX_ENTRIES,
  attributes,
  reduceToOneSheet,
  startTags,
  type OneSheetZipErrors,
  type OneSheetZipLimits,
} from './one-sheet-zip';

class Refused extends Error {
  constructor(
    readonly kind: 'unreadable' | 'tooLarge' | 'missingSheet',
    readonly what: string | null = null,
  ) {
    super(kind);
  }
}

const ERRORS: OneSheetZipErrors = {
  unreadable: () => new Refused('unreadable'),
  tooLarge: (what) => new Refused('tooLarge', what),
  missingSheet: () => new Refused('missingSheet'),
};

const MB = 1024 * 1024;
const LIMITS: OneSheetZipLimits = {
  workbookBytes: MB,
  relsBytes: MB,
  stylesBytes: MB,
  sharedStringsBytes: MB,
  sheetBytes: MB,
};
const later = (): number => Date.now() + 60_000;

const sheetXml = (marker: string): string =>
  `<worksheet><sheetData><row r="1"><c t="inlineStr" r="A1"><is><t>${marker}</t></is></c></row></sheetData></worksheet>`;

/** A workbook of named tabs (in tab order), each at the path given, sheets BEFORE anything else. */
const workbook = async (
  tabs: { name: string; path: string }[],
  options: { sharedStrings?: string; styles?: boolean; date1904?: boolean } = {},
): Promise<Buffer> => {
  const zip = new JSZip();
  // The dangerous order: every worksheet first.
  tabs.forEach((tab) => zip.file(tab.path, sheetXml(tab.name)));
  if (options.sharedStrings !== undefined) zip.file('xl/sharedStrings.xml', options.sharedStrings);
  if (options.styles !== false) zip.file('xl/styles.xml', '<styleSheet/>');
  zip.file(
    'xl/workbook.xml',
    `<workbook>${options.date1904 === true ? '<workbookPr date1904="1"/>' : ''}<sheets>${tabs
      .map(
        (tab, i) =>
          `<sheet name="${tab.name}" sheetId="${String(i + 1)}" r:id="rId${String(i + 1)}"/>`,
      )
      .join('')}</sheets></workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<Relationships>${tabs
      .map(
        (tab, i) =>
          `<Relationship Id="rId${String(i + 1)}" Target="${tab.path.replace(/^xl\//, '')}"/>`,
      )
      .join('')}</Relationships>`,
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};

const refusedBy = async (work: Promise<unknown>): Promise<Refused> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof Refused) return error;
    throw error;
  }
  throw new Error('expected a refusal');
};

const entries = async (buffer: Buffer): Promise<Record<string, string>> => {
  const zip = await JSZip.loadAsync(buffer);
  const out: Record<string, string> = {};
  for (const name of Object.keys(zip.files)) {
    const file = zip.file(name);
    if (file !== null) out[name] = await file.async('string');
  }
  return out;
};

const TWO_TABS = [
  { name: 'Balances', path: 'xl/worksheets/sheet1.xml' },
  { name: 'Notes', path: 'xl/worksheets/sheet2.xml' },
];

describe('which sheet is kept', () => {
  it("'first' keeps the first tab only — rels, workbook, styles, shared strings, then the sheet", async () => {
    const reduced = await reduceToOneSheet(
      await workbook(TWO_TABS),
      'first',
      LIMITS,
      later(),
      ERRORS,
    );
    const kept = await entries(reduced.buffer);
    expect(Object.keys(kept)).toEqual([
      'xl/_rels/workbook.xml.rels',
      'xl/workbook.xml',
      'xl/styles.xml',
      'xl/sharedStrings.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    expect(kept['xl/worksheets/sheet1.xml']).toContain('Balances');
  });

  it('a name keeps that tab, wherever it stands', async () => {
    const reduced = await reduceToOneSheet(
      await workbook(TWO_TABS),
      { name: 'Notes' },
      LIMITS,
      later(),
      ERRORS,
    );
    const kept = await entries(reduced.buffer);
    expect(Object.keys(kept).at(-1)).toBe('xl/worksheets/sheet2.xml');
    expect(kept['xl/worksheets/sheet2.xml']).toContain('Notes');
    expect(Object.keys(kept)).not.toContain('xl/worksheets/sheet1.xml');
  });

  it('a sheet at a path the reader does not know is renamed to one it does', async () => {
    const reduced = await reduceToOneSheet(
      await workbook([{ name: 'Sheet1', path: 'xl/worksheets/data.xml' }]),
      'first',
      LIMITS,
      later(),
      ERRORS,
    );
    expect(Object.keys(await entries(reduced.buffer)).at(-1)).toBe('xl/worksheets/sheet1.xml');
  });

  it('no such tab, or a workbook with none → missingSheet', async () => {
    const upload = await workbook(TWO_TABS);
    expect(
      (await refusedBy(reduceToOneSheet(upload, { name: 'ATMs' }, LIMITS, later(), ERRORS))).kind,
    ).toBe('missingSheet');
    expect(
      (await refusedBy(reduceToOneSheet(await workbook([]), 'first', LIMITS, later(), ERRORS)))
        .kind,
    ).toBe('missingSheet');
  });
});

describe('shared strings and flags', () => {
  it('stands in an empty shared-strings table when the workbook has none (the fuel sheets)', async () => {
    const reduced = await reduceToOneSheet(
      await workbook(TWO_TABS),
      'first',
      LIMITS,
      later(),
      ERRORS,
    );
    expect((await entries(reduced.buffer))['xl/sharedStrings.xml']).toBe(EMPTY_SHARED_STRINGS);
  });

  it('keeps the workbook’s own shared strings when it has them', async () => {
    const sst = '<sst count="1" uniqueCount="1"><si><t>x</t></si></sst>';
    const reduced = await reduceToOneSheet(
      await workbook(TWO_TABS, { sharedStrings: sst }),
      'first',
      LIMITS,
      later(),
      ERRORS,
    );
    expect((await entries(reduced.buffer))['xl/sharedStrings.xml']).toBe(sst);
  });

  it('leaves styles out when there are none, and reads the 1904 flag', async () => {
    const plain = await reduceToOneSheet(
      await workbook(TWO_TABS, { styles: false }),
      'first',
      LIMITS,
      later(),
      ERRORS,
    );
    expect(Object.keys(await entries(plain.buffer))).not.toContain('xl/styles.xml');
    expect(plain.date1904).toBe(false);
    const dated = await reduceToOneSheet(
      await workbook(TWO_TABS, { date1904: true }),
      'first',
      LIMITS,
      later(),
      ERRORS,
    );
    expect(dated.date1904).toBe(true);
  });
});

describe('refusals', () => {
  it('bytes that are not a zip, or a zip that is not a workbook → unreadable', async () => {
    expect(
      (await refusedBy(reduceToOneSheet(Buffer.from('nope'), 'first', LIMITS, later(), ERRORS)))
        .kind,
    ).toBe('unreadable');
    const zip = new JSZip();
    zip.file('hello.txt', 'hi');
    const notWorkbook = await zip.generateAsync({ type: 'nodebuffer' });
    expect(
      (await refusedBy(reduceToOneSheet(notWorkbook, 'first', LIMITS, later(), ERRORS))).kind,
    ).toBe('unreadable');
  });

  it('an entry past its cap → tooLarge naming the entry; a passed deadline → tooLarge(time)', async () => {
    const upload = await workbook(TWO_TABS);
    const capped = await refusedBy(
      reduceToOneSheet(upload, 'first', { ...LIMITS, sheetBytes: 16 }, later(), ERRORS),
    );
    expect([capped.kind, capped.what]).toEqual(['tooLarge', 'xl/worksheets/sheet1.xml']);
    const late = await refusedBy(reduceToOneSheet(upload, 'first', LIMITS, Date.now() - 1, ERRORS));
    expect([late.kind, late.what]).toEqual(['tooLarge', 'time']);
  });
});

describe('the entry count, before JSZip opens the file (SEC-13)', () => {
  const opened = () => vi.spyOn(JSZip, 'loadAsync');

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A zip of `count` empty entries — not a workbook, so past the count it is unreadable. */
  const zipOf = async (count: number): Promise<Buffer> => {
    const zip = new JSZip();
    for (let i = 0; i < count; i += 1) zip.file(`e${String(i)}`, '');
    return zip.generateAsync({ type: 'nodebuffer' });
  };

  const EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

  it('one entry over the limit → tooLarge(entries), and JSZip never opens it', async () => {
    const loadAsync = opened();
    const refused = await refusedBy(
      reduceToOneSheet(await zipOf(ZIP_MAX_ENTRIES + 1), 'first', LIMITS, later(), ERRORS),
    );
    expect([refused.kind, refused.what]).toEqual(['tooLarge', 'entries']);
    expect(loadAsync).not.toHaveBeenCalled();
  });

  it('exactly the limit passes the count (control: the spy sees the reducer’s JSZip)', async () => {
    const loadAsync = opened();
    const refused = await refusedBy(
      reduceToOneSheet(await zipOf(ZIP_MAX_ENTRIES), 'first', LIMITS, later(), ERRORS),
    );
    expect(refused.kind).toBe('unreadable');
    expect(loadAsync).toHaveBeenCalledTimes(1);
  });

  it('an end record that understates its entries is caught by the directory walk', async () => {
    const upload = await zipOf(ZIP_MAX_ENTRIES + 1);
    const eocd = upload.lastIndexOf(EOCD);
    upload.writeUInt16LE(1, eocd + 8);
    upload.writeUInt16LE(1, eocd + 10);
    const loadAsync = opened();
    const refused = await refusedBy(reduceToOneSheet(upload, 'first', LIMITS, later(), ERRORS));
    expect([refused.kind, refused.what]).toEqual(['tooLarge', 'entries']);
    expect(loadAsync).not.toHaveBeenCalled();
  });

  it('data prepended to the zip moves the directory, and the walk still counts it', async () => {
    const upload = Buffer.concat([Buffer.alloc(64, 0x20), await zipOf(ZIP_MAX_ENTRIES + 1)]);
    const eocd = upload.lastIndexOf(EOCD);
    upload.writeUInt16LE(1, eocd + 8);
    upload.writeUInt16LE(1, eocd + 10);
    const refused = await refusedBy(reduceToOneSheet(upload, 'first', LIMITS, later(), ERRORS));
    expect([refused.kind, refused.what]).toEqual(['tooLarge', 'entries']);
  });

  it('a ZIP64 marker or a ZIP64 end locator → tooLarge(entries); no end record → unreadable', async () => {
    const upload = await workbook(TWO_TABS);
    const eocd = upload.lastIndexOf(EOCD);
    const loadAsync = opened();

    const marked = Buffer.from(upload);
    marked.writeUInt16LE(0xffff, eocd + 10);
    const first = await refusedBy(reduceToOneSheet(marked, 'first', LIMITS, later(), ERRORS));
    expect([first.kind, first.what]).toEqual(['tooLarge', 'entries']);

    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeUInt32LE(1, 16);
    const withLocator = Buffer.concat([upload.subarray(0, eocd), locator, upload.subarray(eocd)]);
    const second = await refusedBy(reduceToOneSheet(withLocator, 'first', LIMITS, later(), ERRORS));
    expect([second.kind, second.what]).toEqual(['tooLarge', 'entries']);

    const cut = await refusedBy(
      reduceToOneSheet(upload.subarray(0, eocd), 'first', LIMITS, later(), ERRORS),
    );
    expect(cut.kind).toBe('unreadable');
    expect(loadAsync).not.toHaveBeenCalled();
  });
});

describe('the linear scans', () => {
  it('read attributes in both quote styles and tags with any prefix', () => {
    expect([...attributes(`<x:sheet name='A' r:id="rId9"/>`)]).toEqual([
      ['name', 'A'],
      ['r:id', 'rId9'],
    ]);
    expect(startTags('<a><x:sheet a="1"/><sheet<sheet b="2">', 'sheet')).toEqual([
      '<x:sheet a="1"/>',
      '<sheet b="2">',
    ]);
  });
});
