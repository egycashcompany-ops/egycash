// The workbook's optional title row — written for the ATM statements («مكتوب فوقه عنوان بيان تغذية
// ماكينات الصراف الآلي عن يوم …», 2026-10-27): bold, merged across the table's columns, a blank row
// under it, and every other row moved down by two. A sheet without one is exactly what it was.
import { describe, expect, it } from 'vitest';
import { buildXlsx, type XlsxSheet } from './fleet-xlsx';

// The entries are STORED, so the sheet's XML is plain text inside the zip.
const text = async (blob: Blob): Promise<string> =>
  new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));

const sheet = (over: Partial<XlsxSheet> = {}): XlsxSheet => ({
  name: 'التغذيات',
  serialHeader: 'م',
  header: ['البنك', 'الكود'],
  rows: [['SYN NBE', '101']],
  ...over,
});

describe('a sheet with a title', () => {
  it('writes it in row 1, merged across the serial and every column, the header in row 3', async () => {
    const xml = await text(
      buildXlsx(sheet({ title: 'بيان تغذية ماكينات الصراف الآلي عن يوم 27' })),
    );
    expect(xml).toContain(
      '<row r="1" ht="24" customHeight="1"><c r="A1" s="6" t="inlineStr"><is><t xml:space="preserve">بيان تغذية ماكينات الصراف الآلي عن يوم 27</t></is></c></row>',
    );
    expect(xml).toContain('<mergeCells count="1"><mergeCell ref="A1:C1"/></mergeCells>');
    expect(xml).toContain('<row r="3"><c r="A3" s="1"');
    expect(xml).toContain('<row r="4"><c r="A4" s="0"><v>1</v></c>');
    expect(xml).not.toContain('<row r="2"');
  });

  it('declares the title style the cell names', async () => {
    const xml = await text(buildXlsx(sheet({ title: 'T' })));
    expect(xml).toContain('<fonts count="3">');
    expect(xml).toContain('<cellXfs count="7">');
  });
});

describe('a sheet without one', () => {
  it('keeps the header in row 1 and merges nothing', async () => {
    const xml = await text(buildXlsx(sheet()));
    expect(xml).toContain('<row r="1"><c r="A1" s="1"');
    expect(xml).toContain('<row r="2"><c r="A2" s="0"><v>1</v></c>');
    expect(xml).not.toContain('<mergeCells');
  });
});
