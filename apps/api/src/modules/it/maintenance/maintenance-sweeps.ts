// The preventive sweep (design §4.6, §4.8) — daily at 04:25.
//
// **Idempotency without a marks collection**, the same argument the help-desk sweeps make: the mark
// IS the record. A plan gets no second order while the one it generated is still `open` or
// `inProgress`, so the sweep is safe to run twice, to overlap with itself, or to replay after a
// crash — the second pass finds the first pass's order and generates nothing.
//
// It runs under the SYSTEM actor (`by: null`), which is exactly why each generated order is audited.
import { ItSettingKeys } from '@ecms/contracts';
import { logger } from '../../../infrastructure/logging/logger';
import { settingsService } from '../../../platform/settings';
import { itMaintenancePlanRepository } from './plan.repository';
import { itMaintenanceOrderService } from './order.service';
import { DAY_MS } from './plan.service';

/** A bound per run: a sweep is a heartbeat, not a migration. Anything left is taken next tick. */
const BATCH = 500;

/**
 * §4.6 — generate one `open` preventive order per active plan due within the horizon.
 *
 * The horizon looks FORWARD (`it.maintenance.preventiveHorizonDays`, default 7): preventive work is
 * scheduled, so the order has to exist before the date arrives for anyone to plan around it. That is
 * the difference between this and the SLA sweep, which only ever looks at clocks already run out.
 */
export const preventiveMaintenanceSweep = async (
  now = new Date(),
): Promise<{ generated: number; skipped: number }> => {
  // Organization scope — a sweep acts for the whole company, not for a user or a branch.
  const horizonDays = await settingsService.resolve<number>(ItSettingKeys.PreventiveHorizonDays, {
    userId: null,
    branchId: null,
  });
  if (typeof horizonDays !== 'number' || horizonDays < 0) return { generated: 0, skipped: 0 };

  const cutoff = new Date(now.getTime() + horizonDays * DAY_MS);
  const due = await itMaintenancePlanRepository.findDue(cutoff, BATCH);

  let generated = 0;
  let skipped = 0;
  for (const plan of due) {
    // `createFromPlan` returns null for the plans that must not generate — one already unfinished,
    // a deactivated plan, a disposed or missing asset. A skip is an outcome, not a failure.
    const order = await itMaintenanceOrderService.createFromPlan(plan._id);
    if (order === null) skipped += 1;
    else generated += 1;
  }

  if (generated > 0) logger.info({ generated, skipped }, 'it: preventive orders generated');
  return { generated, skipped };
};
