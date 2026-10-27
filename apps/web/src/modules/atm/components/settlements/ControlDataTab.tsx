// «البيانات والسيلزات» (S-8 a, §9.7 Tab 1): every issued, prepared and cancelled line of the day, of
// every enabled bank, with its bags' QRs and its cassette seals as Preparation captured them, and
// the crew line it travels on. «النوع» and «المنطقة» are the seals sheet's TYPE and HUB. A
// duplicate shows ⚠ with Preparation's own words (DS-15); expanding a row lists its seals.
import { Fragment, useState } from 'react';
import { ATM_BANK_NAMES, type AtmControlDayDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { formatNumber } from '../../../../shared/lib/format';
import { Badge } from '../../../../shared/ui/Badge';
import { ChevronIcon } from '../../../../shared/ui/icons';
import {
  PREPARATION_STATUS_TONE,
  formatEgp,
  lineCode,
  preparationStatusKey,
} from '../../lib/settlement-view';
import { DuplicateNote, duplicateTexts } from './DuplicateNote';
import { RunChip } from './RunChip';

type ControlLine = AtmControlDayDto['lines'][number];

const TH = 'px-3 py-2.5 text-start text-xs font-semibold text-slate-600 dark:text-slate-300';
const TD = 'px-3 py-2.5 align-middle text-sm text-slate-700 dark:text-slate-200';

/** A bag's QR cell: the value, or «—», with ⚠ and the warning's words when it is a duplicate. */
const QrCell = ({ line, bag }: { line: ControlLine; bag: 1 | 2 }): JSX.Element => {
  const t = useT();
  const qr = line.bags.find((b) => b.bag === bag)?.qr ?? null;
  const duplicate = line.duplicates.find((d) => d.field === 'bag' && d.bag === bag);
  const words = duplicate === undefined ? [] : duplicateTexts(undefined, duplicate, t);
  return (
    <span className="inline-flex items-center gap-1">
      <span dir="ltr" className="font-mono text-xs">
        {qr ?? '—'}
      </span>
      {words.length > 0 && (
        <span
          title={words.join(' ')}
          className="text-orange-600 dark:text-orange-400"
          data-control-duplicate="bag"
        >
          ⚠<span className="sr-only">{words.join(' ')}</span>
        </span>
      )}
    </span>
  );
};

export const ControlDataTab = ({
  day,
  locale,
}: {
  day: AtmControlDayDto;
  locale: Locale;
}): JSX.Element => {
  const t = useT();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const routeName = new Map(day.routes.map((r) => [r.id, r.name]));
  const toggle = (id: string): void =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <table className="w-full min-w-[72rem] border-collapse" data-control-lines="true">
        <thead className="bg-slate-50 dark:bg-slate-800/60">
          <tr>
            <th className={cn(TH, 'w-8')}>
              <span className="sr-only">{t('atm.control.column.seals')}</span>
            </th>
            <th className={TH}>{t('atm.settlement.serial')}</th>
            <th className={TH}>{t('atm.settlement.bank')}</th>
            <th className={TH}>{t('atm.settlement.machineCode')}</th>
            <th className={TH}>{t('atm.settlement.machineName')}</th>
            <th className={TH}>{t('atm.control.column.type')}</th>
            <th className={TH}>{t('atm.settlement.area')}</th>
            <th className={TH}>{t('atm.settlement.run')}</th>
            <th className={cn(TH, 'text-end')}>{t('atm.settlement.total')}</th>
            <th className={TH}>{t('atm.control.column.qr1')}</th>
            <th className={TH}>{t('atm.control.column.qr2')}</th>
            <th className={TH}>{t('atm.control.column.seals')}</th>
            <th className={TH}>{t('atm.control.column.preparation')}</th>
            <th className={TH}>{t('atm.control.column.route')}</th>
          </tr>
        </thead>
        <tbody>
          {day.lines.map((line) => {
            const sealsCaptured = line.seals.filter((s) => s.value !== null).length;
            const complete = line.seals.length > 0 && sealsCaptured === line.seals.length;
            const sealDuplicate = line.duplicates.some((d) => d.field === 'seal');
            const expanded = open.has(line.lineId);
            const cancelled = line.lineStatus === 'cancelled';
            return (
              <Fragment key={line.lineId}>
                <tr
                  data-control-line={line.lineId}
                  className={cn(
                    'border-t border-slate-100 dark:border-slate-800',
                    cancelled && 'text-slate-400',
                  )}
                >
                  <td className={TD}>
                    <button
                      type="button"
                      onClick={() => toggle(line.lineId)}
                      aria-expanded={expanded}
                      aria-label={`${t('atm.control.column.seals')} — ${lineCode(line)}`}
                      className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <ChevronIcon
                        className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')}
                      />
                    </button>
                  </td>
                  <td className={cn(TD, 'tabular-nums')}>
                    {line.serial === null ? '—' : formatNumber(line.serial, locale)}
                  </td>
                  <td className={TD}>{ATM_BANK_NAMES[line.bankCode][locale]}</td>
                  <td className={TD}>
                    <span dir="ltr" className="font-medium">
                      {lineCode(line)}
                    </span>
                  </td>
                  <td className={TD}>
                    {line.kind === 'spare'
                      ? `${t('atm.paper.spareSet')} ${line.typeLabel ?? ''}`.trim()
                      : (line.machineName ?? '—')}
                  </td>
                  <td className={TD}>{line.typeLabel ?? '—'}</td>
                  <td className={TD}>{line.hubLabel ?? line.area ?? '—'}</td>
                  <td className={TD}>
                    <RunChip run={line.run} time={line.scheduleTime} locale={locale} />
                  </td>
                  <td className={cn(TD, 'text-end tabular-nums')}>
                    {formatEgp(line.egpTotalMinor, locale)}
                  </td>
                  <td className={TD}>
                    <QrCell line={line} bag={1} />
                  </td>
                  <td className={TD}>
                    {line.bags.some((b) => b.bag === 2) ? <QrCell line={line} bag={2} /> : '—'}
                  </td>
                  <td className={TD}>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                        complete
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : sealsCaptured > 0
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                      )}
                    >
                      {t('atm.control.sealsProgress', {
                        n: formatNumber(sealsCaptured, locale),
                        m: formatNumber(line.seals.length, locale),
                      })}
                      {complete && ' ✓'}
                    </span>
                    {sealDuplicate && (
                      <span
                        className="ms-1 text-orange-600 dark:text-orange-400"
                        data-control-duplicate="seal"
                      >
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className={TD}>
                    <Badge
                      size="sm"
                      tone={cancelled ? 'neutral' : PREPARATION_STATUS_TONE[line.preparationStatus]}
                    >
                      {cancelled
                        ? t('atm.settlement.status.cancelled')
                        : t(preparationStatusKey(line.preparationStatus))}
                    </Badge>
                  </td>
                  <td className={TD}>
                    {/* A route that is not live (deleted) holds nothing: the line is unassigned. */}
                    {(line.routeId === null ? undefined : routeName.get(line.routeId)) ??
                      t('atm.control.unassignedOption')}
                  </td>
                </tr>
                {expanded && (
                  <tr
                    className="bg-slate-50/60 dark:bg-slate-800/30"
                    data-control-seals={line.lineId}
                  >
                    <td />
                    <td colSpan={13} className="px-3 py-2.5">
                      <ul className="grid gap-1 text-sm sm:grid-cols-2">
                        {line.seals.map((seal) => {
                          const duplicate = line.duplicates.find(
                            (d) => d.field === 'seal' && d.slot === seal.slot,
                          );
                          return (
                            <li key={seal.slot}>
                              <span className="text-slate-700 dark:text-slate-200">
                                {t('atm.control.sealRow', {
                                  slot: seal.slot,
                                  d: seal.denomination ?? '—',
                                  value: seal.value ?? '—',
                                })}
                              </span>
                              {duplicate !== undefined && (
                                <span
                                  aria-live="polite"
                                  className="block text-xs text-orange-700 dark:text-orange-300"
                                >
                                  <DuplicateNote local={undefined} server={duplicate} />
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
