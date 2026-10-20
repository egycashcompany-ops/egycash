// The company's mobile lines — every number on the three networks' business accounts — registered,
// once, by the deploy. «الـ 3 فايلات دول عبارة عن خطوط موبايل عايز أعملهم صفحة لإدارتهم وتسليمهم».
//
// What the file says (`mobile-lines-import.ts`, reviewed with the owner) is what happens:
//   · every line is registered, on its network, in its branch;
//   · a line the review gave an employee is handed over to them, on an acknowledgment of its own —
//     ONE line per paper, as the hand-over screen prints it — the next numbers of the F-14 form;
//   · a tracker SIM is handed over to its car, written as the sheet writes it, on no paper;
//   · a line the network has stopped is suspended; everything else is in stock.
//
// ASKED OF THE LIVE SYSTEM, NOT ASSUMED. Branches are found by name in the organisation's list and
// never created; a missing or inactive one refuses the whole run before anything is written, and
// the next boot tries again. An employee HR does not know, or who has left, gets nothing — the line
// stays in stock and says who it was registered to. That name, like every name the line's notes
// give, is HR's, read here: the committed file names nobody (`mobile-lines-import.ts`). A number
// or a SIM serial the register already holds is a line somebody registered since the files were
// made: it is left alone, and reported — never an insert that fails the transaction on every boot
// for ever.
//
// ONE TRANSACTION, like the inventory: the lines, their custody, their history, the papers and
// their numbers and the run row commit together or not at all — a process killed half-way leaves
// nothing, and a second process racing the first conflicts and finds the run row on its retry.
// The audit rows follow the commit, as every custody write's do.
//
// NOT AFTER THE INVENTORY. Lines are not assets, so nothing the asset restart or the inventory
// decides can undo them; the two share only the receipt counter, whose block each takes inside its
// own transaction, so their numbers never collide whichever commits first.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Types } from 'mongoose';
import { isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { auditService } from '../../../platform/audit';
import { getDirectoryEmployeeByCode } from '../../../platform/directory';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { branchRepository } from '../../../platform/organization';
import { RECEIPT_SEQUENCE_KEY } from '../assets/receipt-number';
import { readReceiptHolder, type ReceiptHolder } from '../assets/receipt-holder';
import { signer } from '../assets/custody.service';
import { ItMobileLineModel, type ItMobileLineDoc } from '../mobile-lines/mobile-line.model';
import {
  ItMobileLineAssignmentModel,
  type ItMobileLineAssignmentDoc,
} from '../mobile-lines/line-assignment.model';
import { ItMobileLineEventModel } from '../mobile-lines/line-event.model';
import {
  ItMobileLineReceiptModel,
  type ItMobileLineReceiptDoc,
} from '../mobile-lines/line-receipt.model';
import { auditLineReceiptIssued, receiptLineOf } from '../mobile-lines/line-custody.service';
import { ensureItMobileLineCollections } from '../mobile-lines/line-history';
import { reserveSequenceBlock } from '../shared/sequence';
import {
  ensureItGoLiveRunIndexes,
  isItGoLiveRunDone,
  recordItGoLiveRun,
} from './go-live-run.model';
import { matchBranches, type InventoryBranch } from './inventory-import';
import { parseMobileLines, rowNamesCar, type MobileLineRow } from './mobile-lines-import';

/** The run key — versioned, so a second import is a decision and never a redeploy's accident. */
export const IT_MOBILE_LINES_MARK = 'go-live:it-mobile-lines-2026-10:v1';

export const MOBILE_LINES_FILE = 'mobile-lines-2026-10.json';

/** What the custody interval and the history say the line came from. */
export const MOBILE_LINES_NOTE = 'من ملفات خطوط المحمول للشبكات الثلاث — أكتوبر 2026';

/**
 * Where the committed file sits at run time: beside the bundle in the deployed image (`tsup`'s
 * `publicDir` copies `assets/` into `dist/`), four levels up under `tsx` — the inventory's two
 * places, each checked before it is used.
 */
const DATA_DIR_CANDIDATES = ['it-go-live', '../../../../assets/it-go-live'];

export const resolveMobileLinesFile = (): string | null => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of DATA_DIR_CANDIDATES) {
    const file = join(here, candidate, MOBILE_LINES_FILE);
    if (existsSync(file)) return file;
  }
  return null;
};

/** A line the review handed to an employee that stays in stock after all, and why. */
export interface HeldLine {
  key: string;
  holderCode: string;
  reason: 'unknownEmployee' | 'leftCompany';
}

/** A row left alone because the register already has its number or its card. */
export interface SkippedLine {
  key: string;
  field: 'phoneNumber' | 'simSerial';
  value: string;
}

export type MobileLinesOutcome =
  | { status: 'alreadyDone' }
  | { status: 'refused'; reason: string }
  | {
      status: 'done';
      lines: number;
      inStock: number;
      assigned: number;
      toEmployees: number;
      toCars: number;
      suspended: number;
      receipts: number;
      firstReceipt: number | null;
      lastReceipt: number | null;
      byNetwork: Record<string, number>;
      byBranch: Record<string, number>;
      skipped: SkippedLine[];
      held: HeldLine[];
    };

/** HR's answer for one code, read before the transaction. */
type HolderAnswer =
  | { kind: 'found'; employeeId: string; holder: ReceiptHolder }
  | { kind: 'unknown' }
  | { kind: 'exited'; name: string };

/**
 * What a line kept in stock says about the employee the review gave it — so the IT team can see
 * whom the network still has it registered to. The leaver's wording is the owner's own.
 */
const refusedNote = (code: string, answer: HolderAnswer): string | null => {
  if (answer.kind === 'exited') return `مسجّل باسم موظف ترك العمل: ${answer.name} (${code})`;
  if (answer.kind === 'unknown') return `مسجّل بكود موظف غير موجود في الموارد البشرية: ${code}`;
  return null;
};

/** HR's answer for a code a line nobody holds is registered to — only the name is wanted. */
type RegisteredAnswer =
  { kind: 'employed'; name: string } | { kind: 'exited'; name: string } | { kind: 'unknown' };

/**
 * Whom the network has a line nobody holds registered to, in HR's spelling: a leaver in the
 * owner's wording, anybody else as the network's own «مسجّل في الشبكة باسم».
 */
const registeredNote = (code: string, answer: RegisteredAnswer): string => {
  if (answer.kind === 'exited') return `مسجّل باسم موظف ترك العمل: ${answer.name} (${code})`;
  if (answer.kind === 'employed') return `مسجّل في الشبكة باسم: ${answer.name} (${code})`;
  return `مسجّل بكود موظف غير موجود في الموارد البشرية: ${code}`;
};

const joinNotes = (...parts: (string | null)[]): string | null => {
  const kept = parts.filter((part): part is string => part !== null && part !== '');
  return kept.length === 0 ? null : [...new Set(kept)].join('، ');
};

type Entry = {
  row: MobileLineRow;
  line: ItMobileLineDoc;
  assignment: ItMobileLineAssignmentDoc | null;
  employeeId: string | null;
};

/**
 * Run the import. Exported so a test can drive it against a real database with a file of its own;
 * the boot reads the committed one (`runItMobileLinesGoLive`).
 */
export const importItMobileLines = async (
  rows: readonly MobileLineRow[],
  at: Date = new Date(),
): Promise<MobileLinesOutcome> => {
  // 0. A run that is done is asked first, outside any transaction: it must not read the
  //    organisation and HR again on every boot, nor report «not imported» because a branch was
  //    renamed since. The check inside the transaction still settles two processes racing.
  if (await isItGoLiveRunDone(IT_MOBILE_LINES_MARK)) return { status: 'alreadyDone' };

  // 1. Branches, before anything is written: matched, never created.
  const branchMatches = matchBranches(
    (await branchRepository.listAll()).map((branch) => ({
      id: String(branch._id),
      name: branch.name,
      status: branch.status,
    })),
  );
  const branchIds = new Map<InventoryBranch, Types.ObjectId>();
  const unmatched: string[] = [];
  for (const [name, match] of branchMatches) {
    if (!rows.some((row) => row.branch === name)) continue;
    if (match.kind === 'found') branchIds.set(name, new Types.ObjectId(match.branch.id));
    else unmatched.push(`${name}: ${match.kind}`);
  }
  if (unmatched.length > 0) {
    return {
      status: 'refused',
      reason: `branches not found in the organisation: ${unmatched.join('; ')}`,
    };
  }

  // 2. The employees, by code — HR's answer is read before the transaction, as a hand-over reads
  //    it; who they are on the paper is the same snapshot a hand-over takes.
  const answers = new Map<string, HolderAnswer>();
  const codes = rows.flatMap((row) =>
    row.status === 'assigned' && row.holderCode !== null ? [row.holderCode] : [],
  );
  for (const code of new Set(codes)) {
    const employee = await getDirectoryEmployeeByCode(code);
    if (employee === null) answers.set(code, { kind: 'unknown' });
    else if (employee.status === 'exited') {
      answers.set(code, { kind: 'exited', name: employee.fullNameAr });
    } else {
      answers.set(code, {
        kind: 'found',
        employeeId: employee.employeeId,
        holder: await readReceiptHolder(employee.employeeId),
      });
    }
  }

  //    And the people the network has a line nobody holds registered to — their names only.
  const registeredTo = new Map<string, RegisteredAnswer>();
  for (const code of new Set(rows.flatMap((row) => row.registeredToCode ?? []))) {
    const employee = await getDirectoryEmployeeByCode(code);
    registeredTo.set(
      code,
      employee === null
        ? { kind: 'unknown' }
        : {
            kind: employee.status === 'exited' ? 'exited' : 'employed',
            name: employee.fullNameAr,
          },
    );
  }

  // 3. Every collection exists with its indexes before the transaction inserts into it — `autoIndex`
  //    is off in production, and an insert inside a transaction must not be what creates one.
  await Promise.all([ensureItMobileLineCollections(), ensureItGoLiveRunIndexes()]);

  const run = await unitOfWork(async (session) => {
    if (await isItGoLiveRunDone(IT_MOBILE_LINES_MARK, session)) {
      return { kind: 'alreadyDone' as const };
    }

    // A number or a card the register already holds is a line registered since the files were
    // made. Read inside the transaction, so a line registered a moment ago is seen too.
    const registered = await ItMobileLineModel.find({ isDeleted: false })
      .select({ phoneNumber: 1, simSerial: 1 })
      .session(session)
      .lean<Pick<ItMobileLineDoc, 'phoneNumber' | 'simSerial'>[]>()
      .exec();
    const takenNumbers = new Set(registered.map((line) => line.phoneNumber));
    const takenSerials = new Set(registered.flatMap((line) => line.simSerial ?? []));
    const skipped: SkippedLine[] = [];
    const fresh = rows.filter((row) => {
      if (takenNumbers.has(row.phoneNumber)) {
        skipped.push({ key: row.key, field: 'phoneNumber', value: row.phoneNumber });
        return false;
      }
      if (row.simSerial !== null && takenSerials.has(row.simSerial)) {
        skipped.push({ key: row.key, field: 'simSerial', value: row.simSerial });
        return false;
      }
      return true;
    });

    // Who actually receives a line — the employees HR still has, and the cars.
    const held: HeldLine[] = [];
    const entries: Entry[] = fresh.map((row) => {
      const answer = row.holderCode === null ? undefined : answers.get(row.holderCode);
      if (row.holderCode !== null && answer !== undefined && answer.kind !== 'found') {
        held.push({
          key: row.key,
          holderCode: row.holderCode,
          reason: answer.kind === 'exited' ? 'leftCompany' : 'unknownEmployee',
        });
      }
      const employeeId = answer?.kind === 'found' ? answer.employeeId : null;
      const toCar = row.status === 'assigned' && rowNamesCar(row);
      const handedOver = employeeId !== null || toCar;
      const status = row.status === 'assigned' && !handedOver ? 'inStock' : row.status;
      const line = {
        _id: new Types.ObjectId(),
        network: row.network,
        phoneNumber: row.phoneNumber,
        accountNumber: row.accountNumber,
        ratePlan: row.ratePlan,
        simKind: row.simKind,
        simSerial: row.simSerial,
        status,
        branchId: branchIds.get(row.branch) as Types.ObjectId,
        currentAssignmentId: handedOver ? new Types.ObjectId() : null,
        notes: joinNotes(
          row.note,
          row.holderCode === null || answer === undefined
            ? null
            : refusedNote(row.holderCode, answer),
          row.registeredToCode === null
            ? null
            : registeredNote(
                row.registeredToCode,
                registeredTo.get(row.registeredToCode) ?? { kind: 'unknown' },
              ),
        ),
      } as unknown as ItMobileLineDoc;
      const assignment = !handedOver
        ? null
        : ({
            _id: line.currentAssignmentId as Types.ObjectId,
            lineId: line._id,
            holderKind: employeeId === null ? 'vehicle' : 'employee',
            assignedToEmployeeId: employeeId === null ? null : new Types.ObjectId(employeeId),
            vehicleCode: employeeId === null ? row.vehicleCode : null,
            vehiclePlate: employeeId === null ? row.vehiclePlate : null,
            assignedByUserId: null,
            assignedAt: at,
            returnedAt: null,
            returnedToUserId: null,
            notes: MOBILE_LINES_NOTE,
            branchId: line.branchId,
            receiptId: employeeId === null ? null : new Types.ObjectId(),
          } as unknown as ItMobileLineAssignmentDoc);
      return { row, line, assignment, employeeId };
    });

    // ONE acknowledgment per line an employee receives, in the files' order — the numbers taken
    // inside the transaction, so a rollback gives every one of them back.
    const toEmployees = entries.filter((entry) => entry.employeeId !== null);
    const firstReceipt =
      toEmployees.length === 0
        ? null
        : await reserveSequenceBlock(RECEIPT_SEQUENCE_KEY, toEmployees.length, session);
    const formNumbers = new Map(
      toEmployees.map((entry, index) => [entry, (firstReceipt as number) + index]),
    );

    const events: Record<string, unknown>[] = [];
    const receipts: (Partial<ItMobileLineReceiptDoc> & { _id: Types.ObjectId })[] = [];
    // The history's own write: the go-live is nobody's hand, so no actor.
    const event = (line: ItMobileLineDoc, type: string, metadata: Record<string, unknown>) => {
      // The ids are taken in order: equal times are told apart by `_id`, so the register's
      // newest-first history shows the hand-over above the registration it follows.
      events.push({
        _id: new Types.ObjectId(),
        subjectId: line._id,
        type,
        at,
        actorUserId: null,
        actorName: '',
        metadata,
        notes: MOBILE_LINES_NOTE,
      });
    };
    for (const entry of entries) {
      const { row, line, assignment, employeeId } = entry;
      event(line, 'registered', { network: line.network, phoneNumber: line.phoneNumber });
      if (line.status === 'suspended')
        event(line, 'suspended', { from: 'inStock', to: 'suspended' });
      if (assignment === null) continue;

      const formNumber = formNumbers.get(entry) ?? null;
      const answer = row.holderCode === null ? undefined : answers.get(row.holderCode);
      const holder = answer?.kind === 'found' ? answer.holder : null;
      // Every key, null where it does not apply: the history reads one shape for both holders.
      event(line, 'assigned', {
        assignmentId: String(assignment._id),
        holderKind: assignment.holderKind,
        employeeId,
        employeeCode: holder?.employeeCode ?? null,
        employeeName: holder?.employeeName ?? null,
        vehicleCode: assignment.vehicleCode,
        vehiclePlate: assignment.vehiclePlate,
        receiptId: assignment.receiptId === null ? null : String(assignment.receiptId),
        formNumber,
      });
      if (holder !== null && employeeId !== null && assignment.receiptId !== null) {
        receipts.push({
          _id: assignment.receiptId,
          formNumber,
          employeeId: new Types.ObjectId(employeeId),
          ...signer(holder),
          issuedAt: at,
          issuedByUserId: null,
          branchId: line.branchId,
          line: receiptLineOf(line, assignment._id),
          signedCopy: null,
        });
      }
    }

    const assignments = entries.flatMap((entry) => entry.assignment ?? []);
    if (entries.length > 0) {
      await ItMobileLineModel.insertMany(
        entries.map((entry) => entry.line),
        { session },
      );
    }
    if (assignments.length > 0) {
      await ItMobileLineAssignmentModel.insertMany(assignments, { session });
    }
    if (events.length > 0) await ItMobileLineEventModel.insertMany(events, { session });
    if (receipts.length > 0) await ItMobileLineReceiptModel.insertMany(receipts, { session });

    const tally = (pick: (entry: Entry) => string): Record<string, number> => {
      const counts: Record<string, number> = {};
      for (const entry of entries) counts[pick(entry)] = (counts[pick(entry)] ?? 0) + 1;
      return counts;
    };
    const outcome = {
      lines: entries.length,
      inStock: entries.filter((entry) => entry.line.status === 'inStock').length,
      assigned: assignments.length,
      toEmployees: toEmployees.length,
      toCars: assignments.length - toEmployees.length,
      suspended: entries.filter((entry) => entry.line.status === 'suspended').length,
      receipts: receipts.length,
      firstReceipt,
      lastReceipt: firstReceipt === null ? null : firstReceipt + receipts.length - 1,
      byNetwork: tally((entry) => entry.row.network),
      byBranch: tally((entry) => entry.row.branch),
      skipped,
      held,
    };
    await recordItGoLiveRun(IT_MOBILE_LINES_MARK, outcome, session);
    return { kind: 'done' as const, outcome, entries, receipts };
  });

  if (run.kind === 'alreadyDone') return { status: 'alreadyDone' };

  // After the commit, as every custody write: the audit trail — and through it the realtime
  // refresh of anybody looking at the register.
  for (const { line, assignment } of run.entries) {
    await auditService.record({
      entityRef: { moduleId: 'it', entityType: 'mobileLine', entityId: String(line._id) },
      action: 'create',
      changes: [
        { field: 'phoneNumber', old: null, new: line.phoneNumber },
        { field: 'simSerial', old: null, new: line.simSerial },
        { field: 'status', old: null, new: line.status },
        { field: 'source', old: null, new: IT_MOBILE_LINES_MARK },
      ],
    });
    if (line.status === 'suspended') {
      await auditService.record({
        entityRef: { moduleId: 'it', entityType: 'mobileLine', entityId: String(line._id) },
        action: 'statusChange',
        changes: [{ field: 'status', old: 'inStock', new: 'suspended' }],
      });
    }
    if (assignment === null) continue;
    await auditService.record({
      entityRef: { moduleId: 'it', entityType: 'mobileLine', entityId: String(line._id) },
      action: 'assign',
      changes: [
        { field: 'status', old: 'inStock', new: 'assigned' },
        {
          field: 'holder',
          old: null,
          new:
            assignment.holderKind === 'employee'
              ? String(assignment.assignedToEmployeeId)
              : { vehicleCode: assignment.vehicleCode, vehiclePlate: assignment.vehiclePlate },
        },
      ],
    });
  }
  for (const receipt of run.receipts) {
    await auditLineReceiptIssued(
      receipt._id,
      String(receipt.employeeId),
      receipt.line?.phoneNumber ?? '',
    );
  }
  return { status: 'done', ...run.outcome };
};

/** Read the committed file and run it once; say what happened. Exported so a test can await it. */
export const runItMobileLinesGoLive = async (): Promise<void> => {
  const file = resolveMobileLinesFile();
  if (file === null) {
    logger.error(
      `it go-live: ${MOBILE_LINES_FILE} is not in the build — the mobile lines were not imported`,
    );
    return;
  }
  const { lines } = parseMobileLines(JSON.parse(await readFile(file, 'utf8')));
  const outcome = await importItMobileLines(lines);
  if (outcome.status === 'refused') {
    logger.warn(
      { reason: outcome.reason },
      'it go-live: the mobile lines were NOT imported — nothing was written; the next boot tries again',
    );
  } else if (outcome.status === 'done') {
    logger.warn(outcome, 'it go-live: the mobile lines were imported — done, and never again');
  }
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — the inventory's terms.
 */
export const startItMobileLinesGoLive = (): void => {
  if (isTest) return;
  void runItMobileLinesGoLive().catch((error: unknown) => {
    logger.error(
      { err: error },
      'it go-live: importing the mobile lines failed — no boot was harmed',
    );
  });
};
