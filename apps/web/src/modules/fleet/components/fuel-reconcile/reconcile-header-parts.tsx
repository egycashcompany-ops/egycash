// «مطابقة أرصدة الكروت» — the header's batch-3 pieces (a split of `ReconcileHeader.tsx`):
//
//   · «طريقة قراءة الشيت»: which column was read as what — the number (full or masked), the name
//     (as printed, or rebuilt from the company prefix + the plate + the chassis), the balance and
//     the car code; untitled columns read by their content; the columns recognised and never read
//     («قيمه الشحن», the PIN); and the first card row's rebuilt name. The PIN is never read.
//   · The wrong-company STOP: the sheet's names belong to the other company, so nothing is
//     compared — one click reads the same file as the sheet's company.
//   · The guard banner: more than half the card rows found no card.
import {
  FLEET_FUEL_SHEET_NAME_PREFIX,
  type FleetFuelCardCompany,
  type FleetFuelReconcileDto,
  type FleetFuelSheetLayoutColumnDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { BoardIcon, CompanyBadge, NUM, PATH } from '../FuelCardBoard';
import { matchedRowsOf, numberKindOf } from '../../lib/fuel-reconcile';
import { useReconcileCount } from '../../lib/fuel-reconcile-words';

/** A column's letter in its small square — «A». */
const Column = ({ letter }: { letter: string }): JSX.Element => (
  <span
    dir="ltr"
    className={cn(
      NUM,
      'inline-flex h-5 min-w-5 items-center justify-center rounded border border-[#6c63ff]/40 bg-[#6c63ff]/10 px-1 text-[11px] font-bold text-[#4f3dff] dark:text-[#a59dff]',
    )}
  >
    {letter}
  </span>
);

const ROLE_CHIP =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-[#0b0f19] dark:text-slate-200';
const ROLE_NOTE = 'text-[11px] font-semibold text-slate-500 dark:text-slate-400';

type Role = FleetFuelSheetLayoutColumnDto['role'];

/** «طريقة قراءة الشيت» — nothing on an old session read before the layout was kept. */
export const LayoutLine = ({ result }: { result: FleetFuelReconcileDto }): JSX.Element | null => {
  const t = useT();
  if (result.layout.length === 0) return null;
  const L = 'fleet.fuelCards.reconcile.layout.';
  const of = (role: Role): FleetFuelSheetLayoutColumnDto | undefined =>
    result.layout.find((column) => column.role === role);
  const number = of('number');
  const name = of('name');
  const plate = of('plate');
  const chassis = of('chassis');
  const balance = of('balance');
  const code = of('code');
  const notRead = result.layout.filter((c) => c.role === 'ignored' || c.role === 'secret');
  const assumed = [plate, chassis].filter(
    (c): c is FleetFuelSheetLayoutColumnDto => c?.assumed === true,
  );
  const kind = numberKindOf(result);
  const roleChip = (column: FleetFuelSheetLayoutColumnDto, note?: string): JSX.Element => (
    <span className={ROLE_CHIP} data-recon-layout-role={column.role}>
      <Column letter={column.column} />
      {t(`${L}role.${column.role}`)}
      {note !== undefined && <span className={ROLE_NOTE}>· {note}</span>}
    </span>
  );
  return (
    <section
      data-recon-layout="true"
      className="space-y-2.5 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-[#111827]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="me-1 inline-flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
          <BoardIcon d={PATH.excel} className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          {t(`${L}title`)}
        </span>
        {number !== undefined && roleChip(number, kind === null ? undefined : t(`${L}${kind}`))}
        {name !== undefined && (
          <span className={ROLE_CHIP} data-recon-layout-role="name">
            {t(`${L}role.name`)} =
            {result.nameRebuilt ? (
              <>
                <span className="inline-flex items-center gap-1">
                  {t(`${L}companyWord`)} <Column letter={name.column} />
                </span>
                {plate !== undefined && (
                  <>
                    +
                    <span className="inline-flex items-center gap-1">
                      {t(`${L}role.plate`)} <Column letter={plate.column} />
                    </span>
                  </>
                )}
                {chassis !== undefined && (
                  <>
                    +
                    <span className="inline-flex items-center gap-1">
                      {t(`${L}role.chassis`)} <Column letter={chassis.column} />
                    </span>
                  </>
                )}
              </>
            ) : (
              <Column letter={name.column} />
            )}
          </span>
        )}
        {assumed.length > 0 && (
          <span
            data-recon-layout-assumed="true"
            className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
          >
            <BoardIcon d={PATH.warn} className="h-3.5 w-3.5" />
            {assumed.map((c, i) => (
              <span key={c.column} className="inline-flex items-center gap-1">
                {i > 0 && t(`${L}and`)}
                <Column letter={c.column} />
              </span>
            ))}
            {t(assumed.length > 1 ? `${L}untitled` : `${L}untitledOne`)}
          </span>
        )}
        {balance !== undefined && roleChip(balance)}
        {code !== undefined && roleChip(code)}
        {notRead.length > 0 && (
          <span
            data-recon-layout-not-read="true"
            className="inline-flex flex-wrap items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400"
          >
            {t(`${L}notRead`)}
            {notRead.map((column) => (
              <span
                key={column.column}
                className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-2 py-0.5 text-slate-500 dark:border-slate-600 dark:text-slate-400"
              >
                <Column letter={column.column} />
                {column.header ?? t(`${L}role.${column.role}`)}
              </span>
            ))}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 dark:text-slate-300">
        {result.example !== null && (
          <span className="inline-flex items-center gap-1.5" data-recon-layout-example="true">
            {t(`${L}example`, { row: result.example.row })}
            <span
              dir="ltr"
              className="rounded border border-slate-200 bg-slate-50 px-1.5 py-px font-figures text-[13px] font-bold text-slate-900 dark:border-slate-700 dark:bg-[#0b0f19] dark:text-white"
            >
              {result.example.builtName}
            </span>
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
          <BoardIcon d={PATH.lock} className="h-3.5 w-3.5" />
          {t(`${L}neverPin`)}
        </span>
      </div>
    </section>
  );
};

const ANOTHER =
  'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-bold transition';

/**
 * The wrong company STOPS the comparison (nothing below it is drawn): what the sheet's names
 * say, and one click that reads the same file as the sheet's company — or another sheet.
 */
export const WrongCompanyStop = ({
  result,
  sheetSays,
  onSwitch,
  onAnother,
}: {
  result: FleetFuelReconcileDto;
  sheetSays: FleetFuelCardCompany;
  onSwitch: (company: FleetFuelCardCompany) => void;
  onAnother: () => void;
}): JSX.Element => {
  const t = useT();
  const count = useReconcileCount();
  const companyName = (company: FleetFuelCardCompany): string =>
    t(`fleet.fuelCards.company.${company}`);
  const R = 'fleet.fuelCards.reconcile.';
  return (
    <section
      role="alert"
      data-recon-wrong-company="true"
      className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-red-500/40 bg-red-50 px-5 py-5 dark:bg-red-950/40"
    >
      <span className="flex min-w-0 flex-1 items-start gap-3">
        <span className="rounded-xl bg-red-500/15 p-2.5 text-red-700 dark:text-red-300">
          <BoardIcon d={PATH.warn} className="h-6 w-6" />
        </span>
        <span className="min-w-0 space-y-1.5">
          <span className="flex flex-wrap items-center gap-2 text-base font-bold text-red-800 dark:text-red-100">
            {t(`${R}wrongCompanyTitle`, {
              sheet: companyName(sheetSays),
              picked: companyName(result.company),
            })}
            <CompanyBadge company={sheetSays} />
          </span>
          <span className="block text-sm leading-relaxed text-red-800 dark:text-red-200">
            {t(`${R}wrongCompanyBody`, {
              rows: count.rows(result.cardRows),
              // The statements print the bare prefix («EGYCASHTCS»), so the sentence names it so.
              prefix: FLEET_FUEL_SHEET_NAME_PREFIX[sheetSays].replace(/-$/u, ''),
              sheet: companyName(sheetSays),
            })}
          </span>
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-recon-switch={sheetSays}
          onClick={() => onSwitch(sheetSays)}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#4f3dff] to-[#6a5cff] px-5 text-sm font-bold text-white shadow-[0_6px_24px_rgba(91,76,255,0.45)] transition hover:from-[#5a4aff] hover:to-[#7a6dff]"
        >
          <BoardIcon d={PATH.trend} className="h-4 w-4" />
          {t(`${R}wrongCompanySwitch`, { sheet: companyName(sheetSays) })}
        </button>
        <button
          type="button"
          data-recon-wrong-another="true"
          onClick={onAnother}
          className={cn(
            ANOTHER,
            'h-11 border-red-300 bg-white text-red-800 hover:bg-red-100 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-100 dark:hover:bg-red-500/20',
          )}
        >
          <BoardIcon d={PATH.excel} className="h-3.5 w-3.5" />
          {t(`${R}another`)}
        </button>
      </span>
    </section>
  );
};

/** More than half the card rows found no card: say so before anything is applied. */
export const GuardBanner = ({ result }: { result: FleetFuelReconcileDto }): JSX.Element => {
  const t = useT();
  const count = useReconcileCount();
  return (
    <p
      role="alert"
      data-recon-guard="true"
      className="flex items-start gap-2 rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm font-bold leading-relaxed text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <BoardIcon d={PATH.warn} className="mt-0.5 h-4 w-4 shrink-0" />
      {t('fleet.fuelCards.reconcile.guard', {
        matched: matchedRowsOf(result),
        rows: count.rows(result.cardRows),
      })}
    </p>
  );
};
