// The Operations reports.
//
// The captain and bank reports ride `operationsShipment.view`: a report is a READ of the
// shipments the caller can already see, not a separate decision. Legacy had no working
// authorization on either — `/ops_report`'s check was commented out entirely (discovery Q36) — so
// this is a gap being closed, not parity.
import { Router } from 'express';
import { OperationsReportQuerySchema, OperationsVaultHeldReportQuerySchema } from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  getBankReport,
  getCaptainReport,
  getVaultHeldReport,
  getVaultReport,
} from './report.controller';

export const buildOperationsReportsRouter = (): Router => {
  const router = Router();
  router.get(
    '/captains',
    authenticate,
    authorize('operationsShipment.view'),
    validate({ query: OperationsReportQuerySchema }),
    asyncHandler(getCaptainReport),
  );
  router.get(
    '/banks',
    authenticate,
    authorize('operationsShipment.view'),
    validate({ query: OperationsReportQuerySchema }),
    asyncHandler(getBankReport),
  );
  // The vault roll-up rides `operationsVault.view`, NOT the shipment grant: it reports on what
  // the treasury took in, and the legacy screen sat behind the vault screens for the same reason.
  //
  // Its «من» / «إلى» are the other reports' (the same schema, the same defaults): legacy's picker
  // filtered nothing (Q32), and this route used to refuse the two dates rather than pretend to
  // honour them. The owner has since said what they mean — «يجيب اللى اتسلم واللى متسلمش ويجيب
  // البداية كل اول شهر»: everything the vault received in the period, delivered or not, opening on
  // the first of the month — so they are honoured now, on the receipt's Cairo day.
  router.get(
    '/vault',
    authenticate,
    authorize('operationsVault.view'),
    validate({ query: OperationsReportQuerySchema }),
    asyncHandler(getVaultReport),
  );
  // «تقرير الخزينة» (Round 12) — what the vault holds NOW, per bank, on top of «سجل الخزينة»: the
  // roll-up's grant and the roll-up's table, with no period («بس مفيش فتر من الى هيكون لحظى»). A
  // literal path under `/vault`, so it is declared beside it; nothing here reads a `:param`.
  router.get(
    '/vault/held',
    authenticate,
    authorize('operationsVault.view'),
    validate({ query: OperationsVaultHeldReportQuerySchema }),
    asyncHandler(getVaultHeldReport),
  );

  return router;
};
