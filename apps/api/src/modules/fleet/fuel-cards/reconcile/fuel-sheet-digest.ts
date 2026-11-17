// «مطابقة شيت شركة الوقود» on the fleet dashboard — one company's LAST read sheet, as it stood AT ITS
// READ: the stored session is the whole source, so a card that moved since never moves the figures
// (they change when a line is decided, or when a newer sheet is read). Pure, for its spec.
//
//   · `differing` — the session's balance LINES: the cards whose balance differed from the sheet's
//     when it was read («اختلف رصيدها عند القراءة»). Place differences, sheet-only and system-only
//     cards are not lines, and not here;
//   · `undecided` — of them, the lines with no decision yet; a line held back for the card-number
//     repair (`inRepair`) cannot be accepted, and while nobody refuses it, it is undecided too;
//   · `undecidedNet` — Σ (sheet − system) over the undecided lines, to the piastre, as at the read;
//   · `sheetDate` — «تاريخ الشيت» as written at the read; absent on a session read before it was
//     recorded, so `readDay` (the Cairo day of the read) stands in.
//
// Under a branch only the lines of the branch's cards count (`cardIds`); the sheet's day stays the
// company's.
import {
  cairoYmd,
  ymdOf,
  type FleetDashboardNowFuelSheetDto,
  type FleetFuelReconcileDecision,
} from '@ecms/contracts';
import { type Types } from 'mongoose';

/** What the digest reads of a stored session (the repository's projection). */
export interface FuelSheetSession {
  sheetDate?: Date | null;
  readAt: Date;
  lines?: {
    cardId: Types.ObjectId | string;
    sheetBalance: number;
    systemBalance: number;
    decision?: FleetFuelReconcileDecision | null;
    inRepair?: boolean;
  }[];
}

const piastres = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
};

export const sheetDigest = (
  session: FuelSheetSession,
  cardIds?: ReadonlySet<string>,
): FleetDashboardNowFuelSheetDto => {
  const lines = (session.lines ?? []).filter(
    (line) => cardIds === undefined || cardIds.has(String(line.cardId)),
  );
  const undecided = lines.filter((line) => (line.decision ?? null) === null);
  return {
    sheetDate:
      session.sheetDate === undefined || session.sheetDate === null
        ? null
        : ymdOf(session.sheetDate),
    readDay: cairoYmd(session.readAt),
    differing: lines.length,
    undecided: undecided.length,
    undecidedNet: piastres(
      undecided.reduce((sum, line) => sum + (line.sheetBalance - line.systemBalance), 0),
    ),
  };
};
