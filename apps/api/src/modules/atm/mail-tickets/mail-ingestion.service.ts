// The ingestion seam — what the CENTRAL mail reader calls per message (port doc §9).
//
// The legacy ran ONE reader PER BRANCH (Automation/src/index.js, one deployment per mailbox),
// each matching machine codes against its own branch's master. The central model inverts that:
// one reader, one call per message, and THE MACHINE DECIDES THE BRANCH — the code is looked up
// across branches and the ticket is filed under the machine's `branchId`. That is the whole
// "يصنف الرسائل حسب Branch" requirement, expressed as data the master already holds.
//
// What the caller (the transport) does with the result:
//   created          → mark the message read + assign the BRANCH's colour category
//   duplicateMessage → mark read (already ingested — a retry after a half-failure)
//   unmatched        → LEAVE THE MESSAGE UNREAD (the owner's rule: unmatched mail stays visible
//                      in the mailbox). The legacy dropped these silently (index.js:199-201);
//                      the outcome names the reason instead.
//
// This service is the ONLY writer of tickets. The transport that feeds it is deliberately kept
// outside: `mail-source.ts` is the mailbox seam and `mail-poll.service.ts` the loop, so swapping
// Microsoft Graph for IMAP — or for n8n posting in once A-6b lands — moves nothing in here.
//
// The machine's branch is read as ATM files it (`atm.branchLinks`): a machine still filed under a
// linked source is its target's, so its mail is switched on, filed and coloured as the target's.
// The owner (2026-10-28) saw a Mohandessin machine's mail only under «كل الشركة»: it was filed
// under the linked October, which nobody is answered as any more (link-context.ts).
import { type AtmMailIngest, type AtmMailIngestResultDto } from '@ecms/contracts';
import { Types } from 'mongoose';
import { logger } from '../../../infrastructure/logging/logger';
import { ConflictError } from '../../../shared/errors';
import { AtmMachineModel, type AtmMachineDoc } from '../machines/machine.model';
import { atmMaintenanceRepository } from '../maintenances/maintenance.repository';
import { linkedBranchOf, loadAtmBranchLinks } from '../shared/atm-context';
import { openDayOf } from '../shared/open-operation';
import { atmMailTicketRepository } from './mail-ticket.repository';
import { parseAtmMailBody } from './parse-mail';

/** System writes carry no user — the audit trail shows the platform actor, as sweeps do. */
const SYSTEM_ACTOR = null;

/** The outcome reason for a machine whose branch the mailbox document has not switched on. */
export const BRANCH_NOT_ENABLED_REASON = 'branch not enabled for mail';

/**
 * Which branches may receive tickets. Absent = every branch (the environment mode, as before);
 * present = only these — the mailbox document's switched-on branches (mailbox-source.ts), as ATM
 * files them (a linked source's row switches its target on).
 */
export interface AtmMailIngestGate {
  branchIds: ReadonlySet<string>;
}

class AtmMailIngestionService {
  async ingest(message: AtmMailIngest, gate?: AtmMailIngestGate): Promise<AtmMailIngestResultDto> {
    const existing = await atmMailTicketRepository.findByProviderMessageId(
      message.providerMessageId,
    );
    if (existing !== null) {
      return {
        outcome: 'duplicateMessage',
        ticketId: String(existing._id),
        branchId: String(existing.branchId),
        reason: null,
      };
    }

    const parsed = parseAtmMailBody(message.bodyText);
    if (parsed.machineCode === null || parsed.issueText === null) {
      return {
        outcome: 'unmatched',
        ticketId: null,
        branchId: null,
        reason:
          parsed.machineCode === null ? 'no machine code recognized' : 'no issue text recognized',
      };
    }

    // Active machines with this code, across every branch. The legacy could not be ambiguous —
    // each branch matched only its own master — so a code active in two branches is a situation
    // with no legacy answer, and refusing to guess (leaving the mail unread and visible) is the
    // only move that cannot misfile a ticket.
    const machines = await AtmMachineModel.find({
      isDeleted: false,
      isActive: true,
      machineCode: parsed.machineCode,
    })
      .lean<AtmMachineDoc[]>()
      .exec();
    if (machines.length === 0) {
      return {
        outcome: 'unmatched',
        ticketId: null,
        branchId: null,
        reason: `no active machine with code ${parsed.machineCode}`,
      };
    }
    if (machines.length > 1) {
      return {
        outcome: 'unmatched',
        ticketId: null,
        branchId: null,
        reason: `machine code ${parsed.machineCode} is active in ${String(machines.length)} branches`,
      };
    }
    const machine = machines[0] as AtmMachineDoc;
    const branchId = linkedBranchOf(await loadAtmBranchLinks(), String(machine.branchId));

    // Still the machine that decides the branch — the gate only says whether that branch takes mail
    // yet. The owner switches branches on one at a time («هنبدأ بفرع المهندسين حالياً وبعدين هنبقى
    // نزود فرع فرع»), and mail for a branch not on yet is NOT ECMS's: it stays unread for whoever
    // still reads that mailbox by hand, and the first run after the branch is switched on files it.
    if (gate !== undefined && !gate.branchIds.has(branchId)) {
      return {
        outcome: 'unmatched',
        ticketId: null,
        branchId: null,
        reason: BRANCH_NOT_ENABLED_REASON,
      };
    }

    // The ingest-time flags, as the legacy reader computed them (index.js:168-175): found = the
    // master lookup above succeeded; duplication = the machine already has an open maintenance.
    // The owner's rule (OD-1) made duplication mean exactly what accept refuses — an open
    // maintenance, in any branch, on the day the mail was received (the day accept opens it on,
    // D6; per day since 2026-10-27) — and the stored value the log page shows asks the same
    // question the pending screen does.
    const duplicationAtIngest = await atmMaintenanceRepository.hasOpenOperation(
      machine.machineCode,
      openDayOf(message.receivedAt),
    );

    try {
      const ticket = await atmMailTicketRepository.create(
        {
          branchId: new Types.ObjectId(branchId),
          machineId: machine._id,
          machineCode: machine.machineCode,
          bankName: machine.bankName,
          machineName: machine.name,
          area: machine.area,
          receivedAt: message.receivedAt,
          status: 'pending',
          issueText: parsed.issueText,
          senderEmail: message.senderEmail,
          foundInMaster: true,
          duplicationAtIngest,
          actionById: null,
          actionByName: null,
          actionAt: null,
          providerMessageId: message.providerMessageId,
        },
        { by: SYSTEM_ACTOR },
      );
      return {
        outcome: 'created',
        ticketId: String(ticket._id),
        branchId: String(ticket.branchId),
        reason: null,
      };
    } catch (error) {
      // Two deliveries racing past the read above land here — the unique index holds.
      if (error instanceof ConflictError) {
        const winner = await atmMailTicketRepository.findByProviderMessageId(
          message.providerMessageId,
        );
        return {
          outcome: 'duplicateMessage',
          ticketId: winner === null ? null : String(winner._id),
          branchId: winner === null ? null : String(winner.branchId),
          reason: null,
        };
      }
      logger.error(
        { err: error, providerMessageId: message.providerMessageId },
        'atm mail ingest failed',
      );
      throw error;
    }
  }
}

export const atmMailIngestionService = new AtmMailIngestionService();
