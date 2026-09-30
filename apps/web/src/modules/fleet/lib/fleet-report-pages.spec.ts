// «صورتين ينزلو مره واحده» and «الاكسيل يبقى زى الطباعه» — the drivers' report is two pages in one
// printed document, and two sheets in one workbook.
import { describe, expect, it } from 'vitest';
import {
  buildFleetReportHtml,
  buildFleetReportsHtml,
  type FleetReport,
} from './fleet-report-print';
import { buildXlsx, buildXlsxBook } from './fleet-xlsx';

const page = (title: string, cell: string): FleetReport => ({
  title,
  department: 'إدارة الحركة',
  subtitle: '',
  header: ['اسم السائـق'],
  rows: [[cell]],
  totals: [],
  signatories: {
    preparedByTitle: 'القائم بالأعمال',
    preparedByName: 'أ',
    approvedByTitle: 'مدير إدارة الحركة',
    approvedByName: 'ب',
    endorsementNote: '',
    endorsedByName: '',
  },
  serialHeader: 'م',
  emptyLabel: '—',
});

describe('two pages in one printed document', () => {
  const html = buildFleetReportsHtml([page('أولى', 'صف أول'), page('ثانية', 'صف ثان')]);

  it('carries both pages, each a whole form with its own signatures', () => {
    expect(html.match(/<section class="page">/gu)).toHaveLength(2);
    expect(html).toContain('صف أول');
    expect(html).toContain('صف ثان');
    expect(html.match(/القائم بالأعمال/gu)).toHaveLength(2);
  });

  it('starts the second page on a new sheet of paper, and prints once', () => {
    expect(html).toContain('.page + .page { break-before: page; page-break-before: always; }');
    expect(html.match(/window\.print\(\)/gu)).toHaveLength(1);
  });

  it('keeps the web font import FIRST in the stylesheet, where CSS honours it', () => {
    const style = html.slice(html.indexOf('<style>') + '<style>'.length).trimStart();
    expect(style.startsWith('@import')).toBe(true);
  });

  it('prints a one-page report exactly as one page', () => {
    expect(buildFleetReportHtml(page('أولى', 'صف'))).toBe(
      buildFleetReportsHtml([page('أولى', 'صف')]),
    );
  });
});

describe('two sheets in one workbook', () => {
  const sheet = (name: string, cell: string) => ({
    name,
    serialHeader: 'م',
    header: ['اسم السائـق'],
    rows: [[cell]],
  });
  const text = async (blob: Blob): Promise<string> =>
    new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));

  it('lists both sheets, each its own part, related and typed', async () => {
    const book = await text(
      buildXlsxBook([sheet('مخالفات السائقين', 'صف أول'), sheet('ملخص السائقين', 'صف ثان')]),
    );
    expect(book).toContain('<sheet name="مخالفات السائقين" sheetId="1" r:id="rId1"/>');
    expect(book).toContain('<sheet name="ملخص السائقين" sheetId="2" r:id="rId2"/>');
    expect(book).toContain('Target="worksheets/sheet2.xml"');
    expect(book).toContain(
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    );
    expect(book).toContain('PartName="/xl/worksheets/sheet2.xml"');
    expect(book).toContain('صف أول');
    expect(book).toContain('صف ثان');
  });

  it('writes a one-sheet workbook byte for byte as before', async () => {
    const one = await text(buildXlsx(sheet('مخالفات', 'صف')));
    expect(one).toContain('<sheets><sheet name="مخالفات" sheetId="1" r:id="rId1"/></sheets>');
    expect(one).toContain(
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    );
    expect(one).not.toContain('sheet2.xml');
  });
});
