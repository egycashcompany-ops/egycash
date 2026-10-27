// «سيلزات» and the route sheets (docs/12-planning/atm-settlements-phase1.md §8.4, §10.4). Invented
// data only: `BRKN9001`, `BAG-T-0001`.
import {
  type AtmHandoverPrintDto,
  type AtmHandoverPrintRowDto,
  type AtmRoutesPrintDto,
} from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import { HANDOVER_COLUMN_SHARES, buildHandoverHtml, buildRoutesHtml } from './handover-print';
import { SEALS_WORDS } from './settlement-paper-wording';
import { FLOW_PAGE_MARGIN } from './settlement-print';

const row = (over: Partial<AtmHandoverPrintRowDto> = {}): AtmHandoverPrintRowDto => ({
  serial: 1027,
  bankCode: 'BRK',
  machineCode: 'BRKN9001',
  machineName: 'ماكينة اختبار 1',
  spareCode: null,
  run: 2,
  scheduleTime: '21:00',
  egpTotalMinor: 80_000_000,
  qrs: [],
  typeLabel: 'BRK (T1)',
  hubLabel: 'منطقة اختبار',
  prepared: false,
  ...over,
});

const handover = (over: Partial<AtmHandoverPrintDto> = {}): AtmHandoverPrintDto => ({
  bankCode: 'BRK',
  replenishDate: '2026-10-27',
  withQr: false,
  printedAt: '2026-10-26T18:00:00Z',
  rows: [row()],
  notPrepared: 1,
  ...over,
});

/** The cells of each body row of every page, tags stripped. */
const bodyRows = (html: string): string[][] =>
  [...html.matchAll(/<tbody>(.*?)<\/tbody>/gsu)]
    .flatMap((body) => [...(body[1] ?? '').matchAll(/<tr>(.*?)<\/tr>/gsu)])
    .map((m) =>
      [...(m[1] ?? '').matchAll(/<td[^>]*>(.*?)<\/td>/gsu)].map((c) =>
        (c[1] ?? '').replace(/<\/div><div class="qr">/gu, ' | ').replace(/<[^>]+>/gu, ''),
      ),
    );

const headers = (html: string): string[] =>
  [...(/<thead>(.*?)<\/thead>/su.exec(html)?.[1] ?? '').matchAll(/<th>(.*?)<\/th>/gsu)].map((m) =>
    (m[1] ?? '').replace(/<[^>]+>/gu, ''),
  );

describe('«سيلزات»', () => {
  it('prints the paper’s columns: ID · LOC · run · Total · the print day · «البركة» · HUB', () => {
    const html = buildHandoverHtml(handover());
    expect(headers(html)).toEqual(['ID', 'LOC', 'التغذية', 'Total', '26/10/2026', 'البركة', 'HUB']);
    expect(bodyRows(html)).toEqual([
      ['BRKN9001', 'ماكينة اختبار 1', '2 · 9:00 م', '800,000', '', 'BRK (T1)', 'منطقة اختبار'],
    ]);
    // The header repeats on every page.
    expect(html).toContain('.seals thead { display: table-header-group; }');
  });

  it('without withQr the QR box is blank for handwriting', () => {
    const html = buildHandoverHtml(handover({ rows: [row({ prepared: true })] }));
    expect(bodyRows(html)[0]?.[4]).toBe('');
  });

  it('with withQr a prepared line prints its QR, two bags in one cell, an unprepared one a blank box', () => {
    const html = buildHandoverHtml(
      handover({
        withQr: true,
        rows: [
          row({ prepared: true, qrs: ['BAG-T-0001'] }),
          row({ serial: 1028, prepared: true, qrs: ['BAG-T-0002', 'BAG-T-0003'] }),
          row({ serial: 1029, prepared: false, qrs: [] }),
        ],
      }),
    );
    expect(bodyRows(html).map((r) => r[4])).toEqual([
      'BAG-T-0001',
      '1: BAG-T-0002 | 2: BAG-T-0003',
      '',
    ]);
  });

  it('a spare set prints its code, or «—»', () => {
    const html = buildHandoverHtml(
      handover({
        rows: [
          row({ machineCode: null, machineName: null, spareCode: 'SP-T-1' }),
          row({ machineCode: null, machineName: null, spareCode: null }),
        ],
      }),
    );
    expect(bodyRows(html).map((r) => r[0])).toEqual(['SP-T-1', '—']);
  });

  it('ends with the owner’s footer and the supervisor line of 54 dots', () => {
    const html = buildHandoverHtml(handover());
    expect(SEALS_WORDS.supervisor).toBe(`توقيع المشرف / ${'.'.repeat(54)}`);
    expect(html).toContain('تم تسليم الخزينة الماكينات الموضحة اعلاه .');
    expect(html).toContain(`توقيع المشرف / ${'.'.repeat(54)}<`);
    expect(html).not.toMatch(/<script\b/iu);
  });

  it('flows over its sheets with a printable band at the top and bottom of each (LIVE-3)', () => {
    const html = buildHandoverHtml(handover());
    expect(FLOW_PAGE_MARGIN).toBe('10mm 0');
    expect(html).toContain(`@page { size: A4 portrait; margin: ${FLOW_PAGE_MARGIN}; }`);
    expect(html).not.toContain('@page { size: A4 portrait; margin: 0; }');
  });

  it('never wraps the compact run, and breaks only between words (LIVE-7)', () => {
    const html = buildHandoverHtml(handover());
    expect(html).toMatch(/<td class="run" dir="rtl">[^<]*<\/td>/u);
    expect(html).toContain('.seals td.run { white-space: nowrap; }');
    expect(html).toContain('overflow-wrap: break-word;');
    expect(html).not.toContain('overflow-wrap: anywhere');
    // «3 · 10:45 م» at 10 pt bold is ~16 mm: the run column is 10 % of the 190 mm table.
    expect(HANDOVER_COLUMN_SHARES[2]).toBeGreaterThanOrEqual(10);
    expect(HANDOVER_COLUMN_SHARES.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  it('breaks a machine type wider than its column after «)», never mid-word (R4-1)', () => {
    const html = buildHandoverHtml(handover({ rows: [row({ typeLabel: 'BRK(DN)recycle' })] }));
    expect(html).toContain('<td dir="rtl">BRK(DN)<wbr>recycle</td>');
    // The break chance is markup only: the cell still reads as the label.
    expect(bodyRows(html)[0]).toContain('BRK(DN)recycle');
  });
});

describe('the route sheets', () => {
  const dto: AtmRoutesPrintDto = {
    replenishDate: '2026-10-27',
    printedAt: '2026-10-26T18:00:00Z',
    // One line is on no route: it is counted, and printed on no sheet.
    unassigned: 1,
    routes: [
      {
        id: 'route-1',
        name: 'خط اختبار 1',
        leaderName: 'قائد اختبار',
        // The server sends a route's issued and prepared lines only; a cancelled one never arrives.
        rows: [
          row({ prepared: true, qrs: ['BAG-T-0001'] }),
          row({ serial: 1028, prepared: false }),
        ],
        machines: 2,
        bags: 2,
        notPrepared: 1,
      },
      {
        id: 'route-2',
        name: 'خط اختبار 2',
        leaderName: null,
        rows: [row({ serial: 1029, bankCode: 'CIB', prepared: true, qrs: ['BAG-T-0009'] })],
        machines: 1,
        bags: 1,
        notPrepared: 0,
      },
    ],
  };
  const html = buildRoutesHtml(dto);

  it('prints each route on its own page under its title line', () => {
    expect(html.match(/<section class="page flow">/gu)).toHaveLength(2);
    expect(html).toContain(`@page { size: A4 portrait; margin: ${FLOW_PAGE_MARGIN}; }`);
    expect(html).toContain('كشف خط خط اختبار 1 · قائد اختبار · 27/10/2026');
    expect(html).toContain('كشف خط خط اختبار 2 · 27/10/2026');
  });

  it('adds the bank column and prints the neutral TYPE header', () => {
    expect(headers(html).slice(0, 8)).toEqual([
      'ID',
      'البنك',
      'LOC',
      'التغذية',
      'Total',
      '26/10/2026',
      'TYPE',
      'HUB',
    ]);
    const rows = bodyRows(html);
    expect(rows.map((r) => [r[0], r[1], r[5]])).toEqual([
      ['BRKN9001', 'BRK', 'BAG-T-0001'],
      ['BRKN9001', 'BRK', ''],
      ['BRKN9001', 'CIB', 'BAG-T-0009'],
    ]);
  });
});
