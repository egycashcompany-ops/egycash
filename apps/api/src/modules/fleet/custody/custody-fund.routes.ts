// The custody fund — `/fleet/custody/fund`: its figures, «سجل العهدة», and the three letters that
// move it («شحن العهدة», «استعاضة عهدة», «تسوية عهدة»).
//
// Reading rides the custody screen's own grant. Moving the fund is custody money, so a letter needs
// that grant AND the custody receipts' («إيصالات العهدة») create grant — both `authorize` calls must
// pass. No new permission key, and no licensing grant: the settlement's candidates (each with its
// whole licensing record, for the eye preview) are served here, under the custody grant. A held
// replenishment's «تأكيد التحويل» and its cancel ride the same two grants that made it.
import { Router } from 'express';
import { z } from 'zod';
import {
  CancelFleetCustodyReplenishmentSchema,
  ConfirmFleetCustodyTransferSchema,
  CreateFleetCustodyChargeSchema,
  CreateFleetCustodyReplenishmentSchema,
  CreateFleetCustodySettlementSchema,
  FleetCustodyLedgerSummaryQuerySchema,
  ListFleetCustodyLedgerQuerySchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  cancelCustodyReplenishment,
  chargeCustody,
  confirmCustodyTransfer,
  custodyFundSummary,
  custodyLedgerSummary,
  custodyReplenishCandidates,
  custodySettleCandidates,
  getCustodyOperation,
  listCustodyLedger,
  replenishCustody,
  settleCustody,
} from './custody-fund.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildFleetCustodyFundRouter = (): Router => {
  const router = Router();
  // «إجمالي العهدة» and what it is made of — unfiltered.
  router.get(
    '/summary',
    authenticate,
    authorize('fleetCustody.view'),
    asyncHandler(custodyFundSummary),
  );
  // «سجل العهدة»: the count chip first — `/ledger` must not read `summary` as anything.
  router.get(
    '/ledger/summary',
    authenticate,
    authorize('fleetCustody.view'),
    validate({ query: FleetCustodyLedgerSummaryQuerySchema }),
    asyncHandler(custodyLedgerSummary),
  );
  router.get(
    '/ledger',
    authenticate,
    authorize('fleetCustody.view'),
    validate({ query: ListFleetCustodyLedgerQuerySchema }),
    asyncHandler(listCustodyLedger),
  );
  router.get(
    '/replenish/candidates',
    authenticate,
    authorize('fleetCustody.view'),
    asyncHandler(custodyReplenishCandidates),
  );
  router.get(
    '/settle/candidates',
    authenticate,
    authorize('fleetCustody.view'),
    asyncHandler(custodySettleCandidates),
  );
  router.get(
    '/operations/:id',
    authenticate,
    authorize('fleetCustody.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getCustodyOperation),
  );
  router.post(
    '/charge',
    authenticate,
    authorize('fleetCustody.view'),
    authorize('fleetReceipt.create'),
    validate({ body: CreateFleetCustodyChargeSchema }),
    asyncHandler(chargeCustody),
  );
  router.post(
    '/replenish',
    authenticate,
    authorize('fleetCustody.view'),
    authorize('fleetReceipt.create'),
    validate({ body: CreateFleetCustodyReplenishmentSchema }),
    asyncHandler(replenishCustody),
  );
  router.post(
    '/settle',
    authenticate,
    authorize('fleetCustody.view'),
    authorize('fleetReceipt.create'),
    validate({ body: CreateFleetCustodySettlementSchema }),
    asyncHandler(settleCustody),
  );
  router.post(
    '/operations/:id/transfer',
    authenticate,
    authorize('fleetCustody.view'),
    authorize('fleetReceipt.create'),
    validate({ params: IdParamSchema, body: ConfirmFleetCustodyTransferSchema }),
    asyncHandler(confirmCustodyTransfer),
  );
  router.post(
    '/operations/:id/cancel',
    authenticate,
    authorize('fleetCustody.view'),
    authorize('fleetReceipt.create'),
    validate({ params: IdParamSchema, body: CancelFleetCustodyReplenishmentSchema }),
    asyncHandler(cancelCustodyReplenishment),
  );
  return router;
};
