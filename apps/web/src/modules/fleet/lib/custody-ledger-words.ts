// «سجل العهدة» in words — each line's «التفاصيل» (its title and the muted note under it), the
// count over the table, and the sentence that opens an operation's drawer — built from the facts
// the API sends with the line, never from anything the screen guesses.
//
//   شحن       «نظير تشغيل السيارات لشهر سبتمبر» / «خطاب «صرف عهدة»» — his reason comes back without
//             its «نظير» (the API drops it), so it is written back here, once.
//   استعاضة   «5 مذكرات: كاوتش، وقود، صيانة» / «عن الفترة من 2026/09/01 إلى 2026/09/30» — the kinds
//             in his letter's order, not the board's.
//   تسوية     «3 مصروفات تراخيص» / «تجديد تراخيص 15 سيارة».
//   صرف       «97 إيصالًا صُرفت من العهدة» / «كاوتش، وقود، صيانة، غسيل — في 5 مذكرات، منها 4 إيصالات لم
//             تدخل أي مذكرة بعد».
//
// React-free: the screen hands in its own `t`, its counts and its separator (`LedgerWordsKit`), so
// every word stays an i18n key and the node suite reads these directly.
import {
  FLEET_LICENSE_EXPENSE_KINDS,
  type FleetCustodyLedgerRowDto,
  type FleetCustodyOperationDto,
  type FleetCustodySource,
  type FleetLicenseExpenseKind,
} from '@ecms/contracts';
import { type CustodyCountForm, type CustodyCountNoun } from './custody-words';
import { byKindInLetterOrder, inLetterOrder, type KindShare } from './custody-fund-forms';

export interface LedgerWordsKit {
  t: (key: string, params?: Record<string, string | number>) => string;
  /** «5 مذكرات», «إيصالان» — `useCustodyCount().count`. */
  count: (noun: CustodyCountNoun, n: number) => string;
  /** The form a count takes — `useCustodyCount().form`. */
  form: (n: number) => CustodyCountForm;
  /** «15 سيارة» — the custody board's own count of cars. */
  cars: (n: number) => string;
  /** «، » in Arabic. */
  separator: string;
  /** A day as the boards write it — «2026/09/01». */
  day: (iso: string) => string;
}

const LEDGER = 'fleet.custody.ledger';

/** «3 مصروفات تراخيص» — licence parts, as the approved ledger counts them. */
export const partsPhrase = (n: number, kit: LedgerWordsKit): string =>
  kit.t(`${LEDGER}.parts.${kit.form(n)}`, { count: new Intl.NumberFormat('en-US').format(n) });

/** «كاوتش، وقود، صيانة» — the kinds in his letter's order. */
export const kindsPhrase = (kinds: readonly FleetCustodySource[], kit: LedgerWordsKit): string =>
  inLetterOrder(kinds)
    .map((kind) => kit.t(`fleet.custody.source.${kind}`))
    .join(kit.separator);

/** «تجديد تراخيص 15 سيارة، مد مدة 23 سيارة» — each part kind a settlement holds, renewal first. */
export const licencePhrase = (
  licence: Partial<Record<FleetLicenseExpenseKind, { count: number; cars: number }>>,
  kit: LedgerWordsKit,
): string =>
  FLEET_LICENSE_EXPENSE_KINDS.flatMap((kind) => {
    const part = licence[kind];
    return part === undefined || part.count === 0
      ? []
      : [
          kit.t(`${LEDGER}.detail.licence`, {
            kind: kit.t(`fleet.licenseExpenses.kinds.${kind}`),
            cars: kit.cars(part.cars),
          }),
        ];
  }).join(kit.separator);

/** «عن الفترة من … إلى …» — or nothing, for a line with no period. */
export const periodPhrase = (
  from: string | null,
  to: string | null,
  kit: LedgerWordsKit,
): string =>
  from === null && to === null
    ? ''
    : kit.t(`${LEDGER}.detail.period`, {
        from: kit.day(from ?? to ?? ''),
        to: kit.day(to ?? from ?? ''),
      });

/** «نظير …» — his reason with the word the API took off it; none, the action's own name. */
export const chargeTitle = (reason: string | null, kit: LedgerWordsKit): string => {
  const typed = (reason ?? '').trim();
  return typed === ''
    ? kit.t('fleet.custody.actions.charge')
    : kit.t(`${LEDGER}.detail.chargeFor`, { reason: typed });
};

const spendTitle = (receipts: number, kit: LedgerWordsKit): string =>
  kit.t(`${LEDGER}.detail.spend.${kit.form(receipts)}`, {
    count: new Intl.NumberFormat('en-US').format(receipts),
  });

const spendNote = (row: FleetCustodyLedgerRowDto, kit: LedgerWordsKit): string => {
  const byKind = row.byKind;
  if (byKind === null) return '';
  const kinds = (Object.keys(byKind) as FleetCustodySource[]).filter(
    (kind) => byKind[kind].count > 0,
  );
  const receipts = row.receipts ?? 0;
  const outside = Object.values(byKind).reduce((sum, kind) => sum + kind.outside, 0);
  const memos = row.memoNos?.length ?? 0;
  const where = [
    memos > 0 ? kit.t(`${LEDGER}.detail.inMemos`, { memos: kit.count('memo', memos) }) : null,
    outside > 0 && outside >= receipts
      ? kit.t(`${LEDGER}.detail.allOutside`)
      : outside > 0
        ? kit.t(`${LEDGER}.detail.outside`, { count: kit.count('receipt', outside) })
        : null,
  ].filter((part): part is string => part !== null);
  const head = kindsPhrase(kinds, kit);
  return where.length === 0 ? head : `${head} — ${where.join(kit.separator)}`;
};

/** A ledger line's «التفاصيل»: its title and the note under it. */
export const ledgerWords = (
  row: FleetCustodyLedgerRowDto,
  kit: LedgerWordsKit,
): { title: string; note: string } => {
  switch (row.op) {
    case 'charge':
      return { title: chargeTitle(row.reason, kit), note: kit.t(`${LEDGER}.detail.chargeNote`) };
    case 'replenish':
      return {
        title: kit.t(`${LEDGER}.detail.replenish`, {
          memos: kit.count('memo', row.memos?.count ?? 0),
          kinds: kindsPhrase(row.memos?.kinds ?? [], kit),
        }),
        note: periodPhrase(row.from, row.to, kit),
      };
    case 'settle': {
      const licence: Partial<Record<FleetLicenseExpenseKind, { count: number; cars: number }>> =
        row.licence ?? {};
      const parts = FLEET_LICENSE_EXPENSE_KINDS.reduce(
        (sum, kind) => sum + (licence[kind]?.count ?? 0),
        0,
      );
      return { title: partsPhrase(parts, kit), note: licencePhrase(licence, kit) };
    }
    case 'spend':
      return { title: spendTitle(row.receipts ?? 0, kit), note: spendNote(row, kit) };
  }
};

/** «4 عمليات + سطرا مصروفات» — what the filters match, as the pager under it counts the rows. */
export const ledgerCount = (
  totals: { operations: number; spendLines: number },
  kit: LedgerWordsKit,
): string => {
  if (totals.spendLines === 0) return kit.count('operation', totals.operations);
  if (totals.operations === 0) return kit.count('spendLine', totals.spendLines);
  return kit.t(`${LEDGER}.countBoth`, {
    operations: kit.count('operation', totals.operations),
    spendLines: kit.count('spendLine', totals.spendLines),
  });
};

/**
 * The sentence that opens an operation's drawer — «استُعيض إلى العهدة مبلغ 81,908.00 ج.م. نظير 5
 * مذكرات (كاوتش، وقود، صيانة) عن الفترة من 2026/09/01 إلى 2026/09/30.». `money` writes the amount
 * as the boards do («81,908.00 ج.م.»).
 */
export const operationIntro = (
  op: FleetCustodyOperationDto,
  kit: LedgerWordsKit,
  money: (value: number) => string,
): string => {
  const amount = money(op.amount);
  // «… (كاوتش، وقود) عن الفترة من … إلى ….» — or the sentence ends at its kinds.
  const phrase = periodPhrase(op.from, op.to, kit);
  const period = phrase === '' ? '' : ` ${phrase}`;
  switch (op.kind) {
    case 'charge': {
      const reason = op.reason.trim();
      return reason === ''
        ? kit.t(`${LEDGER}.drawer.intro.charge`, { amount })
        : kit.t(`${LEDGER}.drawer.intro.chargeFor`, {
            amount,
            reason: chargeTitle(reason, kit),
          });
    }
    case 'replenish':
      return kit.t(`${LEDGER}.drawer.intro.replenish`, {
        amount,
        memos: kit.count('memo', op.memos.length),
        kinds: kindsPhrase(
          op.memos.map((memo) => memo.kind),
          kit,
        ),
        period,
      });
    case 'settle': {
      const licence: Partial<Record<FleetLicenseExpenseKind, { count: number; cars: number }>> = {};
      for (const part of op.parts) {
        const held = licence[part.part] ?? { count: 0, cars: 0 };
        licence[part.part] = { count: held.count + 1, cars: held.cars + part.cars };
      }
      return kit.t(`${LEDGER}.drawer.intro.settle`, {
        amount,
        parts: partsPhrase(op.parts.length, kit),
        kinds: licencePhrase(licence, kit),
        period,
      });
    }
  }
};

/** The memos a replenishment took back, per kind in his letter's order, with their numbers. */
export const replenishedByKind = (memos: FleetCustodyOperationDto['memos']): KindShare[] =>
  byKindInLetterOrder(memos.map((memo) => ({ kind: memo.kind, no: memo.no, total: memo.amount })));
