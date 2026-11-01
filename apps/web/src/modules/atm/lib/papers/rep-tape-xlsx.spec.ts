// The REP. TAPE / ATM_2 export (docs/12-planning/atm-settlements-phase1.md §8.5, §10.4). The Blob
// is unzipped and its XML read back. Invented data only: `BRKN9001`, «ماكينة اختبار 1».
import { repTapeSlots, type AtmPlanSlot, type AtmRepTapeExportDto } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import { REP_TAPE_HEADERS, buildRepTapeXlsx, repTapeFilename, weekdayOf } from './rep-tape-xlsx';

/** The parts of a STORED zip (the writer never deflates), by name. */
const unzip = async (blob: Blob): Promise<Map<string, string>> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const out = new Map<string, string>();
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength;
    out.set(name, new TextDecoder().decode(bytes.subarray(start, start + size)));
    at = start + size;
  }
  return out;
};

interface XCell {
  value: string | number;
  style: number;
}

/** A sheet's cells by address: inline strings as text, numbers as numbers. */
const cellsOf = (xml: string): Map<string, XCell> =>
  new Map(
    [...xml.matchAll(/<c r="([A-Z]+\d+)" s="(\d+)"(?: t="inlineStr")?(?:\/>|>(.*?)<\/c>)/gu)].map(
      (m) => {
        const inner = m[3] ?? '';
        const text = /<t[^>]*>(.*?)<\/t>/u.exec(inner)?.[1];
        const number = /<v>(.*?)<\/v>/u.exec(inner)?.[1];
        return [
          m[1] ?? '',
          {
            value: text !== undefined ? text : number !== undefined ? Number(number) : '',
            style: Number(m[2]),
          },
        ];
      },
    ),
  );

const slot = (n: number, kind: AtmPlanSlot['kind'], denomination: number | null, notes: number) =>
  ({
    slot: n,
    kind,
    denomination,
    currency: kind === 'empty' ? null : 'EGP',
    notes,
    bag: null,
  }) as AtmPlanSlot;

const line = (
  serial: number,
  code: string,
  slots: AtmPlanSlot[],
  over: Partial<AtmRepTapeExportDto['rows'][number]> = {},
): AtmRepTapeExportDto['rows'][number] => {
  const byDenomination = [200, 100, 50, 20, 10, 5]
    .map((d) => ({
      denomination: d,
      notes: slots
        .filter((s) => s.kind === 'withdrawal' && s.denomination === d)
        .reduce((sum, s) => sum + s.notes, 0),
    }))
    .filter((d) => slots.some((s) => s.kind === 'withdrawal' && s.denomination === d.denomination));
  return {
    serial,
    reference: code,
    location: `ماكينة اختبار ${String(serial)}`,
    slots: repTapeSlots(slots),
    byDenomination,
    egpTotalMinor: slots.reduce((sum, s) => sum + s.notes * (s.denomination ?? 0) * 100, 0),
    comment: 'Repl @9:00 PM',
    dep: 'منطقة اختبار',
    typeLabel: 'BRK (T1)',
    hubLabel: null,
    ...over,
  };
};

const FOUR = [
  slot(1, 'withdrawal', 200, 2000),
  slot(2, 'withdrawal', 200, 2000),
  slot(3, 'withdrawal', 100, 2000),
  slot(4, 'withdrawal', 50, 1000),
];
const THREE = [
  slot(1, 'withdrawal', 200, 3000),
  slot(2, 'withdrawal', 100, 2000),
  slot(3, 'withdrawal', 50, 1000),
  slot(4, 'empty', null, 0),
];
const REVERSED = [
  slot(1, 'empty', null, 0),
  slot(2, 'withdrawal', 50, 1000),
  slot(3, 'withdrawal', 100, 1000),
  slot(4, 'withdrawal', 200, 1000),
];

const dto = (rows: AtmRepTapeExportDto['rows']): AtmRepTapeExportDto => ({
  bankCode: 'BRK',
  replenishDate: '2026-10-27',
  rows,
});

const read = async (export_: AtmRepTapeExportDto) => {
  const { blob, filename } = buildRepTapeXlsx(export_);
  const parts = await unzip(blob);
  return {
    filename,
    parts,
    tape: cellsOf(parts.get('xl/worksheets/sheet1.xml') ?? ''),
    atm2: cellsOf(parts.get('xl/worksheets/sheet2.xml') ?? ''),
    tapeXml: parts.get('xl/worksheets/sheet1.xml') ?? '',
    styles: parts.get('xl/styles.xml') ?? '',
  };
};

const xf = (styles: string, id: number): string =>
  [...(/<cellXfs[^>]*>(.*)<\/cellXfs>/u.exec(styles)?.[1] ?? '').matchAll(/<xf .*?<\/xf>/gu)][
    id
  ]?.[0] ?? '';

describe('the workbook', () => {
  it('holds REP. TAPE then ATM_2, left to right, under the owner’s file name', async () => {
    const { parts, filename, tapeXml } = await read(dto([line(1027, 'BRKN9001', FOUR)]));
    expect(parts.get('xl/workbook.xml')).toContain(
      '<sheet name="REP. TAPE" sheetId="1" r:id="rId1"/><sheet name="ATM_2" sheetId="2" r:id="rId2"/>',
    );
    expect(tapeXml).not.toContain('rightToLeft');
    expect(parts.get('xl/worksheets/sheet2.xml')).not.toContain('rightToLeft');
    expect(filename).toBe('REP TAPE BRK 27-10-2026.xlsx');
    expect(repTapeFilename({ bankCode: 'BRK', replenishDate: '2026-03-05' })).toBe(
      'REP TAPE BRK 05-03-2026.xlsx',
    );
  });
});

describe('REP. TAPE', () => {
  it('row 7 is B…P exactly, Q blank, and R7:T7 are 200, 100, 50 as numbers', async () => {
    const { tape } = await read(dto([line(1027, 'BRKN9001', FOUR)]));
    const row7 = 'BCDEFGHIJKLMNOP'.split('').map((c) => tape.get(`${c}7`)?.value);
    expect(row7).toEqual([...REP_TAPE_HEADERS]);
    expect(tape.get('D7')?.value).toBe('No-of bills1');
    expect(tape.get('F7')?.value).toBe('No- of bills2');
    expect(tape.has('Q7')).toBe(false);
    expect(['R7', 'S7', 'T7'].map((c) => tape.get(c)?.value)).toEqual([200, 100, 50]);
    expect(tape.has('U7')).toBe(false);
  });

  it('writes each line from row 8 with its per-denomination sums under R:T', async () => {
    const { tape } = await read(dto([line(1027, 'BRKN9001', FOUR), line(1028, 'BRKN9002', THREE)]));
    expect(['B8', 'C8', 'D8', 'E8', 'L8', 'M8', 'N8', 'P8'].map((c) => tape.get(c)?.value)).toEqual(
      [
        'BRKN9001',
        'ماكينة اختبار 1027',
        2000,
        200,
        1_050_000,
        'Repl @9:00 PM',
        'منطقة اختبار',
        'AlBarka',
      ],
    );
    expect(['R8', 'S8', 'T8'].map((c) => tape.get(c)?.value)).toEqual([4000, 2000, 1000]);
    expect(['R9', 'S9', 'T9'].map((c) => tape.get(c)?.value)).toEqual([3000, 2000, 1000]);
  });

  it('a 3-cassette line is blank in cassette 4; a reversed line is 0/0 in slot 1', async () => {
    const { tape } = await read(dto([line(1, 'BRKN9001', THREE), line(2, 'BRKN9002', REVERSED)]));
    expect(tape.has('J8')).toBe(false);
    expect(tape.has('K8')).toBe(false);
    expect(['D9', 'E9', 'F9', 'G9', 'J9', 'K9'].map((c) => tape.get(c)?.value)).toEqual([
      0, 0, 1000, 50, 1000, 200,
    ]);
  });

  it('a 5-slot line puts its fifth pair after the per-denomination columns', async () => {
    const five = [...FOUR, slot(5, 'withdrawal', 100, 500)];
    const { tape, tapeXml } = await read(
      dto([line(1, 'BRKN9001', five), line(2, 'BRKN9002', FOUR)]),
    );
    expect(tape.get('U7')?.value).toBe('No- of bills5');
    expect(tape.get('V7')?.value).toBe('Denom5');
    expect(tape.get('U6')?.value).toBe('Cassette 5');
    expect([tape.get('U8')?.value, tape.get('V8')?.value]).toEqual([500, 100]);
    expect(tape.has('U9')).toBe(false);
    expect(tapeXml).toContain('<mergeCell ref="U6:V6"/>');
  });

  it('adds U:W (20, 10, 5) only when a line carries such notes', async () => {
    const twenty = [...FOUR.slice(0, 3), slot(4, 'withdrawal', 20, 0)];
    const none = await read(dto([line(1, 'BRKN9001', twenty)]));
    expect(none.tape.has('U7')).toBe(false);
    const withNotes = [...FOUR.slice(0, 3), slot(4, 'withdrawal', 20, 500)];
    const some = await read(dto([line(1, 'BRKN9001', withNotes)]));
    expect(['U7', 'V7', 'W7'].map((c) => some.tape.get(c)?.value)).toEqual([20, 10, 5]);
    expect(['U8', 'V8', 'W8'].map((c) => some.tape.get(c)?.value)).toEqual([500, 0, 0]);
  });

  it('dates are numbers: O8 in built-in format 14, D4 in [$-409]d/mmm/yy;@, F4 the weekday', async () => {
    const { tape, styles } = await read(dto([line(1, 'BRKN9001', FOUR)]));
    expect(tape.get('O8')?.value).toBe(46322);
    expect(xf(styles, tape.get('O8')?.style ?? -1)).toContain('numFmtId="14"');
    expect(tape.get('D4')?.value).toBe(46322);
    expect(xf(styles, tape.get('D4')?.style ?? -1)).toContain('numFmtId="164"');
    expect(styles).toContain('<numFmt numFmtId="164" formatCode="[$-409]d/mmm/yy;@"/>');
    expect(tape.get('F4')?.value).toBe('Tuesday');
    expect(weekdayOf('2026-10-26')).toBe('Monday');
    expect(tape.get('B4')?.value).toBe('Date of cash fill:');
    expect(xf(styles, tape.get('L8')?.style ?? -1)).toContain('numFmtId="3"');
  });

  it('merges the paper’s groups', async () => {
    const { tapeXml } = await read(dto([line(1, 'BRKN9001', FOUR)]));
    for (const ref of ['D4:E4', 'F4:G4', 'B6:C6', 'D6:E6', 'F6:G6', 'H6:I6', 'J6:K6', 'M6:P6']) {
      expect(tapeXml, ref).toContain(`<mergeCell ref="${ref}"/>`);
    }
    expect(cellsOf(tapeXml).get('B6')?.value).toBe(' ATMs');
    expect(cellsOf(tapeXml).get('M6')?.value).toBe('EGY Cash');
  });
});

describe('ATM_2', () => {
  it('heads ID … HUB, the same lines with the same blank rule, HUB the hub label or the area', async () => {
    const { atm2 } = await read(
      dto([line(1, 'BRKN9001', FOUR, { hubLabel: 'مركز اختبار' }), line(2, 'BRKN9002', THREE)]),
    );
    const head = 'ABCDEFGHIJKLM'.split('').map((c) => atm2.get(`${c}1`)?.value);
    expect(head).toEqual([
      'ID',
      'LOC',
      'Note 1',
      'Denom1',
      'Note 2',
      'Denom2',
      'Note 3',
      'Denom3',
      'Note 4',
      'Denom4',
      'Total',
      'TYPE',
      'HUB',
    ]);
    expect(['A2', 'C2', 'D2', 'K2', 'L2', 'M2'].map((c) => atm2.get(c)?.value)).toEqual([
      'BRKN9001',
      2000,
      200,
      1_050_000,
      'BRK (T1)',
      'مركز اختبار',
    ]);
    expect(atm2.has('I3')).toBe(false);
    expect(atm2.get('M3')?.value).toBe('منطقة اختبار');
  });
});
