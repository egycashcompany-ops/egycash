// One machine's popup (docs/12-planning/atm-map-zones.md §8.8 `MachinePopup`, DM-19, DM-20): a
// React overlay over the map, never `L.popup` HTML — the name and the area are text people typed.
//
// It takes the focus when it opens and gives it back to whatever opened it when it closes (the
// page remembers the opener); Esc closes it. The links are only those the reader may follow: the
// register needs `atmRegister.view`, a move needs `atmMachine.locate` for the machine's branch.
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ATM_BANK_NAMES, type AtmMapPointDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { formatDateTime } from '../../../../shared/lib/format';
import { CloseIcon } from '../../../../shared/ui/icons';
import { bankColor } from '../../lib/map-colors';
import { googleMapsUrl, registerSearchUrl } from '../../lib/map-links';

export interface PopupZone {
  primary: { name: string; color: string } | null;
  /** Every zone that contains the machine, in list order. */
  all: readonly string[];
}

export const MachinePopup = ({
  point,
  branchName,
  zone,
  locale,
  canOpenRegister,
  canMove,
  onClose,
  onMove,
  onNavigate,
}: {
  point: AtmMapPointDto;
  branchName: string;
  zone: PopupZone;
  locale: Locale;
  canOpenRegister: boolean;
  canMove: boolean;
  onClose: () => void;
  onMove: () => void;
  /** The page's own navigation (§8.7). */
  onNavigate: (to: string) => void;
}): JSX.Element => {
  const t = useT();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, [point.machineId]);

  const bank =
    point.bankCode === null
      ? t('atm.map.filters.bankNone')
      : `${ATM_BANK_NAMES[point.bankCode][locale]} (${point.bankCode})`;
  const zoneText =
    zone.all.length > 1 && zone.primary !== null
      ? t('atm.map.popup.zoneMulti', { names: zone.all.join('، '), primary: zone.primary.name })
      : (zone.primary?.name ?? t('atm.map.filters.zoneNone'));
  const lastSet =
    point.lastSet === null
      ? null
      : {
          label: t(
            point.lastSet.kind === 'moved' ? 'atm.map.popup.lastSet' : 'atm.map.popup.approved',
          ),
          value: [point.lastSet.byName, formatDateTime(point.lastSet.at, locale)]
            .filter((part) => part !== null && part !== '')
            .join(' · '),
        };
  const register = registerSearchUrl(point.code);
  const term = 'text-slate-500';

  return (
    <div
      ref={panel}
      tabIndex={-1}
      role="dialog"
      aria-label={point.code}
      data-machine-popup={point.machineId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
      className="w-[280px] overflow-hidden rounded-xl border border-slate-200 bg-white text-[13px] text-slate-900 shadow-[0_12px_32px_-12px_rgba(15,23,42,0.28),0_4px_12px_-4px_rgba(15,23,42,0.12)] outline-none"
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-3">
        <span dir="ltr" className="font-mono text-base font-bold">
          {point.code}
        </span>
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(15,23,42,0.3)]"
          style={{ backgroundColor: bankColor(point.bankCode) }}
        />
        <span
          className={
            point.active
              ? 'rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700'
              : 'rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600'
          }
        >
          {t(point.active ? 'atm.map.status.active' : 'atm.map.status.archived')}
        </span>
        {point.state === 'review' && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
            {t('atm.map.location.review')}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('atm.map.popup.close')}
          title={t('atm.map.popup.close')}
          className="ms-auto rounded-md p-1 text-slate-500 hover:bg-slate-100"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 px-3.5 py-2.5">
        <dt className={term}>{t('atm.common.machineName')}</dt>
        <dd className="font-medium">{point.name}</dd>
        <dt className={term}>{t('atm.common.bank')}</dt>
        <dd>{bank}</dd>
        <dt className={term}>{t('atm.common.area')}</dt>
        <dd>{point.area}</dd>
        <dt className={term}>{t('atm.map.popup.branch')}</dt>
        <dd>{branchName}</dd>
        <dt className={term}>{t('atm.map.popup.zone')}</dt>
        <dd className="flex items-center gap-1.5">
          {zone.primary !== null && (
            <span
              aria-hidden="true"
              className="h-[9px] w-[9px] shrink-0 rounded-full"
              style={{ backgroundColor: zone.primary.color }}
            />
          )}
          <span>{zoneText}</span>
        </dd>
        {point.source !== null && (
          <>
            <dt className={term}>{t('atm.map.popup.source')}</dt>
            <dd>{t(`atm.map.source.${point.source}`)}</dd>
          </>
        )}
        {lastSet !== null && (
          <>
            <dt className={term}>{lastSet.label}</dt>
            <dd>{lastSet.value}</dd>
          </>
        )}
      </dl>
      {point.warnings.includes('outsideEgypt') && (
        <p
          data-popup-outside="true"
          className="mx-3.5 mb-2.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs leading-[1.7] text-amber-800"
        >
          {t('atm.map.location.outsideEgypt')}
        </p>
      )}
      <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 border-t border-slate-100 px-3.5 pb-3 pt-2.5 text-[12.5px]">
        {canOpenRegister && (
          <Link
            to={register}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(register);
            }}
            className="text-brand-600 underline-offset-2 hover:underline"
          >
            {t('atm.map.popup.openRegister')}
          </Link>
        )}
        {point.lat !== null && point.lng !== null && (
          <a
            href={googleMapsUrl({ lat: point.lat, lng: point.lng })}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-600 underline-offset-2 hover:underline"
          >
            {t('atm.map.popup.openGoogle')}
          </a>
        )}
        {canMove && (
          <button
            type="button"
            onClick={onMove}
            className="text-amber-700 underline-offset-2 hover:underline"
          >
            {t('atm.map.popup.move')}
          </button>
        )}
      </div>
    </div>
  );
};
