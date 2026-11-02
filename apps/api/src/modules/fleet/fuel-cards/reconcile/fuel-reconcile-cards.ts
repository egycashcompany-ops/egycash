// «كروت في الشيت وليست في النظام» → «إضافة»: a card the company's sheet lists and the system does
// not, created from the sheet's own row.
//
// From the STORED session only: the company, the name and the balance are the sheet's; where the
// sheet put it is a suggestion the body confirms (a car, or none with a label). The card's PIN is
// never read from a sheet — the owner types it, with the expiry («الباسورد اجباري», «تاريخ انتهاء
// الكارت اجبارى»), exactly as «إضافة كارت» asks. The number is the sheet's when it prints it in
// full; when it is masked, the owner types it and its last four (and the printed prefix) must be
// the sheet's.
//
// One transaction: the card and its opening `sheetAdjust` line (0 → the sheet's balance), so the
// balance and the log agree from the first moment. A row is added once.
import { Types } from 'mongoose';
import { ErrorCodes, type AddFleetFuelSheetCard } from '@ecms/contracts';
import { AppError, ConflictError, NotFoundError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import { diffChanges } from '../../../../shared/utils/diff';
import { FleetVehicleModel, type FleetVehicleDoc } from '../../vehicles/vehicle.model';
import { isVehicleWritable } from '../../vehicles/vehicle-status';
import { fleetFuelCardMovementRepository, fleetFuelCardRepository } from '../fuel-card.repository';
import { FleetFuelCardModel, type FleetFuelCardDoc } from '../fuel-card.model';
import {
  fleetFuelCardService,
  fuelCardEntityRef,
  fuelCardSnapshot,
  type FuelCardWithCode,
} from '../fuel-card.service';
import { numberFits, sheetNumberOf } from './compare-fuel-sheet';
import { fleetFuelReconciliationRepository } from './fuel-reconcile.repository';
import { type FleetFuelReconcileNewCard } from './fuel-reconcile.model';
import { notInSheet, refusal } from './fuel-reconcile-parts';

const numberRefused = (code: 'REQUIRED' | 'MISMATCH'): AppError =>
  new AppError(
    ErrorCodes.FLEET_FUEL_SHEET_CARD_NUMBER,
    422,
    code === 'REQUIRED'
      ? 'the sheet does not print the full card number — type it'
      : 'the number typed is not the one the sheet prints',
    { details: [{ field: 'number', code, message: 'number' }] },
  );

/**
 * The card's number: the sheet's when it is printed in full, else the one typed — which must fit
 * what the sheet does print (its last four, its prefix).
 */
export const sheetCardNumber = (
  row: Pick<FleetFuelReconcileNewCard, 'number' | 'numberKind' | 'numberIsFull'>,
  typed: string | undefined,
): string => {
  const sheet = sheetNumberOf(row.number, row.numberKind);
  const given = typed?.trim() ?? '';
  if (row.numberIsFull) {
    if (given !== '' && given.replace(/\D/gu, '') !== sheet.digits) throw numberRefused('MISMATCH');
    return sheet.digits;
  }
  if (given === '') throw numberRefused('REQUIRED');
  if (numberFits(sheet, given) === false) throw numberRefused('MISMATCH');
  return given;
};

export const addFuelSheetCard = async (
  ctx: AuthContext,
  id: string,
  input: AddFleetFuelSheetCard,
): Promise<FuelCardWithCode> => {
  const by = ctx.userId;
  let created: FleetFuelCardDoc | null = null;
  let sessionId = '';
  await unitOfWork(async (session) => {
    created = null;
    const reading = await fleetFuelReconciliationRepository.findLive(id, session);
    if (reading === null) throw new NotFoundError();
    sessionId = String(reading._id);
    const row = (reading.newCards ?? []).find((card) => card.sheetRow === input.sheetRow);
    if (row === undefined) throw notInSheet('body.sheetRow', [String(input.sheetRow)]);
    if (row.cardId != null) {
      throw refusal(ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED, [String(row.cardId)]);
    }
    const number = sheetCardNumber(row, input.number);
    const taken = await FleetFuelCardModel.exists({ number, isDeleted: false }).session(session);
    if (taken !== null) throw new ConflictError('another card already holds this number');
    if (input.vehicleId !== null) {
      const vehicle = await FleetVehicleModel.findOne({
        _id: new Types.ObjectId(input.vehicleId),
        isDeleted: false,
      })
        .select({ status: 1 })
        .session(session)
        .lean<Pick<FleetVehicleDoc, 'status'>>()
        .exec();
      if (vehicle === null) throw new NotFoundError('vehicle not found');
      if (!isVehicleWritable(vehicle.status)) {
        throw new ConflictError('a disposed vehicle cannot hold a fuel card');
      }
    }
    const at = new Date();
    const card = await fleetFuelCardRepository.create(
      {
        vehicleId: input.vehicleId === null ? null : new Types.ObjectId(input.vehicleId),
        // A card on a car is named by the car; the label is only for a card on none.
        label: input.vehicleId === null ? (input.label ?? null) : null,
        company: reading.company,
        name: row.name,
        number,
        expiresAt: input.expiresAt,
        password: input.password,
        balance: row.balance,
        requestedAmount: null,
        requestedAt: null,
        lastChargedAt: null,
      },
      { by, session },
    );
    // Its opening line: from nothing to the sheet's balance — an adjustment, never a charge.
    await fleetFuelCardMovementRepository.create(
      {
        cardId: card._id,
        kind: 'sheetAdjust',
        amount: row.balance,
        balanceAfter: row.balance,
        counterpartCardId: null,
        receiptId: null,
        at,
        reconciliation: {
          reconciliationId: reading._id,
          fileName: reading.fileName,
          sheetBalance: row.balance,
          systemBalance: 0,
          sheetRow: row.sheetRow,
        },
      },
      { by, session },
    );
    const written = await fleetFuelReconciliationRepository.addNewCard(
      reading._id,
      row.sheetRow,
      { cardId: card._id, at, by },
      session,
    );
    if (!written) throw refusal(ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED, [String(card._id)]);
    created = card;
  });
  const card = created as unknown as FleetFuelCardDoc;
  await auditService.record({
    entityRef: fuelCardEntityRef(String(card._id)),
    action: 'create',
    changes: [
      ...diffChanges({}, fuelCardSnapshot(card)),
      { field: 'reconciliation', old: null, new: sessionId },
    ],
  });
  return fleetFuelCardService.withCode(card);
};
