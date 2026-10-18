// One zone's details (docs/12-planning/atm-map-zones.md §8.8 `ZoneDetail`): by bank (a stacked bar
// and rows in the bank colours), by area, and its machines — the mockup's three columns, ten to a
// page; a row is a button that flies to the machine and opens its popup. Counts cover the visible
// points only (§6.4).
//
// «تعديل» shows only for a zone of the edit branch: edit mode always opens that branch (§8.6), so a
// button on another branch's zone would open a different branch's zones.
import { useState } from 'react';
import { ATM_BANK_NAMES, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { formatNumber } from '../../../../shared/lib/format';
import { NumberedPager } from '../../../../shared/ui/NumberedPager';
import { bankColor } from '../../lib/map-colors';
import { machineCountText } from '../../lib/map-count-text';
import { type ZoneBreakdown } from '../../lib/map-view';

const MACHINES_PER_PAGE = 10;

export const ZoneDetail = ({
  zone,
  breakdown,
  overlaps,
  locale,
  onBack,
  onEdit,
  onPickMachine,
}: {
  zone: { id: string; name: string; color: string };
  breakdown: ZoneBreakdown;
  /** How many other zones of its branch it overlaps. */
  overlaps: number;
  locale: Locale;
  onBack: () => void;
  /** Null: the zone is not of the edit branch, or the reader cannot edit. */
  onEdit: (() => void) | null;
  onPickMachine: (machineId: string) => void;
}): JSX.Element => {
  const t = useT();
  const [page, setPage] = useState(1);
  const bankLabel = (code: (typeof breakdown.banks)[number]['code']): string =>
    code === null ? t('atm.map.filters.bankNone') : ATM_BANK_NAMES[code][locale];
  const pages = Math.max(1, Math.ceil(breakdown.machines.length / MACHINES_PER_PAGE));
  const at = Math.min(page, pages);
  const machines = breakdown.machines.slice((at - 1) * MACHINES_PER_PAGE, at * MACHINES_PER_PAGE);
  const heading = 'text-[13px] font-semibold text-slate-600 dark:text-slate-300';

  return (
    <div data-zone-detail={zone.id} className="flex flex-col gap-3.5">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-[13px] text-brand-600 hover:text-brand-700 dark:text-brand-400"
      >
        <span aria-hidden="true" className="inline-block rtl:-scale-x-100">
          ‹
        </span>{' '}
        {t('atm.map.detail.back')}
      </button>
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 rounded-full"
          style={{ backgroundColor: zone.color }}
        />
        <h2 className="min-w-0 truncate text-lg font-semibold text-slate-900 dark:text-white">
          {zone.name}
        </h2>
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {machineCountText(breakdown.count, t, locale)}
        </span>
        {onEdit !== null && (
          <button
            type="button"
            data-zone-edit="true"
            onClick={onEdit}
            className="ms-auto rounded-lg border border-brand-200 px-3 py-1 text-[13px] text-brand-600 hover:bg-brand-50 dark:border-brand-800 dark:text-brand-300 dark:hover:bg-brand-950"
          >
            {t('atm.map.detail.edit')}
          </button>
        )}
      </div>
      {overlaps > 0 && (
        <p className="rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-2 text-[13px] text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-200">
          {t('atm.map.detail.overlapsOthers', { count: formatNumber(overlaps, locale) })}
        </p>
      )}
      <section className="flex flex-col gap-2">
        <h3 className={heading}>{t('atm.map.detail.byBank')}</h3>
        <div
          aria-hidden="true"
          className="flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
        >
          {breakdown.banks.map((bank) => (
            <span
              key={bank.code ?? 'none'}
              style={{ width: `${String(bank.pct)}%`, backgroundColor: bankColor(bank.code) }}
            />
          ))}
        </div>
        {breakdown.banks.map((bank) => (
          <div
            key={bank.code ?? 'none'}
            className="flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-300"
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(15,23,42,0.25)]"
              style={{ backgroundColor: bankColor(bank.code) }}
            />
            <span className="min-w-0 flex-1 truncate">{bankLabel(bank.code)}</span>
            <strong className="tabular-nums">{formatNumber(bank.count, locale)}</strong>
          </div>
        ))}
      </section>
      <section className="flex flex-col gap-1.5">
        <h3 className={heading}>{t('atm.map.detail.byArea')}</h3>
        {breakdown.areas.map((area) => (
          <div
            key={area.name}
            className="flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-300"
          >
            <span className="min-w-0 flex-1 truncate">{area.name}</span>
            <strong className="tabular-nums">{formatNumber(area.count, locale)}</strong>
          </div>
        ))}
      </section>
      <section className="flex flex-col gap-1">
        <h3 className={heading}>{t('atm.map.detail.machines')}</h3>
        <div
          aria-hidden="true"
          className="grid grid-cols-[64px_minmax(0,1fr)_56px] gap-2 px-2 text-[11px] text-slate-500 dark:text-slate-400"
        >
          <span>{t('atm.common.machineId')}</span>
          <span>{t('atm.common.machineName')}</span>
          <span>{t('atm.common.bank')}</span>
        </div>
        {machines.map((machine) => (
          <button
            key={machine.machineId}
            type="button"
            data-zone-machine={machine.machineId}
            onClick={() => onPickMachine(machine.machineId)}
            className="grid h-[34px] grid-cols-[64px_minmax(0,1fr)_56px] items-center gap-2 rounded-md px-2 text-start text-[13px] text-slate-900 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            <span dir="ltr" className="text-start font-mono text-xs font-bold">
              {machine.code}
            </span>
            <span className="truncate">{machine.name}</span>
            <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              {machine.bankCode ?? '—'}
            </span>
          </button>
        ))}
        {breakdown.machines.length > MACHINES_PER_PAGE && (
          <NumberedPager
            mark="zone-machines-pager"
            meta={{
              page: at,
              pageSize: MACHINES_PER_PAGE,
              totalItems: breakdown.machines.length,
              totalPages: pages,
            }}
            onPageChange={setPage}
          />
        )}
      </section>
    </div>
  );
};
