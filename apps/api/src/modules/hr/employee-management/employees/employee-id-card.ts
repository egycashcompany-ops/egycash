// The company ID card (كارنيه الشركة): what is printed on it, and every time it is printed.
//
// «عايزين عمود فيه أيقونة كارنيه … وعداد لعدد مرات طباعة الكارنيه … وفلتر للي اتطبعله كارنيه واللي لأ».
//
// PRINTING IS NOT RECEIVING. A print is paper — reprints, a jammed printer, a second try, or
// somebody pressing the button again — so it never counts as a card. The card counts when HR
// confirms the employee signed the receipt (إقرار الاستلام) and took it: `confirmHandover`, which
// moves `receivedCount` by exactly one per printed card, however many times that card was printed.
//
// Two stores, each for the question it answers:
//
//   * ON THE EMPLOYEE — `idCard`: how many times, the first time and the last time. The list needs
//     these on every row and filters and sorts on them across 1,760 people, so they sit on the
//     document the list already reads, moved by one atomic `$inc` per print.
//   * ITS OWN COLLECTION — one row per print, `hr_employee_id_card_prints`: who printed it and when,
//     numbered. The profile's history reads it; nothing else needs it.
//
// THE NATIONAL ID. The registry's rule is that `personal.nationalId` is stored raw and ALWAYS masked
// in DTOs (Security Architecture §3). The card is the one place it must appear whole: it is printed
// on the card itself. So it leaves through exactly one read, `cardData`, gated on
// `employee.editPersonal` within scope — the permission that may already type the number in — and
// every such read is audited as a `download`. No list or profile DTO carries it.
import { Schema, Types, model } from 'mongoose';
import {
  type EmployeeIdCardDataDto,
  type EmployeeIdCardPrintDto,
  type EmployeeIdCardSummaryDto,
  type EmployeePlacementUnitDto,
} from '@ecms/contracts';
import { auditService } from '../../../../platform/audit';
import { ConflictError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { EmployeeModel, type EmployeeDoc } from './employee.model';
import { employeeRepository } from './employee.repository';

interface IdCardPrintDoc {
  _id: Types.ObjectId;
  employeeId: Types.ObjectId;
  /** 1 for the first card this person ever got, 2 for the second, … */
  printNumber: number;
  printedAt: Date;
  printedBy: Types.ObjectId | null;
  /** Whether the card carried a photo, or went out with an empty frame. */
  withPhoto: boolean;
  /** Set once HR confirms this print was handed over: its number among cards RECEIVED. */
  receivedNumber?: number | null;
  receivedAt?: Date | null;
  receivedBy?: Types.ObjectId | null;
}

const idCardPrintSchema = new Schema<IdCardPrintDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    printNumber: { type: Number, required: true },
    printedAt: { type: Date, required: true },
    printedBy: { type: Schema.Types.ObjectId, default: null },
    withPhoto: { type: Boolean, required: true },
    receivedNumber: { type: Number, default: null },
    receivedAt: { type: Date, default: null },
    receivedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { versionKey: false },
);
idCardPrintSchema.index({ employeeId: 1, printedAt: -1 }, { name: 'ix_employee_printedAt' });

export const EmployeeIdCardPrintModel = model<IdCardPrintDoc>(
  'EmployeeIdCardPrint',
  idCardPrintSchema,
  'hr_employee_id_card_prints',
);

/** The printing user as stored — null for a caller whose id is not a user's (a system job). */
const actorId = (ctx: AuthContext): Types.ObjectId | null =>
  Types.ObjectId.isValid(ctx.userId) ? new Types.ObjectId(ctx.userId) : null;

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'employee', entityId: id });
const iso = (d: Date | null | undefined): string | null =>
  d === null || d === undefined ? null : d.toISOString();

/** The counters, read the same way for an employee printed often and one never printed at all. */
const idOf = (v: Types.ObjectId | null | undefined): string | null =>
  v === null || v === undefined ? null : String(v);

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

const toPrintDto = (row: IdCardPrintDoc): EmployeeIdCardPrintDto => ({
  id: String(row._id),
  printNumber: row.printNumber,
  printedAt: row.printedAt.toISOString(),
  printedBy: row.printedBy === null ? null : String(row.printedBy),
  withPhoto: row.withPhoto,
  receivedNumber: row.receivedNumber ?? null,
  receivedAt: iso(row.receivedAt),
  receivedBy: idOf(row.receivedBy),
});

export const employeeIdCardService = {
  /** Everything printed on the card, the full national ID among it — audited, see the top. */
  async cardData(
    ctx: AuthContext,
    id: string,
    scope: ScopeSelector,
    jobTitle: EmployeePlacementUnitDto | null,
    doc?: EmployeeDoc,
  ): Promise<EmployeeIdCardDataDto> {
    const employee = doc ?? (await employeeRepository.getById(id, scope));
    await auditService.record({
      entityRef: entityRef(id),
      action: 'download',
      changes: [{ field: 'idCard.data', old: null, new: 'read for the company ID card' }],
    });
    return {
      employeeId: String(employee._id),
      code: employee.code,
      employeeNumber: employee.employeeNumber,
      fullNameAr: employee.personal.fullNameAr,
      jobTitle: jobTitle === null ? null : jobTitle.name,
      nationalId: employee.personal.nationalId,
      hasPhoto: employee.personal.photoFileId !== null,
      summary: toIdCardSummaryDto(employee),
    };
  },

  /**
   * One print: the PRINT counter moves by one, atomically, the print gets its own numbered row, and
   * the card is marked as waiting for its handover. Cards received do not move — see the top.
   *
   * `$inc` rather than a read-modify-write, so two HR people printing the same card at once both
   * count. `$min` on the first print keeps the earliest date whatever order the writes land in; the
   * field is absent until then (never stored as null, which `$min` would keep forever).
   */
  async recordPrint(
    ctx: AuthContext,
    id: string,
    scope: ScopeSelector,
  ): Promise<EmployeeIdCardSummaryDto> {
    // Scope first: an employee outside it is a 404 here exactly as on every other employee route.
    const before = await employeeRepository.getById(id, scope);
    const now = new Date();
    const updated = await EmployeeModel.findOneAndUpdate(
      { _id: before._id },
      {
        $inc: { 'idCard.printCount': 1 },
        $min: { 'idCard.firstPrintedAt': now },
        $set: {
          'idCard.lastPrintedAt': now,
          'idCard.lastPrintedBy': actorId(ctx),
          'idCard.awaitingHandover': true,
        },
      },
      { new: true },
    ).lean<EmployeeDoc>();
    const summary = toIdCardSummaryDto(updated ?? before);
    await EmployeeIdCardPrintModel.create({
      employeeId: before._id,
      printNumber: summary.printCount,
      printedAt: now,
      printedBy: actorId(ctx),
      withPhoto: before.personal.photoFileId !== null,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'export',
      changes: [
        { field: 'idCard.printCount', old: summary.printCount - 1, new: summary.printCount },
      ],
    });
    return summary;
  },

  /**
   * The receipt (إقرار الاستلام) for the waiting card was printed: the handover's second step, kept
   * on the employee so closing and reopening the card does not lose it. Only a card waiting for its
   * handover has a receipt to print (a 409 otherwise); reprinting it moves the date, nothing more.
   */
  async recordReceipt(
    ctx: AuthContext,
    id: string,
    scope: ScopeSelector,
  ): Promise<EmployeeIdCardSummaryDto> {
    const before = await employeeRepository.getById(id, scope);
    const updated = await EmployeeModel.findOneAndUpdate(
      { _id: before._id, 'idCard.awaitingHandover': true },
      { $set: { 'idCard.receiptPrintedAt': new Date() } },
      { new: true },
    ).lean<EmployeeDoc>();
    if (updated === null) {
      throw new ConflictError(
        'No printed card is waiting to be handed over — print the card first',
      );
    }
    await auditService.record({
      entityRef: entityRef(id),
      action: 'export',
      changes: [
        { field: 'idCard.receipt', old: null, new: 'receipt printed for the employee to sign' },
      ],
    });
    return toIdCardSummaryDto(updated);
  },

  /**
   * HR confirms the employee signed the receipt and took the card: the one action that counts a card.
   *
   * Only a card printed since the last handover can be handed over — the condition is part of the
   * same atomic update, so a double click, two HR people at once, or a confirm with nothing printed
   * moves the count at most once (the rest are a 409). The newest unconfirmed print is the one marked.
   */
  async confirmHandover(
    ctx: AuthContext,
    id: string,
    scope: ScopeSelector,
  ): Promise<EmployeeIdCardSummaryDto> {
    const before = await employeeRepository.getById(id, scope);
    const now = new Date();
    const updated = await EmployeeModel.findOneAndUpdate(
      { _id: before._id, 'idCard.awaitingHandover': true },
      {
        $inc: { 'idCard.receivedCount': 1 },
        $min: { 'idCard.firstReceivedAt': now },
        $set: {
          'idCard.lastReceivedAt': now,
          'idCard.lastReceivedBy': actorId(ctx),
          'idCard.awaitingHandover': false,
        },
        // The next card starts its own handover: no receipt printed for it yet.
        $unset: { 'idCard.receiptPrintedAt': '' },
      },
      { new: true },
    ).lean<EmployeeDoc>();
    if (updated === null) {
      throw new ConflictError(
        'No printed card is waiting to be handed over — print the card first',
      );
    }
    const summary = toIdCardSummaryDto(updated);
    await EmployeeIdCardPrintModel.findOneAndUpdate(
      { employeeId: before._id, receivedAt: null },
      {
        $set: { receivedNumber: summary.receivedCount, receivedAt: now, receivedBy: actorId(ctx) },
      },
      { sort: { printedAt: -1 } },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        {
          field: 'idCard.receivedCount',
          old: summary.receivedCount - 1,
          new: summary.receivedCount,
        },
      ],
    });
    return summary;
  },

  /** Every print, newest first. Seeing it is seeing the employee. */
  async history(id: string, scope: ScopeSelector): Promise<EmployeeIdCardPrintDto[]> {
    const employee = await employeeRepository.getById(id, scope);
    const rows = await EmployeeIdCardPrintModel.find({ employeeId: employee._id })
      .sort({ printedAt: -1 })
      .limit(500)
      .lean<IdCardPrintDoc[]>();
    return rows.map(toPrintDto);
  },
};
