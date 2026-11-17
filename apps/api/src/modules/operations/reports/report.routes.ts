// The Operations reports.
//
// The captain report rides `operationsShipment.view`: a report is a READ of the shipments the
// caller can already see, not a separate decision. Legacy had no working authorization on it —
// `/ops_report`'s check was commented out entirely (discovery Q36) — so this is a gap being
// closed, not parity.
import { Router } from 'express';
import {
  OPERATIONS_BANK_REPORT_KEYS,
  OperationsReportQuerySchema,
  OperationsVaultHeldReportQuerySchema,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { getBankReport, getCaptainReport, getVaultHeldReport } from './report.controller';

export const buildOperationsReportsRouter = (): Router => {
  const router = Router();
  router.get(
    '/captains',
    authenticate,
    authorize('operationsShipment.view'),
    validate({ query: OperationsReportQuerySchema }),
    asyncHandler(getCaptainReport),
  );
  // «تقرير البنوك» (Round 14) — what used to be «تجميع الخزينة» (`/vault`, gone): «خلي المحتوى بتاع
  // تجميع خزينه ده يبقى اسمه تقرير بنوك». Every secured shipment RECEIVED INTO THE VAULT in the
  // period, per bank, delivered since or not. ONE endpoint for the one report, at the screen's own
  // name, so the code says bank report from the sidebar down to the query; the old completed-per-
  // bank answer this path gave is gone with the screen that showed it.
  //
  // ANY OF two grants (`OPERATIONS_BANK_REPORT_KEYS`): the shipments' readers had «تقرير البنوك»
  // and the vault's had «تجميع الخزينة», and the screen that is left must not take a report away
  // from either. It reads shipments' money and the vault's packages, so both are its readers.
  //
  // Its «من» / «إلى» are the captain report's (the same schema, the same defaults): legacy's picker
  // filtered nothing (Q32). The owner said what they mean — «يجيب اللى اتسلم واللى متسلمش ويجيب
  // البداية كل اول شهر»: everything the vault received in the period, delivered or not, opening on
  // the first of the month — judged on the receipt's Cairo day.
  router.get(
    '/banks',
    authenticate,
    authorizeAny(...OPERATIONS_BANK_REPORT_KEYS),
    validate({ query: OperationsReportQuerySchema }),
    asyncHandler(getBankReport),
  );
  // «تقرير الخزينة» (Round 12) — what the vault holds NOW, per bank, on top of «سجل الخزينة»: the
  // vault screens' grant and the bank report's table, with no period («بس مفيش فتر من الى هيكون
  // لحظى»). A literal path; nothing here reads a `:param`.
  router.get(
    '/vault/held',
    authenticate,
    authorize('operationsVault.view'),
    validate({ query: OperationsVaultHeldReportQuerySchema }),
    asyncHandler(getVaultHeldReport),
  );

  return router;
};
