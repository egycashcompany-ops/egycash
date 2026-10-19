// His scenario — the papers the owner approved, as data, for the papers' specs ONLY.
//
// No screen imports this file: «إعداد المذكرات» previews the latest saved memo or letter of that
// paper (or an empty paper), never these. It is his own papers' content, line for line, so the
// specs can pin every paper against what he signed off:
//   memo 1 كاوتش 1,690 (18 lines) · memo 3 وقود 49,844 (55) · memo 4 صيانة 5,720 (3)
//   memo 6 غسيل 600 (4)
//   29/09 استعاضة 81,908 · 05/10 شحن 200,000 · 05/10 تسوية 124,139.46
// The codes, missions and «البيان» lines are his, as he typed them.
import { DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES as SIGNATURES } from '@ecms/contracts';
import type {
  ChargeLetterInput,
  MemoPaperInput,
  MemoPaperLine,
  ReplenishLetterInput,
  SettleLetterInput,
} from './custody-papers';

/** Memo 1 — his tyres paper, line for line (18 lines, 1,690). */
const TYRES_1: [string, string, number][] = [
  ['248', '2026-09-01', 150],
  ['177', '2026-09-01', 80],
  ['182', '2026-09-02', 100],
  ['282', '2026-09-03', 50],
  ['177', '2026-09-04', 80],
  ['253', '2026-09-05', 120],
  ['260', '2026-09-05', 20],
  ['166', '2026-09-06', 200],
  ['207', '2026-09-07', 100],
  ['165', '2026-09-08', 230],
  ['177', '2026-09-09', 50],
  ['168', '2026-09-10', 100],
  ['182', '2026-09-11', 100],
  ['255', '2026-09-12', 10],
  ['276', '2026-09-13', 100],
  ['808', '2026-09-14', 100],
  ['259', '2026-09-15', 50],
  ['تويوتا 1', '2026-09-15', 50],
];

/** Memo 3 — his fuel paper's 55 lines in his order (49,844), with his missions. */
const FUEL_3: [string, string, number, string][] = [
  ['282', '2026-09-20', 1150, 'شلاتين'],
  ['282', '2026-09-15', 1347, 'شلاتين'],
  ['207', '2026-09-16', 1341, 'ATM'],
  ['282', '2026-09-28', 1320, 'شلاتين'],
  ['250', '2026-09-28', 920, 'شلاتين'],
  ['248', '2026-09-28', 1220, 'شلاتين'],
  ['304', '2026-09-22', 1035, 'شلاتين'],
  ['259', '2026-09-22', 870, 'شلاتين'],
  ['179', '2026-09-25', 800, 'ATM'],
  ['174', '2026-09-24', 860, 'ATM'],
  ['207', '2026-09-24', 1230, 'ATM'],
  ['297', '2026-09-28', 1450, 'ATM'],
  ['529', '2026-09-27', 735, 'نقل اموال'],
  ['241', '2026-09-09', 1015, 'اسيوط'],
  ['222', '2026-09-27', 1120, 'ATM'],
  ['279', '2026-09-27', 1000, 'شلاتين'],
  ['152', '2026-09-21', 500, 'ATM'],
  ['207', '2026-09-01', 1130, 'ATM'],
  ['296', '2026-09-01', 1230, 'شلاتين'],
  ['297', '2026-09-16', 815, 'شلاتين'],
  ['189', '2026-09-18', 785, 'ATM'],
  ['304', '2026-09-18', 840, 'شلاتين'],
  ['154', '2026-09-18', 1187, 'ATM'],
  ['فورتشنر', '2026-09-14', 1130, 'ملاكى'],
  ['226', '2026-09-13', 1100, 'ATM'],
  ['177', '2026-09-13', 1000, 'ATM'],
  ['216', '2026-09-13', 940, 'ATM'],
  ['804', '2026-09-17', 1043, 'ATM'],
  ['166', '2026-09-28', 1000, 'ATM'],
  ['178', '2026-09-28', 1040, 'ATM'],
  ['297', '2026-09-27', 440, 'شلاتين'],
  ['808', '2026-09-17', 1100, 'ATM'],
  ['296', '2026-09-01', 1075, 'شلاتين'],
  ['222', '2026-09-28', 721, 'ATM'],
  ['249', '2026-09-22', 500, 'شلاتين'],
  ['249', '2026-09-22', 1020, 'شلاتين'],
  ['168', '2026-09-22', 1060, 'ATM'],
  ['532', '2026-09-23', 110, 'نقل اموال'],
  ['297', '2026-09-21', 700, 'شلاتين'],
  ['168', '2026-09-23', 590, 'ATM'],
  ['جبلي', '2026-09-27', 300, 'ملاكى'],
  ['179', '2026-09-26', 800, 'ATM'],
  ['154', '2026-09-25', 1020, 'ATM'],
  ['231', '2026-09-25', 500, 'ATM'],
  ['231', '2026-09-24', 700, 'ATM'],
  ['231', '2026-09-21', 740, 'ATM'],
  ['154', '2026-09-23', 1200, 'ATM'],
  ['231', '2026-09-23', 750, 'ATM'],
  ['297', '2026-09-01', 380, 'شلاتين'],
  ['220', '2026-09-18', 921, 'ATM'],
  ['304', '2026-09-17', 780, 'شلاتين'],
  ['804', '2026-09-27', 1000, 'ATM'],
  ['150', '2026-09-28', 569, 'ATM'],
  ['804', '2026-09-01', 1205, 'ATM'],
  ['304', '2026-09-01', 510, 'شلاتين'],
];

/** Memo 4 — his maintenance paper: three lines, «البيان» exactly as he typed it (5,720). */
const MAINTENANCE_4: [string, string, number, string][] = [
  ['182', '2026-09-04', 5230, 'عدد 4 اكزز كنترول + 20 لمبة + 2 سكاكة زجاج + كيس الير'],
  ['207', '2026-09-09', 40, 'عدد 2 لمبة المانى'],
  ['248', '2026-09-13', 450, 'عدد 3 مروحة تكييف'],
];

/** Memo 6 — September's four washing receipts (600). */
const WASH_6: [string, string, number][] = [
  ['207', '2026-09-07', 150],
  ['248', '2026-09-14', 150],
  ['177', '2026-09-21', 200],
  ['282', '2026-09-28', 100],
];

export const SAMPLE_FUEL_LINES: readonly MemoPaperLine[] = FUEL_3.map(
  ([code, date, amount, mission]) => ({ code, date, amount, mission, note: '' }),
);

/** His four memo papers, with his default names. */
export const SAMPLE_MEMOS: Readonly<Record<MemoPaperInput['kind'], MemoPaperInput>> = {
  tyres: {
    kind: 'tyres',
    lines: TYRES_1.map(([code, date, amount]) => ({ code, date, amount })),
    signatures: SIGNATURES.tyres,
  },
  fuel: { kind: 'fuel', lines: SAMPLE_FUEL_LINES, signatures: SIGNATURES.fuel },
  maintenance: {
    kind: 'maintenance',
    lines: MAINTENANCE_4.map(([code, date, amount, statement]) => ({
      code,
      date,
      amount,
      statement,
      note: '',
    })),
    signatures: SIGNATURES.maintenance,
  },
  wash: {
    kind: 'wash',
    lines: WASH_6.map(([code, date, amount]) => ({ code, date, amount })),
    signatures: SIGNATURES.wash,
  },
};

/** 29/09 «استعاضه عهدة» — memos 1–5: كاوتش 2,650 · وقود 49,844 · صيانة 29,414 (81,908). */
export const SAMPLE_REPLENISH: ReplenishLetterInput = {
  kind: 'replenish',
  date: '2026-09-29',
  from: '2026-09-01',
  to: '2026-09-30',
  amount: 81908,
  custody: 100000,
  rows: [
    { kind: 'tyres', amount: 2650 },
    { kind: 'fuel', amount: 49844 },
    { kind: 'maintenance', amount: 29414 },
  ],
  signatures: SIGNATURES.replenish,
};

/** 05/10 «تسويه عهدة» — three renewals of five cars (124,139.46). */
export const SAMPLE_SETTLE: SettleLetterInput = {
  kind: 'settle',
  date: '2026-10-05',
  from: '2026-09-01',
  to: '2026-09-30',
  amount: 124139.46,
  // «إجمالي العهدة» just before it: 99,400 + the 200,000 charged that morning.
  custody: 299400,
  rows: [
    { part: 'renewal', cars: 5, amount: 39732.19 },
    { part: 'renewal', cars: 5, amount: 36768.85 },
    { part: 'renewal', cars: 5, amount: 47638.42 },
  ],
  signatures: SIGNATURES.settle,
};

/** 05/10 «صرف عهدة» — 200,000, with his reason. */
export const SAMPLE_CHARGE: ChargeLetterInput = {
  kind: 'charge',
  date: '2026-10-05',
  amount: 200000,
  reason: 'نظير 24 سياره تجديد + 23 سياره مد مده',
  signatures: SIGNATURES.charge,
};
