// The Note — «محضر جرد ماكينة الصراف الآلى» — one A4 portrait page per plan line
// (docs/12-planning/atm-settlements-phase1.md §8.2, DS-18, DS-19, S-5, S-6).
//
// THE PAPER'S GRID, NOT A NEW LAYOUT (§8.7). The block is the `Print` sheet's 72-row block over its
// 13 columns A–M, with the paper's width shares (E, F and G are each 19.71 characters — one `<col
// min="5" max="7">`), drawn as a CSS grid: every box sits at the paper's own cell range, with its
// borders (the paper's "medium", 1.5 px), its fills (labels `#BFBFBF`, the even cassettes'
// `#D9D9D9`) and its Calibri bold at the paper's Excel points × 0.41. The page is left-to-right, as
// on paper: each Arabic label sits to the right of its box.
//
// WHAT THE OWNER ACCEPTED ON IT (§2.1): the serial, the REPLENISHMENT date (not the print day), the
// run band, 4–8 cassette rows and which cassette goes in which bag — the bag column «الحقيبة» and
// split bag boxes when a line has two.
//
// MORE THAN FOUR CASSETTES (UI-14). n = the line's planned slots, k = max(0, n − 4). Paper row r
// prints at r for r ≤ 21, at r + 2k for 22 ≤ r ≤ 58, and at r + 4k for r ≥ 59; the filling rows are
// 14 … 13 + 2n and the unload rows 51 + 2k … 50 + 2k + 2n, two rows per cassette. The row unit
// shrinks to keep the block on one A4 page: u = min(3.75 mm, 270 mm / (72 + 4k)), fonts with it.
//
// WHAT IS NOT CARRIED: unused Notes printing 0s (only real lines print), 0/0 for a missing fourth
// cassette (only planned slots print), 0 for a blank bank (a blank prints blank).
import { fromMinorUnits, isPlanned, type AtmNotePrintDto, type AtmPlanSlot } from '@ecms/contracts';
import { formatPaperDate, formatPaperTimestamp, formatTime12 } from '../settlement-dates';
import { NOTE_WORDS } from './settlement-paper-wording';
import {
  esc,
  int,
  ltr,
  paperDocument,
  settlementPaperWords,
  type SettlementPaperWords,
} from './settlement-print';

type NoteLine = AtmNotePrintDto['notes'][number];

/** The `Print` sheet's column widths in characters (A … M), as shares of the block. */
export const NOTE_COLUMN_SHARES = [
  2.6, 6.6, 8.4, 6.2, 8.9, 8.9, 8.9, 5.7, 8.9, 11.6, 12.0, 8.8, 2.6,
] as const;
/** The block's width; columns A and M are gutters. */
export const NOTE_BLOCK_WIDTH_MM = 169;
const PAPER_ROWS = 72;
const ROW_MM = 3.75;
const BLOCK_HEIGHT_MM = 270;
/** The paper's Excel points × this = the printed points. */
const PT = 0.41;

const COLUMN = (letter: string): number => 'ABCDEFGHIJKLM'.indexOf(letter) + 1;

/** The geometry of one Note: how many cassettes, how far the lower half moves, the row unit. */
export const noteGeometry = (planned: number): { k: number; rows: number; unitMm: number } => {
  const k = Math.max(0, planned - 4);
  const rows = PAPER_ROWS + 4 * k;
  return { k, rows, unitMm: Math.min(ROW_MM, BLOCK_HEIGHT_MM / rows) };
};

/** Where paper row `r` prints on a Note whose lower half moved by `k` cassettes. */
export const noteRow = (r: number, k: number): number =>
  r <= 21 ? r : r <= 58 ? r + 2 * k : r + 4 * k;

interface Box {
  /** 'K5' or 'K5:L7', in printed rows. */
  from: readonly [string, number];
  to: readonly [string, number];
  inner: string;
  /** Excel points. */
  pt: number;
  cls?: string;
  rtl?: boolean;
}

const at = (c1: string, r1: number, c2: string = c1, r2: number = r1) =>
  ({ from: [c1, r1], to: [c2, r2] }) as const;

const boxHtml = (b: Box): string => {
  const area = `${String(b.from[1])} / ${String(COLUMN(b.from[0]))} / ${String(b.to[1] + 1)} / ${String(COLUMN(b.to[0]) + 1)}`;
  return `<div class="x${b.cls === undefined ? '' : ` ${b.cls}`}" style="grid-area: ${area}; font-size: calc(${String(b.pt)}pt * ${String(PT)} * var(--k));"${b.rtl === true ? ' dir="rtl"' : ''}>${b.inner}</div>`;
};

/** A bordered box; `lab` adds the label fill, `zeb` the even cassettes' fill. */
const bordered = (place: ReturnType<typeof at>, inner: string, pt: number, cls = ''): Box => ({
  ...place,
  inner,
  pt,
  cls: `bx${cls === '' ? '' : ` ${cls}`}`,
  rtl: true,
});

const label = (place: ReturnType<typeof at>, word: string, pt: number): Box =>
  bordered(place, esc(word), pt, 'lab');

/** A signature box: the words at its top, the space below for the stamp. */
const signature = (place: ReturnType<typeof at>, word: string): Box =>
  bordered(place, esc(word), 20, 'sig');

const plainNumber = (value: number): string => ltr(String(value));

/** The run band: «التغذية الثانية — الساعة 9:00 م»; the run alone without a time. */
const runBand = (line: NoteLine, words: SettlementPaperWords): string => {
  const time = formatTime12(line.scheduleTime, 'ar');
  return time === ''
    ? esc(words.run[line.run])
    : `${esc(words.run[line.run])} — ${esc(words.at)} ${esc(time)}`;
};

/** A box split in two for a line of two bags: «1» over «2». */
const bagHalves = (c1: string, c2: string, pt: number, bags: number): Box[] =>
  bags > 1
    ? [
        bordered(at(c1, 6, c2, 6), '<span class="mk">1</span>', pt),
        bordered(at(c1, 7, c2, 7), '<span class="mk">2</span>', pt),
      ]
    : [bordered(at(c1, 6, c2, 7), '', pt)];

const noteBoxes = (
  line: NoteLine,
  doc: Pick<AtmNotePrintDto, 'bankNameAr' | 'replenishDate' | 'printedAt'>,
  words: SettlementPaperWords,
): Box[] => {
  // Planned slots only (DS-4): the server sends no other, and a deposit, empty or foreign slot that
  // reached this far would still never print a cassette row.
  const slots: AtmPlanSlot[] = line.slots.filter(isPlanned).sort((a, b) => a.slot - b.slot);
  const n = slots.length;
  const { k } = noteGeometry(n);
  const R = (r: number): number => noteRow(r, k);
  const twoBags = line.bagCount > 1;
  const isSpare = line.kind === 'spare';
  const boxes: Box[] = [];
  const push = (...more: Box[]): void => {
    boxes.push(...more);
  };

  // Rows 1–3: the EGYCASH logo, the title in its box, the bank's Arabic name in the bank logo's box.
  push({ ...at('A', 1, 'D', 3), inner: '', pt: 24, cls: 'egc-logo' });
  push(bordered(at('E', 2, 'I', 3), esc(NOTE_WORDS.title), 26));
  push({ ...at('J', 1, 'L', 3), inner: esc(doc.bankNameAr), pt: 24, rtl: true });

  // Rows 5–7: bag lock · serial · bank (the type label) · area · bag return.
  push(
    label(at('K', 5, 'L', 5), NOTE_WORDS.bagLock, 24),
    label(at('J', 5), NOTE_WORDS.serial, 24),
    label(at('G', 5, 'I', 5), NOTE_WORDS.bank, 24),
    label(at('E', 5, 'F', 5), NOTE_WORDS.area, 24),
    label(at('B', 5, 'D', 5), NOTE_WORDS.bagReturn, 24),
    ...bagHalves('K', 'L', 24, line.bagCount),
    bordered(at('J', 6, 'J', 7), plainNumber(line.serial), 26),
    bordered(at('G', 6, 'I', 7), esc(line.typeLabel), 26),
    bordered(at('E', 6, 'F', 7), esc(line.hubLabel), 26),
    ...bagHalves('B', 'D', 24, line.bagCount),
  );

  // Rows 9–10: machine ID · machine name · the REPLENISHMENT date.
  push(
    label(at('L', 9, 'L', 10), NOTE_WORDS.machineId, 24),
    bordered(
      at('K', 9, 'K', 10),
      isSpare ? (line.spareCode === null ? '—' : ltr(line.spareCode)) : ltr(line.machineCode),
      26,
    ),
    label(at('J', 9, 'J', 10), NOTE_WORDS.machineName, 24),
    bordered(
      at('E', 9, 'I', 10),
      isSpare ? esc(`${words.spareSet} ${line.typeLabel ?? ''}`.trim()) : esc(line.machineName),
      26,
    ),
    label(at('D', 9, 'D', 10), NOTE_WORDS.date, 24),
    bordered(at('B', 9, 'C', 10), ltr(formatPaperDate(doc.replenishDate)), 24),
  );

  // Row 11: the run band (S-5).
  push({ ...at('B', 11, 'L', 11), inner: runBand(line, words), pt: 22, cls: 'band', rtl: true });

  // Rows 12–13: the filling section's headers.
  push(
    label(at('L', 12, 'L', 13), NOTE_WORDS.cassetteNo, 20),
    label(at('K', 12, 'K', 13), NOTE_WORDS.denomination, 20),
    label(at('J', 12, 'J', 13), NOTE_WORDS.noteCount, 20),
    label(at('G', 12, 'I', 13), NOTE_WORDS.cassetteLock, 20),
    ...(twoBags ? [label(at('F', 12, 'F', 13), words.bag, 20)] : []),
    label(at('E', 12, 'E', 13), NOTE_WORDS.camera, 20),
    bordered(at('D', 12, 'D', 13), '', 20),
    label(at('C', 12, 'C', 13), NOTE_WORDS.fillTime, 20),
    bordered(at('B', 12, 'B', 13), ':', 20),
  );

  // Rows 14 … 13 + 2n: one planned cassette per two rows, zebra on the even ones.
  slots.forEach((s, i) => {
    const r = 14 + 2 * i;
    const zebra = i % 2 === 1 ? 'zeb' : '';
    push(
      bordered(at('L', r, 'L', r + 1), plainNumber(s.slot), 36, zebra),
      bordered(at('K', r, 'K', r + 1), plainNumber(s.denomination ?? 0), 36, zebra),
      bordered(at('J', r, 'J', r + 1), ltr(int(s.notes)), 36, zebra),
      bordered(at('G', r, 'I', r + 1), '', 22, zebra),
      ...(twoBags ? [bordered(at('F', r, 'F', r + 1), plainNumber(s.bag ?? 0), 22, zebra)] : []),
    );
  });
  // The signature boxes stay anchored to row 14.
  push(signature(at('B', 15, 'E', 19), NOTE_WORDS.techSign));
  push(signature(at('B', 21, 'E', 25), NOTE_WORDS.supervisorStamp));

  // Rows 22–25: the machine total (EGP, converted once) and what the machine contains.
  push(
    {
      ...at('K', R(22), 'L', R(23)),
      inner: esc(NOTE_WORDS.machineTotal),
      pt: 22,
      cls: 'top',
      rtl: true,
    },
    {
      ...at('I', R(22), 'J', R(23)),
      inner: ltr(int(fromMinorUnits(line.egpTotalMinor))),
      pt: 28,
      cls: 'top',
    },
    {
      ...at('F', R(22), 'H', R(23)),
      inner: esc(NOTE_WORDS.egpOnly),
      pt: 24,
      cls: 'end',
      rtl: true,
    },
    label(at('J', R(24), 'L', R(25)), NOTE_WORDS.contains, 22),
    bordered(at('G', R(24), 'I', R(25)), esc(line.featuresLabel), 26),
  );

  // Rows 27–45: the deposit unload, printed blank as today (§1.3).
  push(
    label(at('B', R(27), 'L', R(27)), NOTE_WORDS.depositUnload, 20),
    signature(at('B', R(29), 'E', R(34)), NOTE_WORDS.unloadTechStamp),
    label(at('G', R(29), 'G', R(30)), NOTE_WORDS.envelopes, 20),
    label(at('I', R(29), 'I', R(30)), NOTE_WORDS.over, 20),
    label(at('J', R(29), 'J', R(30)), NOTE_WORDS.short, 20),
    label(at('K', R(29), 'K', R(30)), NOTE_WORDS.deposit, 20),
    label(at('L', R(29), 'L', R(30)), NOTE_WORDS.denominations, 20),
    bordered(at('G', R(32), 'G', R(41)), '', 20),
    signature(at('B', R(37), 'E', R(42)), NOTE_WORDS.supervisorStamp),
  );
  [5, 10, 20, 50, 100, 200].forEach((denomination, i) => {
    const r = R(31 + 2 * i);
    const zebra = i % 2 === 1 ? 'zeb' : '';
    push(
      bordered(at('L', r, 'L', r + 1), plainNumber(denomination), 36, zebra),
      bordered(at('K', r, 'K', r + 1), '', 36, zebra),
      bordered(at('J', r, 'J', r + 1), '', 36, zebra),
      bordered(at('I', r, 'I', r + 1), '', 36, zebra),
    );
  });
  push(
    label(at('L', R(44), 'L', R(45)), NOTE_WORDS.name, 22),
    bordered(at('J', R(44), 'K', R(45)), '', 22),
    label(at('I', R(44), 'I', R(45)), NOTE_WORDS.camera, 22),
    bordered(at('G', R(44), 'H', R(45)), '', 22),
    label(at('F', R(44), 'F', R(45)), NOTE_WORDS.time, 22),
    bordered(at('E', R(44), 'E', R(45)), ':', 22),
    label(at('D', R(44), 'D', R(45)), NOTE_WORDS.date, 22),
    bordered(at('B', R(44), 'C', R(45)), '<span class="pre">/         /   </span>', 22),
  );

  // Rows 47–58: the cassette unload, one row pair per planned cassette, blank.
  const unloadEnd = n > 4 ? 58 + 4 * k : 58;
  push(
    label(at('B', R(47), 'L', R(47)), NOTE_WORDS.cassetteUnload, 20),
    signature(at('B', R(49), 'C', unloadEnd), NOTE_WORDS.dataEntryStamp),
    label(at('E', R(49), 'E', R(50)), NOTE_WORDS.shortShort, 20),
    label(at('F', R(49), 'F', R(50)), NOTE_WORDS.overShort, 20),
    label(at('G', R(49), 'H', R(50)), NOTE_WORDS.total, 20),
    label(at('I', R(49), 'I', R(50)), NOTE_WORDS.divert, 20),
    label(at('J', R(49), 'J', R(50)), NOTE_WORDS.noteCount, 20),
    label(at('K', R(49), 'K', R(50)), NOTE_WORDS.denomination, 20),
    label(at('L', R(49), 'L', R(50)), NOTE_WORDS.cassetteNo, 20),
  );
  slots.forEach((s, i) => {
    const r = 51 + 2 * k + 2 * i;
    const zebra = i % 2 === 1 ? 'zeb' : '';
    push(
      bordered(at('L', r, 'L', r + 1), plainNumber(s.slot), 36, zebra),
      bordered(at('K', r, 'K', r + 1), plainNumber(s.denomination ?? 0), 36, zebra),
      bordered(at('J', r, 'J', r + 1), '', 36, zebra),
      bordered(at('I', r, 'I', r + 1), '', 36, zebra),
      bordered(at('G', r, 'H', r + 1), '', 36, zebra),
      bordered(at('F', r, 'F', r + 1), '', 36, zebra),
      bordered(at('E', r, 'E', r + 1), '', 36, zebra),
    );
  });

  // Rows 60–72: the cards, the result, the signatures, and the print stamp.
  push(
    bordered(at('J', R(60), 'K', R(61)), '', 20),
    label(at('L', R(60), 'L', R(61)), NOTE_WORDS.cards, 20),
    signature(at('B', R(62), 'F', R(66)), NOTE_WORDS.shiftManager),
    label(at('K', R(63), 'L', R(63)), NOTE_WORDS.result, 22),
    bordered(at('K', R(64)), '', 22),
    label(at('L', R(64)), NOTE_WORDS.match, 22),
    bordered(at('K', R(65)), '', 22),
    label(at('L', R(65)), NOTE_WORDS.overShort, 22),
    bordered(at('K', R(66)), '', 22),
    label(at('L', R(66)), NOTE_WORDS.shortShort, 22),
    signature(at('B', R(68), 'F', R(72)), NOTE_WORDS.reviewer),
    signature(at('J', R(68), 'L', R(72)), NOTE_WORDS.techAck),
    { ...at('G', R(72), 'I', R(72)), inner: ltr(formatPaperTimestamp(doc.printedAt)), pt: 20 },
  );
  return boxes;
};

/** One Note's page: the grid at its row unit, its fonts scaled to it. */
const notePage = (
  line: NoteLine,
  doc: Pick<AtmNotePrintDto, 'bankNameAr' | 'replenishDate' | 'printedAt'>,
  words: SettlementPaperWords,
): string => {
  const { rows, unitMm } = noteGeometry(line.slots.filter(isPlanned).length);
  const scale = Math.round((unitMm / ROW_MM) * 10_000) / 10_000;
  const unit = Math.round(unitMm * 10_000) / 10_000;
  return `<section class="page"><div class="note" style="--k: ${String(scale)}; grid-template-rows: repeat(${String(rows)}, ${String(unit)}mm);">${noteBoxes(line, doc, words).map(boxHtml).join('')}</div></section>`;
};

export const NOTE_STYLE = `  .note { display: grid; width: ${String(NOTE_BLOCK_WIDTH_MM)}mm; grid-template-columns: ${NOTE_COLUMN_SHARES.map((s) => `${String(s)}fr`).join(' ')}; direction: ltr; }
  .note .x { position: relative; display: flex; align-items: center; justify-content: center; text-align: center; overflow: hidden; font-weight: 700; line-height: 1.05; padding: 0 0.5mm; }
  .note .bx { outline: 1.5px solid #000; outline-offset: -0.75px; }
  .note .lab { background: #bfbfbf; }
  .note .zeb { background: #d9d9d9; }
  .note .sig { align-items: flex-start; padding-top: 0.6mm; }
  .note .top { border-top: 1.5px solid #000; }
  .note .end { justify-content: flex-end; padding-right: 1mm; }
  .note .band { letter-spacing: 0; }
  .note .mk { position: absolute; top: 0.2mm; right: 0.8mm; font-size: 70%; }
  .note .pre { white-space: pre; }
`;

/**
 * The Notes of one print, each its own page — `(dto, words) → string`, pure. `words` defaults to
 * the Arabic paper words, whatever the screen's language.
 */
export const buildNotesHtml = (
  dto: AtmNotePrintDto,
  words: SettlementPaperWords = settlementPaperWords(),
): string =>
  paperDocument({
    title: NOTE_WORDS.title,
    orientation: 'portrait',
    style: NOTE_STYLE,
    pages: dto.notes.map((line) => notePage(line, dto, words)).join('\n'),
    words,
    logo: true,
  });
