// «مطابقة أرصدة الكروت» — a company's balance sheet against its cards, and the ✓ / ✗ on them.
//
// READ: the sheet is read in memory, compared with the company's live cards, and the comparison is
// stored as a session. No card and no movement is written. With it are stored what a later
// decision may do beyond the balance: the charges the sheet does not show (`fuel-reconcile-charges`)
// and «ربط الكروت بالسيارات» / the sheet-only cards (6b, `fuel-reconcile-links`, `-cards`).
//
// DECIDE: one transaction, all or nothing, from the stored session only — the sheet's figure and
// the balance the card held at the read come from the session, never from the request body.
//   ✓ (`apply`) sets the card's balance to the sheet's, with its own `sheetAdjust` log line. It is
//     an adjustment, not a charge: `lastChargedAt`, «charged today» and the charge request are
//     untouched — UNLESS the reader also chose, on that card:
//       · `cancelCharges` — charges the sheet does not show, each a stored candidate: each is
//         marked «أُلغي بشيت الشركة» (it stays in the card's log only), and the green row follows
//         the charges that are left;
//       · `approveRequests` — the card's pending «طلب رصيد» is EXACTLY the sheet's difference: it is
//         approved, as a `charge` line, instead of an adjustment («اعتماد طلب الرصيد»), so a later
//         approve cannot add the same money twice.
//     THE OWNER'S SAFETY RULE: when any chosen card's balance moved after the sheet was read — or
//     any line of its log was written, edited or removed since — nothing is applied, and every such
//     card is named (409) so the sheet is read again.
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
import { NotFoundError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import { fleetVehicleRepository } from '../../vehicles/vehicle.repository';
import { actorNameOf, actorNamesOf } from '../../fleet-actor-name';
import { fleetFuelCardMovementRepository, fleetFuelCardRepository } from '../fuel-card.repository';
import { type FleetFuelCardDoc } from '../fuel-card.model';
import { fuelCardEntityRef, toFuelCardDto } from '../fuel-card.service';
import { readFuelSheet } from './read-fuel-sheet';
import { compareFuelSheet, hasNameToCheck, type ReconcileMatch } from './compare-fuel-sheet';
import { compareCardLinks, linkResolver, placeVerdict, type LinkPlace } from './compare-card-links';
import { fleetFuelReconciliationRepository } from './fuel-reconcile.repository';
import { type FleetFuelReconcileCharge, type FleetFuelReconcileLine } from './fuel-reconcile.model';
import {
  cancelPlanOf,
  cancellableCharges,
  chargeCandidatesOf,
  chargeDto,
  latestLiveChargeAt,
} from './fuel-reconcile-charges';
import {
  cardRef,
  notInSheet,
  piastres,
  refusal,
  refuseWrongCompany,
  rowDto,
} from './fuel-reconcile-parts';
import { linkWorldOf } from './fuel-reconcile-links';

const oid = (id: string | null): Types.ObjectId | null =>
  id === null ? null : new Types.ObjectId(id);

interface Decided {
  line: FleetFuelReconcileLine;
  before: number;
  after: number;
  /** The charges this ✓ cancelled on the card. */
  cancelled: FleetFuelReconcileCharge[];
  /** The «طلب رصيد» approved instead of an adjustment. */
  approved: number | null;
}

class FleetFuelReconcileService {
  /** Read a sheet and store the comparison. Writes the session only. */
  async read(
    ctx: AuthContext,
    input: {
      company: FleetFuelCardCompany;
      fileName: string;
      buffer: Buffer;
      /** «تاريخ الشيت» (UTC midnight), or none. */
      sheetDate?: Date | null;
    },
  ): Promise<FleetFuelReconcileDto> {
    const fileSha256 = createHash('sha256').update(input.buffer).digest('hex');
    const sheet = await readFuelSheet(input.buffer);
    // BEFORE the cards are read: anything that moves a card from here on refuses its ✓.
    const readAt = new Date();
    const sheetDate = input.sheetDate ?? null;
    const cards = await fleetFuelCardRepository.liveOfCompany(input.company);
    const codes = await fleetVehicleRepository.codesByIds([
      ...new Set(cards.flatMap((card) => (card.vehicleId == null ? [] : [String(card.vehicleId)]))),
    ]);
    const placeOf = (card: FleetFuelCardDoc): string | null =>
      card.vehicleId == null ? (card.label ?? null) : (codes.get(String(card.vehicleId)) ?? null);
    // The sheet's car codes resolve against the registry and the remembered spellings — the
    // place hint, a tie between two cards of one name, and «ربط الكروت بالسيارات» all ask the same.
    const world = await linkWorldOf(cards);
    const resolver = linkResolver(world);
    const linkCards = new Map(world.cards.map((card) => [card.id, card]));
    const plan = compareFuelSheet({
      rows: sheet.rows,
      invalid: sheet.invalid,
      cards: cards.map((card) => ({
        id: String(card._id),
        name: card.name,
        number: card.number,
        balance: card.balance,
        place: placeOf(card),
      })),
      samePlace: (row, card) => {
        const linkCard = linkCards.get(card.id);
        return linkCard === undefined
          ? null
          : placeVerdict(row.code, linkCard, resolver, sheet.carColumn);
      },
    });
    const matches = [...plan.differs, ...plan.equal];
    const proposed = compareCardLinks({
      matches: matches.map((match) => ({ cardId: match.cardId, sheet: match.sheet })),
      // A row that names no card cannot be one: «إضافة» needs the name the sheet gives it.
      sheetOnly: plan.sheetOnly.filter((row) => hasNameToCheck(row.builtName)),
      carColumn: sheet.carColumn,
      world,
      resolver,
    });
    // «شحن لا يظهر في الشيت» — only where the sheet is LOWER than the card.
    const candidates = await chargeCandidatesOf(
      plan.differs.filter((match) => match.difference < 0).map((match) => match.cardId),
      readAt,
    );
    const session = await fleetFuelReconciliationRepository.create(
      {
        company: input.company,
        fileName: input.fileName,
        fileSha256,
        readAt,
        rowsRead: sheet.rowsRead,
        sheetCompany: plan.sheetCompany,
        sheetDate,
        // A sheet of the other company judges none of these cards (the wrong-company stop).
        equalCardIds:
          plan.sheetCompany !== null && plan.sheetCompany !== input.company
            ? []
            : plan.equal.map((match) => new Types.ObjectId(match.cardId)),
        lines: plan.differs.map((match) => ({
          cardId: new Types.ObjectId(match.cardId),
          name: match.sheet.builtName,
          sheetRow: match.sheet.row,
          sheetNumber: match.sheet.number,
          sheetBalance: match.sheet.balance,
          systemBalance: match.systemBalance,
          numberMatches: match.numberMatches,
          sheetCode: match.sheet.code,
          charges: (candidates.get(match.cardId) ?? []).map(({ movementId, amount, at }) => ({
            movementId,
            amount,
            at,
          })),
          decision: null,
          decidedAt: null,
          decidedBy: null,
          movementId: null,
        })),
        links: proposed.links.map((link) => ({
          cardId: new Types.ObjectId(link.cardId),
          sheetRow: link.sheetRow,
          sheetCode: link.sheetCode,
          kind: link.kind,
          fromVehicleId: oid(link.from.vehicleId),
          fromLabel: link.from.label,
          toVehicleId: oid(link.to?.vehicleId ?? null),
          toLabel: link.to?.label ?? null,
          resolvedBy: link.resolvedBy,
          pairWith: oid(link.pairWith),
          inRepair: link.inRepair,
          decision: null,
          decidedAt: null,
          decidedBy: null,
          movementId: null,
        })),
        newCards: proposed.newCards.map(({ row, to }) => ({
          sheetRow: row.row,
          name: row.builtName,
          number: row.number,
          numberKind: row.numberKind,
          numberIsFull: row.numberKind === 'full',
          balance: row.balance,
          sheetCode: row.code,
          toVehicleId: oid(to?.vehicleId ?? null),
          toLabel: to?.label ?? null,
          cardId: null,
          decidedAt: null,
          decidedBy: null,
        })),
        counts: {
          equal: plan.equal.length,
          sheetOnly: plan.sheetOnly.length,
          systemOnly: plan.systemOnly.length,
          duplicates: plan.duplicates.length,
          conflicts: plan.conflicts.length,
          numbersDiffer: matches.filter((match) => !match.numberMatches).length,
          skipped: sheet.skipped.length,
          placesDiffer: matches.filter((match) => match.placeMatches === false).length,
        },
      },
      { by: ctx.userId },
    );

    const byId = new Map(cards.map((card) => [String(card._id), card]));
    const names = await actorNamesOf(
      [...candidates.values()]
        .flat()
        .map((charge) => (charge.by == null ? null : String(charge.by))),
    );
    const cardDto = (card: FleetFuelCardDoc) =>
      toFuelCardDto({ doc: card, vehicleCode: codes.get(String(card.vehicleId)) ?? null });
    const refOf = (cardId: string | null) => {
      const card = cardId === null ? undefined : byId.get(cardId);
      return card === undefined ? null : cardRef(card, placeOf(card));
    };
    const placeDto = (place: LinkPlace | null) =>
      place === null
        ? null
        : { vehicleId: place.vehicleId, vehicleCode: place.vehicleCode, label: place.label };
    const lineDto = (match: ReconcileMatch) => {
      const holder = match.numberHolderId === null ? undefined : byId.get(match.numberHolderId);
      return {
        card: cardDto(byId.get(match.cardId) as FleetFuelCardDoc),
        sheet: rowDto(match.sheet),
        difference: match.difference,
        numberMatches: match.numberMatches,
        matchedBy: match.matchedBy,
        nameMatches: match.nameMatches,
        numberHolder: holder === undefined ? null : cardRef(holder, placeOf(holder)),
        placeMatches: match.placeMatches,
        charges: (candidates.get(match.cardId) ?? []).map((charge) =>
          chargeDto(charge, sheetDate, names),
        ),
      };
    };
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
      sheetOnly: plan.sheetOnly.map(rowDto),
      systemOnly: plan.systemOnly.map((id) => cardDto(byId.get(id) as FleetFuelCardDoc)),
      duplicates: plan.duplicates.map((duplicate) => ({
        ...rowDto(duplicate),
        times: duplicate.times,
      })),
      conflicts: plan.conflicts,
      layout: sheet.layout,
      nameRebuilt: sheet.nameRebuilt,
      cardRows: sheet.rows.length + sheet.invalid.length,
      skipped: sheet.skipped,
      totalCheck: sheet.totalCheck,
      example: sheet.example,
      sheetDate: sheetDate === null ? null : sheetDate.toISOString().slice(0, 10),
      carColumn: sheet.carColumn,
      links: proposed.links.map((link) => ({
        card: cardDto(byId.get(link.cardId) as FleetFuelCardDoc),
        sheetRow: link.sheetRow,
        sheetCode: link.sheetCode,
        kind: link.kind,
        to: placeDto(link.to),
        resolvedBy: link.resolvedBy,
        chassisCar: link.chassisCar,
        slotHeldBy: refOf(link.slotHeldBy),
        pairWith: link.pairWith,
        inRepair: link.inRepair,
        decision: null,
      })),
      newCards: proposed.newCards.map(({ row, to, resolvedBy, chassisCar, slotHeldBy }) => ({
        sheetRow: row.row,
        name: row.builtName,
        number: row.number,
        numberIsFull: row.numberKind === 'full',
        balance: row.balance,
        sheetCode: row.code,
        to: placeDto(to),
        resolvedBy,
        chassisCar,
        slotHeldBy: refOf(slotHeldBy),
        cardId: null,
      })),
    };
  }

  /** ✓ or ✗ on chosen cards of one session — all of them, or none. */
  async decide(
    ctx: AuthContext,
    id: string,
    input: DecideFleetFuelReconcile,
  ): Promise<FleetFuelReconcileResultDto[]> {
    const by = ctx.userId;
    // Each card (and charge) once, however its id is spelled (the schema refuses a repeat; this is
    // the floor).
    const cardIds = [...new Set(input.cardIds.map((cardId) => cardId.toLowerCase()))];
    const cancelIds = [...new Set((input.cancelCharges ?? []).map((cid) => cid.toLowerCase()))];
    const approving = new Set((input.approveRequests ?? []).map((cid) => cid.toLowerCase()));
    let sessionId = '';
    let decided: Decided[] = [];
    let at = new Date();
    await unitOfWork(async (session) => {
      // A retried transaction starts over from nothing.
      decided = [];
      const reading = await fleetFuelReconciliationRepository.findLive(id, session);
      if (reading === null) throw new NotFoundError();
      // Another company's sheet decides nothing here — as the screen's stop says.
      refuseWrongCompany(reading);
      sessionId = String(reading._id);
      const lines = new Map(reading.lines.map((line) => [String(line.cardId), line]));

      // Only a card the sheet DIFFERS on may be named — never an equal card, another company's,
      // or a row in conflict.
      const strangers = cardIds.filter((cardId) => !lines.has(cardId));
      if (strangers.length > 0) throw notInSheet('body.cardIds', strangers);
      const already = cardIds.filter((cardId) => lines.get(cardId)?.decision != null);
      if (already.length > 0) throw refusal(ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED, already);
      // The charges to cancel — from the session's own candidates, never the body's word.
      const cancels = cancelPlanOf(lines, cardIds, cancelIds);

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
      // «اعتماد طلب الرصيد» only while the request IS the sheet's difference, to the piastre.
      const requestChanged = [...approving].filter((cardId) => {
        const card = live.get(cardId) as FleetFuelCardDoc;
        const line = lines.get(cardId) as FleetFuelReconcileLine;
        const difference = piastres(line.sheetBalance) - piastres(line.systemBalance);
        return (
          difference <= 0 ||
          card.requestedAmount == null ||
          piastres(card.requestedAmount) !== difference
        );
      });
      if (requestChanged.length > 0) {
        throw refusal(
          ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED,
          requestChanged,
          'REQUEST_CHANGED',
        );
      }
      const charges = await cancellableCharges(cancelIds, session);

      at = new Date();
      for (const cardId of cardIds) {
        const card = live.get(cardId) as FleetFuelCardDoc;
        const line = lines.get(cardId) as FleetFuelReconcileLine;
        const apply = input.decision === 'apply';
        const after = apply ? line.sheetBalance : card.balance;
        const request = apply && approving.has(cardId) ? (card.requestedAmount ?? null) : null;
        const cancelled = apply ? (cancels.get(cardId) ?? []) : [];
        if (apply) {
          const set: Partial<FleetFuelCardDoc> = { balance: after };
          if (request !== null) {
            // The request becomes the balance the sheet shows — as an approve would have.
            Object.assign(set, { requestedAmount: null, requestedAt: null, lastChargedAt: at });
          } else if (cancelled.length > 0) {
            // The green row follows the charges that are left.
            set.lastChargedAt = await latestLiveChargeAt(
              card._id,
              cancelled.map((charge) => charge.movementId),
              session,
            );
          }
          // Version-checked: a card written since this transaction read it is not overwritten.
          await fleetFuelCardRepository.updateById(cardId, set, {
            by,
            version: card.__v,
            session,
          });
        }
        const movement =
          request !== null
            ? await fleetFuelCardMovementRepository.create(
                {
                  cardId: card._id,
                  kind: 'charge',
                  amount: request,
                  balanceAfter: after,
                  counterpartCardId: null,
                  receiptId: null,
                  at,
                },
                { by, session },
              )
            : await fleetFuelCardMovementRepository.create(
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
                    ...(cancelled.length === 0
                      ? {}
                      : {
                          cancelled: cancelled.map(({ movementId, amount }) => ({
                            movementId,
                            amount,
                          })),
                        }),
                  },
                },
                { by, session },
              );
        for (const charge of cancelled) {
          const doc = charges.get(String(charge.movementId));
          await fleetFuelCardMovementRepository.updateById(
            String(charge.movementId),
            {
              cancelledBySheet: {
                reconciliationId: reading._id,
                movementId: movement._id,
                fileName: reading.fileName,
                at,
                by: new Types.ObjectId(by),
              },
            },
            { by, version: doc?.__v ?? 0, session },
          );
        }
        const written = await fleetFuelReconciliationRepository.decideLine(
          reading._id,
          card._id,
          { decision: input.decision, at, by, movementId: movement._id },
          session,
        );
        if (!written) throw refusal(ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED, [cardId]);
        decided.push({ line, before: card.balance, after, cancelled, approved: request });
      }
    });

    for (const { line, before, after, cancelled, approved } of decided) {
      await auditService.record({
        entityRef: fuelCardEntityRef(String(line.cardId)),
        ...(input.decision === 'apply'
          ? {
              action: 'correct' as const,
              changes: [
                { field: 'balance', old: String(before), new: String(after) },
                { field: 'reconciliation', old: null, new: sessionId },
                ...(approved === null
                  ? []
                  : [{ field: 'requestedAmount', old: String(approved), new: null }]),
                ...(cancelled.length === 0
                  ? []
                  : [
                      {
                        field: 'cancelledCharges',
                        old: null,
                        new: cancelled.map((charge) => String(charge.movementId)).join(','),
                      },
                    ]),
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
    return decided.map(({ line, after, cancelled, approved }) => ({
      cardId: String(line.cardId),
      decision: input.decision,
      balance: after,
      at: at.toISOString(),
      byName,
      cancelledAmount: cancelled.reduce((sum, charge) => sum + piastres(charge.amount), 0) / 100,
      approvedRequest: approved,
    }));
  }
}

export const fleetFuelReconcileService = new FleetFuelReconcileService();
