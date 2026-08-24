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
import { type AtmMailIngest, type AtmMailIngestResultDto } from '@ecms/contracts';
import { logger } from '../../../infrastructure/logging/logger';
import { ConflictError } from '../../../shared/errors';
import { AtmMachineModel, type AtmMachineDoc } from '../machines/machine.model';
import { atmMaintenanceRepository } from '../maintenances/maintenance.repository';
import { atmMailTicketRepository } from './mail-ticket.repository';
import { parseAtmMailBody } from './parse-mail';

/** System writes carry no user — the audit trail shows the platform actor, as sweeps do. */
const SYSTEM_ACTOR = null;

class AtmMailIngestionService {
  async ingest(message: AtmMailIngest): Promise<AtmMailIngestResultDto> {
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

    // The ingest-time flags, exactly as the legacy reader computed them (index.js:168-175):
    // found = the master lookup above succeeded; duplication = an open maintenance exists today.
    const duplicationAtIngest = await atmMaintenanceRepository.hasOpenToday(
      machine.branchId,
      machine.machineCode,
    );

    try {
      const ticket = await atmMailTicketRepository.create(
        {
          branchId: machine.branchId,
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
