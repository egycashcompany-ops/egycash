// What the reconciliation's read and its three kinds of decision share — the answers' small
// shapes and the refusals the screen reads (`ErrorCodes` docs). A split of
// `fuel-reconcile.service.ts`, so the link and the new-card decisions use the same words.
import {
  ErrorCodes,
  type FleetFuelCardCompany,
  type FleetFuelCardRefDto,
  type FleetFuelLinkPlaceDto,
  type FleetFuelSheetRowDto,
} from '@ecms/contracts';
import { AppError, ValidationError } from '../../../../shared/errors';
import { type FleetFuelCardDoc } from '../fuel-card.model';
import { type FuelSheetRow } from './read-fuel-sheet';

export const piastres = (egp: number): number => Math.round(egp * 100);

/** A sheet row as answered. */
export const rowDto = (row: FuelSheetRow): FleetFuelSheetRowDto => ({
  row: row.row,
  number: row.number,
  name: row.name,
  balance: row.balance,
  builtName: row.builtName,
  plate: row.plate,
  chassis: row.chassis,
  code: row.code,
  numberKind: row.numberKind,
});

/** A live card as a line names it: its name, and its car's code or its label. */
export const cardRef = (card: FleetFuelCardDoc, place: string | null): FleetFuelCardRefDto => ({
  id: String(card._id),
  name: card.name,
  place,
});

/** Where a card is: on a car (its id and code), or on none (its label). */
export const placeOfCard = (
  card: Pick<FleetFuelCardDoc, 'vehicleId' | 'label'>,
  codes: ReadonlyMap<string, string>,
): FleetFuelLinkPlaceDto =>
  card.vehicleId == null
    ? { vehicleId: null, vehicleCode: null, label: card.label ?? null }
    : {
        vehicleId: String(card.vehicleId),
        vehicleCode: codes.get(String(card.vehicleId)) ?? null,
        label: null,
      };

type RefusalCode =
  | typeof ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED
  | typeof ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED;

const MESSAGES: Record<RefusalCode, string> = {
  [ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED]:
    'a card changed after the sheet was read — nothing was written; read the sheet again',
  [ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED]:
    'a card was already decided on this sheet — nothing was written',
};

/**
 * 409 naming every card, one detail each. The detail code is the error's own (`CARD_CHANGED` /
 * `DECIDED`) unless a narrower one is given (`LINK_CHANGED`, `REQUEST_CHANGED`).
 */
export const refusal = (code: RefusalCode, cardIds: readonly string[], detail?: string): AppError =>
  new AppError(code, 409, MESSAGES[code], {
    details: cardIds.map((cardId) => ({
      field: 'cardIds',
      code:
        detail ??
        (code === ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED ? 'CARD_CHANGED' : 'DECIDED'),
      message: cardId,
    })),
  });

/** 409 for a link decision of its own kind — a held slot, a card waiting for the repair. */
export const linkRefusal = (
  code: typeof ErrorCodes.FLEET_FUEL_LINK_SLOT_HELD | typeof ErrorCodes.FLEET_FUEL_LINK_IN_REPAIR,
  cardIds: readonly string[],
): AppError =>
  new AppError(
    code,
    409,
    code === ErrorCodes.FLEET_FUEL_LINK_SLOT_HELD
      ? 'the car already holds a card of this company that does not move away — nothing was written'
      : 'this card waits for the card-number repair — nothing was written',
    {
      details: cardIds.map((cardId) => ({
        field: 'cardIds',
        code: code === ErrorCodes.FLEET_FUEL_LINK_SLOT_HELD ? 'SLOT_HELD' : 'IN_REPAIR',
        message: cardId,
      })),
    },
  );

/** 400 — ids the session does not offer for this decision. */
export const notInSheet = (field: string, ids: readonly string[]): ValidationError =>
  new ValidationError(ids.map((id) => ({ field, code: 'NOT_IN_SHEET', message: id })));

/**
 * The wrong-company stop, held by the server as the screen holds it: a session whose sheet's names
 * are all another company's decides nothing on this company's cards — no ✓ / ✗, no link, no
 * «إضافة» — whoever calls. 422 `FLEET_FUEL_SHEET_LAYOUT` / `WRONG_COMPANY`, naming the sheet's.
 */
export const refuseWrongCompany = (reading: {
  company: FleetFuelCardCompany;
  sheetCompany: FleetFuelCardCompany | null;
}): void => {
  if (reading.sheetCompany === null || reading.sheetCompany === reading.company) return;
  throw new AppError(
    ErrorCodes.FLEET_FUEL_SHEET_LAYOUT,
    422,
    'the sheet is another company’s — nothing was written; read it under its own company',
    { details: [{ field: 'company', code: 'WRONG_COMPANY', message: reading.sheetCompany }] },
  );
};
