// «تصحيح أرقام الكروت» (6d) — the bar along the bottom while the repair is not done (samples 01, 04,
// 08), and the block that replaces the rule once it is (06).
//
// The bar counts what «تنفيذ التصحيح» will correct — the records of the READY units — and what it
// skips (a held unit, named). The button is there only for a reader holding both grants the server
// asks (`fleetFuelCard.edit` + `fleetFuelCharge.approve`); anyone else reads who may run it. With
// no unit ready the button is off and says why. It opens the confirmation; it never writes.
import { type FleetFuelNumberRepairDto } from '@ecms/contracts';
import { Link } from 'react-router-dom';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { cn } from '../../../../shared/lib/cn';
import { BoardIcon } from '../FuelCardBoard';
import { TITLE } from '../custody-dashboard-parts';
import {
  RECONCILE_PATH,
  REPAIR_AUDIT_PATH,
  heldUnitsOf,
  mayExecute,
} from '../../lib/fuel-number-repair';
import { N } from '../../lib/fuel-number-repair-words';
import { useReconcileCount } from '../../lib/fuel-reconcile-words';
import { BUTTON, QUIET } from './repair-looks';
import { ICON } from './repair-parts';
import { useUnitName } from './RepairHeader';

export const RepairActionBar = ({
  repair,
  onRun,
}: {
  repair: FleetFuelNumberRepairDto;
  onRun: () => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const count = useReconcileCount();
  const unitName = useUnitName();
  const held = heldUnitsOf(repair);
  const heldRecords = held.reduce((sum, unit) => sum + unit.records, 0);
  const allowed = mayExecute(can);
  const none = repair.readyUnits.length === 0;
  return (
    <div
      data-repair-bar="true"
      className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-8px_30px_-12px_rgba(15,23,42,0.25)] backdrop-blur dark:border-slate-700 dark:bg-[#111827]/95"
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span
          className="text-sm font-bold text-slate-900 dark:text-white"
          data-repair-bar-count="true"
        >
          {t(`${N}bar.fix`, {
            cards: count.cards(repair.counts.ready),
            all: repair.counts.records,
          })}
          {heldRecords > 0 && (
            <span className="text-red-700 dark:text-red-300">
              {t(`${N}bar.skip`, {
                cards: count.cards(heldRecords),
                units: held.map((unit) => unitName(unit)).join(t(`${N}and`)),
              })}
            </span>
          )}
        </span>
        <span className="text-[12px] text-slate-500 dark:text-slate-400">{t(`${N}bar.note`)}</span>
        {allowed && none && (
          <span
            className="text-[12px] font-semibold text-amber-700 dark:text-amber-300"
            data-repair-none-ready="true"
          >
            {t(`${N}bar.noneReady`)}
          </span>
        )}
        {!allowed && (
          <span
            className="text-[12px] font-semibold text-slate-600 dark:text-slate-300"
            data-repair-no-grant="true"
          >
            {t(`${N}bar.noGrant`)}
          </span>
        )}
      </span>
      {allowed && (
        <button
          type="button"
          data-repair-run="true"
          disabled={none}
          onClick={onRun}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-[15px] font-bold text-white shadow-[0_6px_22px_rgba(16,185,129,0.40)] transition hover:bg-emerald-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-400"
        >
          <BoardIcon d={ICON.fix} className="h-4 w-4" />
          {t(`${N}bar.run`)}
        </button>
      )}
    </div>
  );
};

const Point = ({ children }: { children: string }): JSX.Element => (
  <li className="flex items-start gap-2">
    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#6c63ff]" />
    {children}
  </li>
);

/** After execution: what was done, and the next step — the newest statement in «مطابقة الأرصدة». */
export const RepairDoneBlock = ({ repair }: { repair: FleetFuelNumberRepairDto }): JSX.Element => {
  const t = useT();
  const can = useCan();
  return (
    <div className="space-y-4" data-repair-done="true">
      <div
        role="status"
        className="flex items-start gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/[0.08] dark:text-emerald-100"
      >
        <BoardIcon
          d={ICON.ok}
          className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
        />
        <span className="space-y-1">
          <b className="block text-[15px]">
            {t(`${N}done.title`, {
              records: repair.counts.records,
              crossed: repair.counts.crossed,
            })}
          </b>
          <span className="block leading-relaxed">{t(`${N}done.body`)}</span>
        </span>
      </div>
      <section
        data-repair-next="true"
        className="relative overflow-hidden rounded-2xl border-2 border-[#6c63ff]/60 bg-white px-5 py-4 shadow-[0_0_0_1px_rgba(108,99,255,0.15),0_12px_32px_-14px_rgba(108,99,255,0.55)] dark:border-[#6c63ff]/60 dark:bg-[#121c3f]"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#6c63ff]/40 bg-[#6c63ff]/10 px-2.5 py-0.5 text-xs font-bold text-[#4f3dff] dark:text-[#a59dff]">
              <BoardIcon d={ICON.step} className="h-3.5 w-3.5" />
              {t(`${N}next.tag`)}
            </span>
            <h2 className={cn(TITLE, 'text-lg')}>{t(`${N}next.title`)}</h2>
            <ul className="space-y-1 text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">
              <Point>{t(`${N}next.one`)}</Point>
              <Point>{t(`${N}next.two`)}</Point>
              <Point>{t(`${N}next.three`)}</Point>
            </ul>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-2">
            <Link
              to={RECONCILE_PATH}
              data-repair-open-reconcile="true"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#4f3dff] to-[#6a5cff] px-6 py-2.5 text-[15px] font-bold text-white shadow-[0_6px_24px_rgba(91,76,255,0.45)] transition hover:from-[#5a4aff] hover:to-[#7a6dff]"
            >
              <BoardIcon d={ICON.excel} className="h-4 w-4" />
              {t(`${N}next.open`)}
            </Link>
            {can('auditLog.view') && (
              <Link
                to={REPAIR_AUDIT_PATH}
                data-repair-audit="true"
                className={cn(BUTTON, QUIET, 'justify-center')}
              >
                <BoardIcon d={ICON.shield} className="h-3.5 w-3.5" />
                {t(`${N}next.audit`)}
              </Link>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
