// The company ID card's DTOs: the counters that ride on every employee row, and one print's row in
// the profile's history. Dates are ISO strings and ids are strings, as everywhere else.
//
// Note what is NOT here: the national ID. It is printed on the card itself, so it leaves through
// exactly one read — `cardData` in `employee-id-card.service.ts` — and never through the summary
// that the list and the profile carry.
import { type Types } from 'mongoose';
import { type EmployeeIdCardPrintDto, type EmployeeIdCardSummaryDto } from '@ecms/contracts';
import { type EmployeeDoc } from './employee.model';
import { type IdCardPrintDoc } from './employee-id-card.model';

const iso = (d: Date | null | undefined): string | null =>
  d === null || d === undefined ? null : d.toISOString();

const idOf = (v: Types.ObjectId | null | undefined): string | null =>
  v === null || v === undefined ? null : String(v);

/** The counters, read the same way for an employee printed often and one never printed at all. */
export const toIdCardSummaryDto = (doc: Pick<EmployeeDoc, 'idCard'>): EmployeeIdCardSummaryDto => ({
  receivedCount: doc.idCard?.receivedCount ?? 0,
  firstReceivedAt: iso(doc.idCard?.firstReceivedAt),
  lastReceivedAt: iso(doc.idCard?.lastReceivedAt),
  lastReceivedBy: idOf(doc.idCard?.lastReceivedBy),
  awaitingHandover: doc.idCard?.awaitingHandover === true,
  receiptPrintedAt: iso(doc.idCard?.receiptPrintedAt),
  printCount: doc.idCard?.printCount ?? 0,
  firstPrintedAt: iso(doc.idCard?.firstPrintedAt),
  lastPrintedAt: iso(doc.idCard?.lastPrintedAt),
  lastPrintedBy:
    doc.idCard?.lastPrintedBy === null || doc.idCard?.lastPrintedBy === undefined
      ? null
      : String(doc.idCard.lastPrintedBy),
});

export const toPrintDto = (row: IdCardPrintDoc): EmployeeIdCardPrintDto => ({
  id: String(row._id),
  printNumber: row.printNumber,
  printedAt: row.printedAt.toISOString(),
  printedBy: row.printedBy === null ? null : String(row.printedBy),
  withPhoto: row.withPhoto,
  receivedNumber: row.receivedNumber ?? null,
  receivedAt: iso(row.receivedAt),
  receivedBy: idOf(row.receivedBy),
});
