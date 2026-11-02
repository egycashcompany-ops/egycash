// «ربط الكروت بالسيارات» — the owner's ✓ «تحديث» / ✗ «إبقاء» on the links a sheet proposed.
//
// «كل تغيير بموافقتي»: nothing moves a card but this decision, row by row. One transaction, all or
// nothing, from the STORED session only — the card, where it was at the read, and where the sheet
// puts it come from the session; the body names the cards, and for an unknown code the car picked.
//
//   ✓ each card is live, still where it was at the read (else 409 `LINK_CHANGED`), decided once,
//     not waiting for the card-number repair (409 `IN_REPAIR`); an unknown code needs a pick; the
//     target car is live and writable; and the target's slot (one card per company per car) is free
//     or freed in this same decision — a swap's two cards together — else 409 `SLOT_HELD`.
//     Every moving card is taken off its car first, then put on its new one, so the unique index
//     holds at every write. Each card gets one `sheetLink` line («نُقل من … إلى … — شيت الشركة»)
//     and an `update` audit; «تذكّر هذا الكود» saves each picked spelling as the owner's alias.
//   ✗ records the refusal on the session and audits `reject` — no line in the card's log.
import { Types, type ClientSession } from 'mongoose';
import {
  ErrorCodes,
  type DecideFleetFuelLinks,
  type FleetFuelLinkPlaceDto,
  type FleetFuelLinkResultDto,
} from '@ecms/contracts';
import { ConflictError, NotFoundError, ValidationError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import { FleetVehicleModel, type FleetVehicleDoc } from '../../vehicles/vehicle.model';
import { isVehicleWritable } from '../../vehicles/vehicle-status';
import { actorNameOf } from '../../fleet-actor-name';
import { fleetFuelCardMovementRepository, fleetFuelCardRepository } from '../fuel-card.repository';
import { FleetFuelCardModel, type FleetFuelCardDoc } from '../fuel-card.model';
import { fuelCardEntityRef } from '../fuel-card.service';
import { type LinkCard, type LinkVehicle, type LinkWorld } from './compare-card-links';
import { fleetFuelReconciliationRepository } from './fuel-reconcile.repository';
import { type FleetFuelReconcileLink } from './fuel-reconcile.model';
import { linkRefusal, notInSheet, refusal } from './fuel-reconcile-parts';
import { fuelSheetCodeAliases, rememberFuelSheetCode } from './fuel-sheet-codes';

/** A card as the link comparison reads it. */
export const linkCardOf = (card: FleetFuelCardDoc): LinkCard => ({
  id: String(card._id),
  number: card.number,
  vehicleId: card.vehicleId == null ? null : String(card.vehicleId),
  label: card.vehicleId == null ? (card.label ?? null) : null,
});

/** The registry, the remembered spellings and the company's cards — what a read resolves against. */
export const linkWorldOf = async (cards: readonly FleetFuelCardDoc[]): Promise<LinkWorld> => {
  const [vehicles, aliases] = await Promise.all([
    FleetVehicleModel.find({ isDeleted: false })
      .select({ code: 1, chassisNumber: 1 })
      .lean<Pick<FleetVehicleDoc, '_id' | 'code' | 'chassisNumber'>[]>()
      .exec(),
    fuelSheetCodeAliases(),
  ]);
  return {
    vehicles: vehicles.map((v): LinkVehicle => ({
      id: String(v._id),
      code: v.code,
      chassisNumber: v.chassisNumber ?? '',
    })),
    aliases,
    cards: cards.map(linkCardOf),
  };
};

interface Target {
  vehicleId: Types.ObjectId | null;
  label: string | null;
}

interface Moved {
  link: FleetFuelReconcileLink;
  before: FleetFuelCardDoc;
  target: Target;
  /** The picked spelling saved as an alias. */
  remembered: string | null;
}

const sameId = (a: Types.ObjectId | null | undefined, b: Types.ObjectId | null | undefined) =>
  (a == null && b == null) || (a != null && b != null && String(a) === String(b));

const vehiclesIn = async (
  ids: readonly Types.ObjectId[],
  session: ClientSession,
): Promise<Map<string, Pick<FleetVehicleDoc, '_id' | 'code' | 'status'>>> => {
  if (ids.length === 0) return new Map();
  const rows = await FleetVehicleModel.find({ _id: { $in: [...ids] }, isDeleted: false })
    .select({ code: 1, status: 1 })
    .session(session)
    .lean<Pick<FleetVehicleDoc, '_id' | 'code' | 'status'>[]>()
    .exec();
  return new Map(rows.map((row) => [String(row._id), row]));
};

export const decideFuelLinks = async (
  ctx: AuthContext,
  id: string,
  input: DecideFleetFuelLinks,
): Promise<FleetFuelLinkResultDto[]> => {
  const by = ctx.userId;
  const cardIds = [...new Set(input.cardIds.map((cardId) => cardId.toLowerCase()))];
  const picks = new Map(input.pick.map((pick) => [pick.cardId.toLowerCase(), pick]));
  const apply = input.decision === 'apply';
  let sessionId = '';
  let at = new Date();
  let moved: Moved[] = [];
  let codes = new Map<string, string>();

  await unitOfWork(async (session) => {
    // A retried transaction starts over from nothing.
    moved = [];
    const reading = await fleetFuelReconciliationRepository.findLive(id, session);
    if (reading === null) throw new NotFoundError();
    sessionId = String(reading._id);
    const links = new Map((reading.links ?? []).map((link) => [String(link.cardId), link]));

    const strangers = cardIds.filter((cardId) => !links.has(cardId));
    if (strangers.length > 0) throw notInSheet('body.cardIds', strangers);
    const already = cardIds.filter((cardId) => links.get(cardId)?.decision != null);
    if (already.length > 0) throw refusal(ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED, already);
    const linkOf = (cardId: string) => links.get(cardId) as FleetFuelReconcileLink;

    if (apply) {
      const repair = cardIds.filter((cardId) => linkOf(cardId).inRepair);
      if (repair.length > 0) throw linkRefusal(ErrorCodes.FLEET_FUEL_LINK_IN_REPAIR, repair);
    }
    // A pick is for an unknown code, and an unknown code needs one on ✓.
    const misplaced = [...picks.keys()].filter((cardId) => linkOf(cardId).kind !== 'unknownCode');
    const unpicked = apply
      ? cardIds.filter((cardId) => linkOf(cardId).kind === 'unknownCode' && !picks.has(cardId))
      : [];
    if (misplaced.length > 0 || unpicked.length > 0) {
      throw new ValidationError([
        ...misplaced.map((cardId) => ({ field: 'body.pick', code: 'INVALID', message: cardId })),
        ...unpicked.map((cardId) => ({ field: 'body.pick', code: 'REQUIRED', message: cardId })),
      ]);
    }

    const live = new Map(
      (await fleetFuelCardRepository.liveByIds(cardIds, session)).map((card) => [
        String(card._id),
        card,
      ]),
    );
    const gone = cardIds.filter((cardId) => live.get(cardId)?.company !== reading.company);
    if (gone.length > 0) throw refusal(ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED, gone);
    if (apply) {
      // Still where the read found it — a card moved since is read again, not moved twice.
      const elsewhere = cardIds.filter((cardId) => {
        const card = live.get(cardId) as FleetFuelCardDoc;
        const link = linkOf(cardId);
        return (
          !sameId(card.vehicleId, link.fromVehicleId) ||
          (card.vehicleId == null && (card.label ?? null) !== (link.fromLabel ?? null))
        );
      });
      if (elsewhere.length > 0) {
        throw refusal(ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED, elsewhere, 'LINK_CHANGED');
      }
    }

    const targetOf = (cardId: string): Target => {
      const link = linkOf(cardId);
      const pick = picks.get(cardId);
      if (pick !== undefined) {
        return pick.vehicleId === null
          ? { vehicleId: null, label: pick.label }
          : { vehicleId: new Types.ObjectId(pick.vehicleId), label: null };
      }
      return { vehicleId: link.toVehicleId ?? null, label: link.toLabel ?? null };
    };
    const targets = new Map(cardIds.map((cardId) => [cardId, targetOf(cardId)]));

    const involved = [
      ...[...live.values()].flatMap((card) => (card.vehicleId == null ? [] : [card.vehicleId])),
      ...[...targets.values()].flatMap((target) =>
        target.vehicleId === null ? [] : [target.vehicleId],
      ),
    ];
    const vehicles = await vehiclesIn(involved, session);
    codes = new Map([...vehicles].map(([vid, v]) => [vid, v.code]));

    if (apply) {
      for (const target of targets.values()) {
        if (target.vehicleId === null) continue;
        const vehicle = vehicles.get(String(target.vehicleId));
        if (vehicle === undefined) throw new NotFoundError('vehicle not found');
        if (!isVehicleWritable(vehicle.status)) {
          throw new ConflictError('a disposed vehicle cannot hold a fuel card');
        }
      }
      // One card per company per car: the target's holder must leave in this same decision, and
      // no two cards of it may take one car.
      const held: string[] = [];
      const taken = new Set<string>();
      for (const cardId of cardIds) {
        const target = targets.get(cardId) as Target;
        if (target.vehicleId === null) continue;
        const vehicleKey = String(target.vehicleId);
        if (taken.has(vehicleKey)) {
          held.push(cardId);
          continue;
        }
        taken.add(vehicleKey);
        const holders = await FleetFuelCardModel.find({
          vehicleId: target.vehicleId,
          company: reading.company,
          isDeleted: false,
          _id: { $ne: new Types.ObjectId(cardId) },
        })
          .select({ _id: 1 })
          .session(session)
          .lean<{ _id: Types.ObjectId }[]>()
          .exec();
        const staying = holders.filter((holder) => {
          const leaving = targets.get(String(holder._id));
          return leaving === undefined || sameId(leaving.vehicleId, target.vehicleId);
        });
        if (staying.length > 0) held.push(cardId);
      }
      if (held.length > 0) throw linkRefusal(ErrorCodes.FLEET_FUEL_LINK_SLOT_HELD, held);
    }

    at = new Date();
    // A pick that names where the card already is moves nothing — and writes no line.
    const stays = (cardId: string): boolean => {
      const card = live.get(cardId) as FleetFuelCardDoc;
      const target = targets.get(cardId) as Target;
      return target.vehicleId !== null || card.vehicleId != null
        ? sameId(card.vehicleId, target.vehicleId)
        : (card.label ?? null) === target.label;
    };
    const moving = cardIds.filter((cardId) => !stays(cardId));
    const current = new Map(live);
    if (apply) {
      // Off every car first …
      for (const cardId of moving) {
        const card = current.get(cardId) as FleetFuelCardDoc;
        if (card.vehicleId == null) continue;
        const target = targets.get(cardId) as Target;
        current.set(
          cardId,
          await fleetFuelCardRepository.updateById(
            cardId,
            { vehicleId: null, label: target.vehicleId === null ? target.label : null },
            { by, version: card.__v, session },
          ),
        );
      }
      // … then onto the new ones, or under a label.
      for (const cardId of moving) {
        const card = current.get(cardId) as FleetFuelCardDoc;
        const target = targets.get(cardId) as Target;
        const set =
          target.vehicleId === null
            ? card.label === target.label
              ? null
              : { label: target.label }
            : { vehicleId: target.vehicleId, label: null };
        if (set === null) continue;
        current.set(
          cardId,
          await fleetFuelCardRepository.updateById(cardId, set, {
            by,
            version: card.__v,
            session,
          }),
        );
      }
    }
    for (const cardId of cardIds) {
      const link = linkOf(cardId);
      const before = live.get(cardId) as FleetFuelCardDoc;
      const target = apply
        ? (targets.get(cardId) as Target)
        : { vehicleId: before.vehicleId ?? null, label: before.label ?? null };
      let movementId: Types.ObjectId | null = null;
      let remembered: string | null = null;
      if (apply && moving.includes(cardId)) {
        const place = (vehicleId: Types.ObjectId | null, label: string | null) => ({
          vehicleId,
          vehicleCode: vehicleId === null ? null : (codes.get(String(vehicleId)) ?? null),
          label: vehicleId === null ? label : null,
        });
        const line = await fleetFuelCardMovementRepository.create(
          {
            cardId: before._id,
            kind: 'sheetLink',
            amount: 0,
            balanceAfter: before.balance,
            counterpartCardId: null,
            receiptId: null,
            at,
            link: {
              from: place(before.vehicleId ?? null, before.label ?? null),
              to: place(target.vehicleId, target.label),
              sheetCode: link.sheetCode ?? null,
              reconciliationId: reading._id,
              fileName: reading.fileName,
            },
          },
          { by, session },
        );
        movementId = line._id;
      }
      if (apply) {
        const pick = picks.get(cardId);
        if (input.remember && pick !== undefined && (link.sheetCode ?? '').trim() !== '') {
          await rememberFuelSheetCode(
            {
              sheetCode: link.sheetCode as string,
              vehicleId: pick.vehicleId,
              vehicleCode:
                pick.vehicleId === null ? null : (codes.get(pick.vehicleId.toLowerCase()) ?? null),
              label: pick.vehicleId === null ? pick.label : null,
            },
            by,
            session,
          );
          remembered = link.sheetCode ?? null;
        }
      }
      const written = await fleetFuelReconciliationRepository.decideLink(
        reading._id,
        before._id,
        { decision: input.decision, at, by, movementId },
        session,
      );
      if (!written) throw refusal(ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED, [cardId]);
      moved.push({ link, before, target, remembered });
    }
  });

  const placeDto = (
    vehicleId: Types.ObjectId | null,
    label: string | null,
  ): FleetFuelLinkPlaceDto =>
    vehicleId === null
      ? { vehicleId: null, vehicleCode: null, label }
      : {
          vehicleId: String(vehicleId),
          vehicleCode: codes.get(String(vehicleId)) ?? null,
          label: null,
        };
  for (const { before, target, remembered } of moved) {
    const changes: { field: string; old: string | null; new: string | null }[] = [];
    if (apply) {
      const oldVehicle = before.vehicleId == null ? null : String(before.vehicleId);
      const newVehicle = target.vehicleId === null ? null : String(target.vehicleId);
      if (oldVehicle !== newVehicle)
        changes.push({ field: 'vehicleId', old: oldVehicle, new: newVehicle });
      const oldLabel = before.vehicleId == null ? (before.label ?? null) : null;
      const newLabel = target.vehicleId === null ? target.label : null;
      if (oldLabel !== newLabel) changes.push({ field: 'label', old: oldLabel, new: newLabel });
    }
    changes.push({ field: 'reconciliation', old: null, new: sessionId });
    if (remembered !== null) changes.push({ field: 'sheetCodeAlias', old: null, new: remembered });
    await auditService.record({
      entityRef: fuelCardEntityRef(String(before._id)),
      action: apply ? 'update' : 'reject',
      changes,
    });
  }
  const byName = await actorNameOf(by);
  return moved.map(({ before, target }) => ({
    cardId: String(before._id),
    decision: input.decision,
    from: placeDto(
      before.vehicleId ?? null,
      before.vehicleId == null ? (before.label ?? null) : null,
    ),
    to: placeDto(target.vehicleId, target.vehicleId === null ? target.label : null),
    at: at.toISOString(),
    byName,
  }));
};
