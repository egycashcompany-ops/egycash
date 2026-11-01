// «مطابقة أرصدة الكروت» — a company's balance sheet against its cards, and the ✓ / ✗ on them.
//
// READ: the sheet is read in memory, compared with the company's live cards, and the comparison is
// stored as a session. No card and no movement is written.
//
// DECIDE: one transaction, all or nothing, from the stored session only — the sheet's figure and
// the balance the card held at the read come from the session, never from the request body.
//   ✓ (`apply`) sets the card's balance to the sheet's, with its own `sheetAdjust` log line. It is
//     an adjustment, not a charge: `lastChargedAt`, «charged today» and the charge request are
//     untouched. THE OWNER'S SAFETY RULE: when any chosen card's balance moved after the sheet was
//     read — or any line of its log was written, edited or removed since — nothing is applied, and
//     every such card is named (409) so the sheet is read again.
//   ✗ (`reject`) changes no balance; it records the refusal as a `sheetReject` line of amount 0
//     with the card's balance as it is. Only a card that is gone refuses it.
// A line is decided once. After the commit each card's audit row is written on `fleet.fuelCard`,
// which the cards and charging screens already follow.
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import {
  ErrorCodes,
  type DecideFleetFuelReconcile,
  type FleetFuelCardCompany,
  type FleetFuelReconcileDto,
  type FleetFuelReconcileResultDto,
} from '@ecms/contracts';
import { AppError, NotFoundError, ValidationError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import { fleetVehicleRepository } from '../../vehicles/vehicle.repository';
import { actorNameOf } from '../../fleet-actor-name';
import { fleetFuelCardMovementRepository, fleetFuelCardRepository } from '../fuel-card.repository';
import { type FleetFuelCardDoc } from '../fuel-card.model';
import { fuelCardEntityRef, toFuelCardDto } from '../fuel-card.service';
import { readFuelSheet } from './read-fuel-sheet';
import { compareFuelSheet, type ReconcileMatch } from './compare-fuel-sheet';
import { fleetFuelReconciliationRepository } from './fuel-reconcile.repository';
import { type FleetFuelReconcileLine } from './fuel-reconcile.model';

const piastres = (egp: number): number => Math.round(egp * 100);

/** 409 naming every card, one detail each — the shape the screen reads (`ErrorCodes` docs). */
const refusal = (
  code:
    | typeof ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED
    | typeof ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED,
  cardIds: readonly string[],
): AppError => {
  const changed = code === ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED;
  return new AppError(
    code,
    409,
    changed
      ? 'a card changed after the sheet was read — nothing was written; read the sheet again'
      : 'a card was already decided on this sheet — nothing was written',
    {
      details: cardIds.map((cardId) => ({
        field: 'cardIds',
        code: changed ? 'CARD_CHANGED' : 'DECIDED',
        message: cardId,
      })),
    },
  );
};

interface Decided {
  line: FleetFuelReconcileLine;
  before: number;
  after: number;
}

class FleetFuelReconcileService {
  /** Read a sheet and store the comparison. Writes the session only. */
  async read(
    ctx: AuthContext,
    input: { company: FleetFuelCardCompany; fileName: string; buffer: Buffer },
  ): Promise<FleetFuelReconcileDto> {
    const fileSha256 = createHash('sha256').update(input.buffer).digest('hex');
    const sheet = await readFuelSheet(input.buffer);
    // BEFORE the cards are read: anything that moves a card from here on refuses its ✓.
    const readAt = new Date();
    const cards = await fleetFuelCardRepository.liveOfCompany(input.company);
    const plan = compareFuelSheet({
      rows: sheet.rows,
      invalid: sheet.invalid,
      cards: cards.map((card) => ({
        id: String(card._id),
        name: card.name,
        number: card.number,
        balance: card.balance,
      })),
    });
    const matches = [...plan.differs, ...plan.equal];
    const session = await fleetFuelReconciliationRepository.create(
      {
        company: input.company,
        fileName: input.fileName,
        fileSha256,
        readAt,
        rowsRead: sheet.rowsRead,
        sheetCompany: plan.sheetCompany,
        lines: plan.differs.map((match) => ({
          cardId: new Types.ObjectId(match.cardId),
          name: match.sheet.name,
          sheetRow: match.sheet.row,
          sheetNumber: match.sheet.number,
          sheetBalance: match.sheet.balance,
          systemBalance: match.systemBalance,
          numberMatches: match.numberMatches,
          decision: null,
          decidedAt: null,
          decidedBy: null,
          movementId: null,
        })),
        counts: {
          equal: plan.equal.length,
          sheetOnly: plan.sheetOnly.length,
          systemOnly: plan.systemOnly.length,
          duplicates: plan.duplicates.length,
          conflicts: plan.conflicts.length,
          numbersDiffer: matches.filter((match) => !match.numberMatches).length,
        },
      },
      { by: ctx.userId },
    );

    const byId = new Map(cards.map((card) => [String(card._id), card]));
    const codes = await fleetVehicleRepository.codesByIds([
      ...new Set(cards.flatMap((card) => (card.vehicleId == null ? [] : [String(card.vehicleId)]))),
    ]);
    const cardDto = (card: FleetFuelCardDoc) =>
      toFuelCardDto({ doc: card, vehicleCode: codes.get(String(card.vehicleId)) ?? null });
    const lineDto = (match: ReconcileMatch) => ({
      card: cardDto(byId.get(match.cardId) as FleetFuelCardDoc),
      sheet: match.sheet,
      difference: match.difference,
      numberMatches: match.numberMatches,
    });
    return {
      id: String(session._id),
      company: input.company,
      fileName: input.fileName,
      fileSha256,
      rows: sheet.rowsRead,
      readAt: readAt.toISOString(),
      sheetCompany: plan.sheetCompany,
      differs: plan.differs.map(lineDto),
      equal: plan.equal.map(lineDto),
      sheetOnly: plan.sheetOnly,
      systemOnly: plan.systemOnly.map((id) => cardDto(byId.get(id) as FleetFuelCardDoc)),
      duplicates: plan.duplicates,
      conflicts: plan.conflicts,
    };
  }

  /** ✓ or ✗ on chosen cards of one session — all of them, or none. */
  async decide(
    ctx: AuthContext,
    id: string,
    input: DecideFleetFuelReconcile,
  ): Promise<FleetFuelReconcileResultDto[]> {
    const by = ctx.userId;
    // Each card once, however its id is spelled (the schema refuses a repeat; this is the floor).
    const cardIds = [...new Set(input.cardIds.map((cardId) => cardId.toLowerCase()))];
    let sessionId = '';
    let decided: Decided[] = [];
    let at = new Date();
    await unitOfWork(async (session) => {
      // A retried transaction starts over from nothing.
      decided = [];
      const reading = await fleetFuelReconciliationRepository.findLive(id, session);
      if (reading === null) throw new NotFoundError();
      sessionId = String(reading._id);
      const lines = new Map(reading.lines.map((line) => [String(line.cardId), line]));

      // Only a card the sheet DIFFERS on may be named — never an equal card, another company's,
      // or a row in conflict.
      const notInSheet = cardIds.filter((cardId) => !lines.has(cardId));
      if (notInSheet.length > 0) {
        throw new ValidationError(
          notInSheet.map((cardId) => ({
            field: 'body.cardIds',
            code: 'NOT_IN_SHEET',
            message: cardId,
          })),
        );
      }
      const already = cardIds.filter((cardId) => lines.get(cardId)?.decision != null);
      if (already.length > 0) throw refusal(ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED, already);

      const live = new Map(
        (await fleetFuelCardRepository.liveByIds(cardIds, session)).map((card) => [
          String(card._id),
          card,
        ]),
      );
      const moved =
        input.decision === 'apply'
          ? await fleetFuelCardMovementRepository.cardsMovedSince(cardIds, reading.readAt, session)
          : new Set<string>();
      const changed = cardIds.filter((cardId) => {
        const card = live.get(cardId);
        if (card === undefined) return true; // gone — refuses ✓ and ✗ alike
        if (input.decision === 'reject') return false; // ✗ moves nothing
        const line = lines.get(cardId) as FleetFuelReconcileLine;
        return (
          card.company !== reading.company ||
          piastres(card.balance) !== piastres(line.systemBalance) ||
          moved.has(cardId)
        );
      });
      if (changed.length > 0) throw refusal(ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED, changed);

      at = new Date();
      for (const cardId of cardIds) {
        const card = live.get(cardId) as FleetFuelCardDoc;
        const line = lines.get(cardId) as FleetFuelReconcileLine;
        const apply = input.decision === 'apply';
        const after = apply ? line.sheetBalance : card.balance;
        if (apply) {
          // Version-checked: a card written since this transaction read it is not overwritten.
          await fleetFuelCardRepository.updateById(
            cardId,
            { balance: after },
            { by, version: card.__v, session },
          );
        }
        const movement = await fleetFuelCardMovementRepository.create(
          {
            cardId: card._id,
            kind: apply ? 'sheetAdjust' : 'sheetReject',
            amount: apply ? (piastres(after) - piastres(card.balance)) / 100 : 0,
            balanceAfter: after,
            counterpartCardId: null,
            receiptId: null,
            at,
            reconciliation: {
              reconciliationId: reading._id,
              fileName: reading.fileName,
              sheetBalance: line.sheetBalance,
              systemBalance: card.balance,
              sheetRow: line.sheetRow,
            },
          },
          { by, session },
        );
        const written = await fleetFuelReconciliationRepository.decideLine(
          reading._id,
          card._id,
          { decision: input.decision, at, by, movementId: movement._id },
          session,
        );
        if (!written) throw refusal(ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED, [cardId]);
        decided.push({ line, before: card.balance, after });
      }
    });

    for (const { line, before, after } of decided) {
      await auditService.record({
        entityRef: fuelCardEntityRef(String(line.cardId)),
        ...(input.decision === 'apply'
          ? {
              action: 'correct' as const,
              changes: [
                { field: 'balance', old: String(before), new: String(after) },
                { field: 'reconciliation', old: null, new: sessionId },
              ],
            }
          : {
              action: 'reject' as const,
              changes: [
                { field: 'reconciliation', old: null, new: sessionId },
                { field: 'sheetBalance', old: String(before), new: String(line.sheetBalance) },
              ],
            }),
      });
    }
    const byName = await actorNameOf(by);
    return decided.map(({ line, after }) => ({
      cardId: String(line.cardId),
      decision: input.decision,
      balance: after,
      at: at.toISOString(),
      byName,
    }));
  }
}

export const fleetFuelReconcileService = new FleetFuelReconcileService();
