import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  columnIndexOf,
  formatOfCode,
  numberText,
  previewBudget,
  previewOf,
  readCellFormats,
  readDocxBlocks,
  readHeadingStyleIds,
  readSharedStrings,
  readSheetRows,
  serialText,
  tidyLines,
} from './preview';

describe('a Word document', () => {
  it('reads as headings, paragraphs and tables, in order', () => {
    const xml =
      '<w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>العنوان</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">سطر </w:t></w:r><w:r><w:tab/><w:t>&amp; تكملة</w:t></w:r></w:p>' +
      '<w:p/>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>أ</w:t></w:r></w:p><w:p><w:r><w:t>ب</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '</w:body>';
    expect(readDocxBlocks(xml)).toEqual({
      truncated: false,
      blocks: [
        { type: 'heading', text: 'العنوان' },
        { type: 'paragraph', text: 'سطر  & تكملة' },
        { type: 'table', rows: [['أ\nب']] },
      ],
    });
  });

  it('trims a line of a million spaces at once — no pattern backtracks over it', () => {
    const start = Date.now();
    expect(tidyLines(`a${' '.repeat(1_000_000)}b${' '.repeat(1_000_000)}`)).toBe(
      `a${' '.repeat(1_000_000)}b`,
    );
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('reads a text box once, inside the paragraph that anchors it', () => {
    const xml =
      '<w:p><w:r><w:t>قبل</w:t></w:r><mc:AlternateContent><mc:Choice><w:txbxContent>' +
      '<w:p><w:r><w:t>داخل الصندوق</w:t></w:r></w:p></w:txbxContent></mc:Choice>' +
      '<mc:Fallback><w:txbxContent><w:p><w:r><w:t>داخل الصندوق</w:t></w:r></w:p></w:txbxContent></mc:Fallback>' +
      '</mc:AlternateContent><w:r><w:t>بعد</w:t></w:r></w:p>';
    expect(readDocxBlocks(xml).blocks).toEqual([
      { type: 'paragraph', text: 'قبل\nداخل الصندوقبعد' },
    ]);
  });

  it('knows a heading by its style name in a Word of any language', () => {
    const ids = readHeadingStyleIds(
      '<w:styles><w:style w:styleId="1"><w:name w:val="heading 1"/></w:style>' +
        '<w:style w:styleId="a"><w:name w:val="Normal"/></w:style></w:styles>',
    );
    expect([...ids]).toEqual(['1']);
    const xml = '<w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>عنوان</w:t></w:r></w:p>';
    expect(readDocxBlocks(xml, ids).blocks).toEqual([{ type: 'heading', text: 'عنوان' }]);
  });

  it('says a table wider than the preview was cut', () => {
    const cells = Array.from(
      { length: 45 },
      (_, i) => `<w:tc><w:p><w:r><w:t>${i}</w:t></w:r></w:p></w:tc>`,
    );
    const read = readDocxBlocks(`<w:tbl><w:tr>${cells.join('')}</w:tr></w:tbl>`);
    expect(read.truncated).toBe(true);
    expect(read.blocks[0]).toMatchObject({ type: 'table' });
  });

  it('leaves out deleted text and field codes', () => {
    const xml =
      '<w:p><w:r><w:delText>قديم</w:delText></w:r><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:t>جديد</w:t></w:r></w:p>';
    expect(readDocxBlocks(xml).blocks).toEqual([{ type: 'paragraph', text: 'جديد' }]);
  });
});

describe('an Excel workbook', () => {
  it('names columns from their letters', () => {
    expect(columnIndexOf('A1')).toBe(0);
    expect(columnIndexOf('Z9')).toBe(25);
    expect(columnIndexOf('AA10')).toBe(26);
    expect(columnIndexOf('12')).toBeNull();
  });

  it('joins a shared string’s runs and leaves its phonetic hints out', () => {
    expect(
      readSharedStrings(
        '<sst><si><t>أ</t></si><si><r><t>ب</t></r><r><t>ج</t></r><rPh><t>x</t></rPh></si></sst>',
      ),
    ).toEqual(['أ', 'بج']);
  });

  it('knows which styles print dates, times or both', () => {
    const styles =
      '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="0.00%"/>' +
      '<numFmt numFmtId="166" formatCode="hh:mm"/><numFmt numFmtId="167" formatCode="yyyy-mm-dd hh:mm"/></numFmts>' +
      '<cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/>' +
      '<xf numFmtId="20"/><xf numFmtId="166"/><xf numFmtId="22"/><xf numFmtId="167"/></cellXfs></styleSheet>';
    expect(readCellFormats(styles)).toEqual([
      null,
      'date',
      'date',
      null,
      'time',
      'time',
      'datetime',
      'datetime',
    ]);
    expect(formatOfCode('[h]:mm')).toBe('time');
    expect(formatOfCode('"Total" 0')).toBeNull();
    expect(formatOfCode('m'.repeat(5000))).toBeNull();
  });

  it('prints a serial as its format says', () => {
    expect(serialText(46351, 'date', false)).toBe('2026-11-25');
    expect(serialText(46351.5, 'date', false)).toBe('2026-11-25 12:00');
    expect(serialText(0.5, 'time', false)).toBe('12:00');
    expect(serialText(0.5 + 15 / 86400, 'time', false)).toBe('12:00:15');
    expect(serialText(46351.25, 'datetime', false)).toBe('2026-11-25 06:00');
  });

  it('keeps 15 significant digits — a national number is not rounded', () => {
    expect(numberText('29801011234567')).toBe('29801011234567');
    expect(numberText('0.30000000000000004')).toBe('0.3');
  });

  it('reads rows as cell text, gaps kept, types honoured', () => {
    const sheet =
      '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="b"><v>1</v></c></row>' +
      '<row r="3"><c r="B3" s="1"><v>46351</v></c><c r="A3"><v>0.30000000000000004</v></c>' +
      '<c r="D3" t="inlineStr"><is><t>نص</t></is></c></row></sheetData>';
    expect(readSheetRows(sheet, ['الاسم'], [null, 'date'], false)).toEqual({
      truncated: false,
      rows: [['الاسم', '', 'TRUE'], [], ['0.3', '2026-11-25', '', 'نص']],
    });
  });

  it('stops at a row the gap before it would push past the limit, and says so', () => {
    const read = readSheetRows(
      '<sheetData><row r="1"><c r="A1"><v>1</v></c></row><row r="900"><c r="A900"><v>2</v></c></row></sheetData>',
      [],
      [],
      false,
    );
    expect(read.rows).toEqual([['1']]);
    expect(read.truncated).toBe(true);
  });

  it('spends one budget across the whole file', () => {
    const budget = previewBudget();
    budget.left = 5;
    const read = readSheetRows(
      '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>abc</t></is></c><c r="B1" t="inlineStr"><is><t>defg</t></is></c></row></sheetData>',
      [],
      [],
      false,
      budget,
    );
    expect(read.rows).toEqual([['abc']]);
    expect(read.truncated).toBe(true);
  });

  it('stops at the row limit and says so', () => {
    const rows = Array.from(
      { length: 510 },
      (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`,
    );
    const read = readSheetRows(`<sheetData>${rows.join('')}</sheetData>`, [], [], false);
    expect(read.rows).toHaveLength(500);
    expect(read.truncated).toBe(true);
  });
});

describe('the preview', () => {
  it('reads a workbook’s visible sheets only', async () => {
    const zip = new JSZip();
    zip.file(
      'xl/workbook.xml',
      '<workbook><sheets><sheet name="أ" r:id="rId1"/><sheet name="ب" state="hidden" r:id="rId2"/></sheets></workbook>',
    );
    zip.file(
      'xl/_rels/workbook.xml.rels',
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    );
    zip.file(
      'xl/worksheets/sheet1.xml',
      '<sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData>',
    );
    zip.file(
      'xl/worksheets/sheet2.xml',
      '<sheetData><row r="1"><c r="A1"><v>8</v></c></row></sheetData>',
    );
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    expect(await previewOf('excel', 'risks.xlsx', buffer)).toEqual({
      kind: 'sheets',
      truncated: false,
      sheets: [{ name: 'أ', rows: [['7']], truncated: false }],
    });
  });

  it('is unavailable for an older format, a PDF, or a file that does not read', async () => {
    expect(await previewOf('word', 'old.doc', Buffer.from('x'))).toEqual({ kind: 'unavailable' });
    expect(await previewOf('pdf', 'a.pdf', Buffer.from('%PDF'))).toEqual({ kind: 'unavailable' });
    expect(await previewOf('word', 'broken.docx', Buffer.from('PK not a zip'))).toEqual({
      kind: 'unavailable',
    });
  });
});
