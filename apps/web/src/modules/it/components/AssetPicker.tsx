// Asset reference picker — ADR-019 rule 5, both halves.
//
// **Search to choose.** The register grows without bound, so typing queries the server; the
// browser never holds it to filter locally.
//
// **Resolve by id to display.** A form arriving with a stored `assetId` has an id and no search
// text, and still has to show a code and a name. `GET /it/assets/:id` answers exactly that.
//
// Scoped server-side by `itAsset.view`, so a branch-scoped technician searches only their branch —
// the picker adds no filter of its own, because a filter here would be a second, weaker rule.
//
// **One person's devices** (2026-11-17, the consumables' issue — «لما أكتب اسم الشخص اللى هسلمه
// تظهر الأجهزة اللى معاه بس»): given `holderEmployeeId`, the box offers only what that person holds
// right now (`GET /it/assets?holderEmployeeId=`, an OPEN custody interval) and lists it at once,
// without typing — a person holds a few, so it is not a catalog being loaded; past a page it is
// searched among, the same way. `showHolder` makes every row say the serial and who holds it, so a
// serial typed into the whole register says at once whose device it is. Both are optional: a
// caller passing neither gets exactly the box it had.
//
// **«جهاز آخر»** (2026-11-17 — the owner chose «أجهزته أولاً + «جهاز آخر»»): with `allowOther`, a
// button under the person's devices switches the box to the whole register — a shared printer's
// toner, a device in stock — its rows still saying the serial and the holder, and «أجهزة الموظف
// فقط» switches back. It is opened for ONE person: choosing somebody else lists their devices
// again. Optional too: without it a person's box offers their devices and nothing else.
//
// **A failed request is not an answer.** «لا يوجد في عهدة …» and «لا توجد نتائج» are said only for
// a request that came back empty; one that failed says so, with a retry.
//
// The decisions — which request, which facts on a row, what the list shows — are the pure helpers
// below the component (`pickerRequest`, `pickerRowFlags`, `pickerListShows`), proven without a
// browser; the component only wires them.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ItAssetDto, type ItAssetStatus, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Button } from '../../../shared/ui/Button';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Spinner } from '../../../shared/ui/Spinner';
import { CloseIcon } from '../../../shared/ui/icons';
import { listKey } from '../../../shared/lib/query-keys';
import { formatNumber } from '../../../shared/lib/format';
import { useItAsset } from '../api/it-queries';
import * as api from '../api/it-api';

const PAGE_SIZE = 8;
/** One person's devices are listed whole up to this many; past it, typing searches among them. */
const HOLDER_PAGE_SIZE = 50;

export const AssetPicker = ({
  value,
  onChange,
  ariaLabel,
  status,
  exclude = [],
  withoutStatus,
  holderEmployeeId = '',
  holderLabel = '',
  showHolder = false,
  allowOther = false,
}: {
  /** The picked asset id, '' when none. */
  value: string;
  /** The picked id, and the row it was picked from (its holder with it); '' alone when cleared. */
  onChange: (assetId: string, asset?: ItAssetDto) => void;
  ariaLabel?: string;
  /** Offer only assets in this state — a hand-over offers what is in stock (FR-18). */
  status?: ItAssetStatus;
  /** Ids already chosen elsewhere in the form — a receipt lists an asset once. */
  exclude?: readonly string[];
  /**
   * Leave out assets in this state — a consumable is installed on nothing written off (FR-20).
   * The server refuses it too; this only keeps the box from offering what can only be refused.
   */
  withoutStatus?: ItAssetStatus;
  /**
   * Offer only the devices this employee holds right now, listed without typing; '' (the default)
   * searches the whole register.
   */
  holderEmployeeId?: string;
  /** Who that is — the employee box's label — for the hint above the list and the empty answer. */
  holderLabel?: string;
  /** Every row also says the serial and who holds it («في عهدة …» / «في المخزن»). */
  showHolder?: boolean;
  /**
   * With a holder: «جهاز آخر» under their devices opens the whole register, and «أجهزة الموظف
   * فقط» comes back. Without it (the default) a person's box offers their devices only.
   */
  allowOther?: boolean;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [search, setSearch] = useState('');
  // The person «جهاز آخر» was opened for; null while their own devices are listed.
  const [otherFor, setOtherFor] = useState<string | null>(null);
  const allowed = can('itAsset.view');
  const byHolder = holderEmployeeId !== '';
  const typed = search.trim() !== '';
  const request = pickerRequest({ holderEmployeeId, allowOther, otherFor, search, status });
  const holderList = request.mode === 'holder';
  const other = request.mode === 'other';

  const results = useQuery({
    queryKey: request.queryKey,
    queryFn: () => api.listAssets(request.params),
    enabled: allowed && (request.untyped || typed),
    staleTime: 30_000,
  });

  const picked = useItAsset(allowed ? value : '');
  const offered = (results.data?.items ?? []).filter(
    (asset) => !exclude.includes(asset.id) && asset.status !== withoutStatus,
  );
  // A person's devices are listed until one is picked; typing lists in every mode.
  const listed = typed || (request.untyped && value === '');
  const shows = pickerListShows({
    holderList,
    typed,
    isPending: results.isPending,
    isError: results.isError,
    data: results.data === undefined ? undefined : offered.length,
  });
  const flags = pickerRowFlags({ showHolder, byHolder, other });
  const total = results.data?.meta.totalItems ?? 0;
  const more = holderList && !typed && total > (results.data?.items.length ?? 0);

  if (!allowed) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">{t('it.assets.pickerNoAccess')}</p>
    );
  }

  return (
    <div className="space-y-2">
      {value !== '' && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm dark:border-brand-900 dark:bg-brand-950/40">
          <span className="text-brand-800 dark:text-brand-200">
            {picked.data === undefined
              ? picked.isError
                ? t('it.assets.pickedUnresolved')
                : t('common.loading')
              : `${picked.data.assetCode} — ${picked.data.name}`}
          </span>
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label={t('it.assets.clearPick')}
            title={t('it.assets.clearPick')}
            className="rounded-md p-1 text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300 dark:hover:bg-brand-900/60"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {byHolder && (
        <p
          aria-live="polite"
          data-asset-picker-holder={holderEmployeeId}
          data-asset-picker-mode={request.mode}
          className="text-xs text-slate-500 dark:text-slate-400"
        >
          {other
            ? t('it.assets.pickerOtherHint')
            : holderLabel === ''
              ? t('it.assets.pickerHolderHintAnon')
              : t('it.assets.pickerHolderHint', { name: holderLabel })}
        </p>
      )}
      <SearchInput
        value={search}
        onChange={setSearch}
        aria-label={ariaLabel ?? t('it.assets.pickerPlaceholder')}
        placeholder={t('it.assets.pickerPlaceholder')}
      />
      {listed && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          {shows === 'loading' ? (
            <div className="grid place-items-center p-4">
              <Spinner />
            </div>
          ) : shows === 'holderError' || shows === 'searchError' ? (
            // Neutral, not the empty answer: nobody was told the person holds nothing.
            <div
              data-asset-picker-error={shows}
              className="flex flex-wrap items-center justify-between gap-2 p-3"
            >
              <p aria-live="polite" className="text-sm text-slate-600 dark:text-slate-300">
                {shows === 'searchError'
                  ? t('it.assets.pickerSearchError')
                  : holderLabel === ''
                    ? t('it.assets.pickerHolderErrorAnon')
                    : t('it.assets.pickerHolderError', { name: holderLabel })}
              </p>
              <Button size="sm" variant="secondary" onClick={() => void results.refetch()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : shows === 'holderNone' ? (
            <p role="note" className="p-4 text-sm text-slate-500 dark:text-slate-400">
              {holderLabel === ''
                ? t('it.assets.pickerHolderNoneAnon')
                : t('it.assets.pickerHolderNone', { name: holderLabel })}
            </p>
          ) : shows === 'noResults' ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              {t('it.assets.pickerNoResults')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {offered.map((asset) => (
                <li key={asset.id}>
                  <AssetPickerRow
                    asset={asset}
                    pressed={asset.id === value}
                    showSerial={flags.showSerial}
                    showHolder={flags.showHolder}
                    onPick={() => {
                      onChange(asset.id, asset);
                      setSearch('');
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          {more && (
            <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              {t('it.assets.pickerHolderMore', {
                shown: formatNumber(results.data?.items.length ?? 0, locale),
                total: formatNumber(total, locale),
              })}
            </p>
          )}
        </div>
      )}
      {/* Under the person's devices: the whole register, and the way back. */}
      {allowOther && byHolder && (
        <div>
          {other ? (
            <Button
              size="sm"
              variant="ghost-brand"
              data-asset-picker-toggle="holder"
              onClick={() => setOtherFor(null)}
            >
              {t('it.assets.pickerHolderOnly')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost-brand"
              data-asset-picker-toggle="other"
              onClick={() => setOtherFor(holderEmployeeId)}
            >
              {t('it.assets.pickerOther')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Which list the box is, and what it asks the server for:
 *   · `register` — no holder: the whole register, asked only once something is typed (today's
 *     request, exactly);
 *   · `holder` — one person's devices, asked and listed before a word is typed, the holder in the
 *     key so their list is never served to another box typed into with the same letters;
 *   · `other` — «جهاز آخر» opened from that list: the whole register's own request again. It is
 *     opened for one person (`otherFor`), so a box whose person changes lists the new one's
 *     devices; and only where the caller allows it.
 */
export const pickerRequest = ({
  holderEmployeeId,
  allowOther,
  otherFor,
  search,
  status,
}: {
  holderEmployeeId: string;
  allowOther: boolean;
  otherFor: string | null;
  search: string;
  status: ItAssetStatus | undefined;
}): {
  mode: 'register' | 'holder' | 'other';
  queryKey: readonly unknown[];
  params: api.ItListParams;
  /** Asked, and listed, before anything is typed. */
  untyped: boolean;
} => {
  const statusFilter = status === undefined ? {} : { status };
  const mode =
    holderEmployeeId === ''
      ? 'register'
      : allowOther && otherFor === holderEmployeeId
        ? 'other'
        : 'holder';
  if (mode === 'holder') {
    return {
      mode,
      queryKey: listKey('it', 'assets', { picker: search, status, holderEmployeeId }),
      params: {
        holderEmployeeId,
        pageSize: HOLDER_PAGE_SIZE,
        ...(search.trim() === '' ? {} : { search }),
        ...statusFilter,
      },
      untyped: true,
    };
  }
  return {
    mode,
    queryKey: listKey('it', 'assets', { picker: search, status }),
    params: { search, pageSize: PAGE_SIZE, ...statusFilter },
    untyped: false,
  };
};

/**
 * What a row says beside the name and the code. Neither new prop: nothing — the row every older
 * caller has always had. `showHolder` over the whole register: the serial and who holds it, so a
 * serial typed says whose device it is. One person's own list: the serial alone, since every row
 * there is theirs. «جهاز آخر» from it: the register again, so both.
 */
export const pickerRowFlags = ({
  showHolder,
  byHolder,
  other = false,
}: {
  showHolder: boolean;
  byHolder: boolean;
  other?: boolean;
}): { showSerial: boolean; showHolder: boolean } => ({
  showSerial: showHolder || byHolder,
  showHolder: byHolder ? other : showHolder,
});

/**
 * What the open list shows. An answer that came back empty is said as such — «لا يوجد في عهدة …»
 * for a person's untyped list, «لا توجد نتائج» for a search — but a request that FAILED is never
 * read as an empty answer: it says it failed, and offers a retry. An earlier answer still held
 * (a background refresh that failed) is still an answer, and is shown.
 */
export const pickerListShows = ({
  holderList,
  typed,
  isPending,
  isError,
  data,
}: {
  holderList: boolean;
  typed: boolean;
  isPending: boolean;
  isError: boolean;
  /** How many rows the answer offers; undefined while there is no answer. */
  data: number | undefined;
}): 'loading' | 'holderError' | 'searchError' | 'holderNone' | 'noResults' | 'rows' => {
  const holderUntyped = holderList && !typed;
  if (data === undefined) {
    if (isError) return holderUntyped ? 'holderError' : 'searchError';
    if (isPending) return 'loading';
  }
  if ((data ?? 0) === 0) return holderUntyped ? 'holderNone' : 'noResults';
  return 'rows';
};

/**
 * One row of the list — a button, keyboard-reachable, `aria-pressed` on the picked one. With
 * neither `showSerial` nor `showHolder` it is exactly the row the picker always had: the name and
 * the code. `showSerial` adds what tells two devices of one name apart; `showHolder` adds who holds
 * it («في عهدة …», or its state when nobody does — «في المخزن»), so a serial typed into the
 * register says at once whose device it is.
 */
export const AssetPickerRow = ({
  asset,
  pressed,
  showSerial = false,
  showHolder = false,
  onPick,
}: {
  asset: ItAssetDto;
  pressed: boolean;
  showSerial?: boolean;
  showHolder?: boolean;
  onPick: () => void;
}): JSX.Element => {
  const t = useT();
  const holder = asset.holder;
  const facts = showSerial || showHolder;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onPick}
      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800/60 ${
        pressed
          ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
          : 'text-slate-700 dark:text-slate-200'
      }`}
    >
      {facts ? (
        <span className="min-w-0 space-y-0.5">
          <span className="block">{asset.name}</span>
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-normal text-slate-500 dark:text-slate-400">
            {showSerial && asset.serialNumber !== null && (
              <span data-asset-serial={asset.serialNumber}>
                {t('it.assets.fields.serialNumber')}:{' '}
                <bdi dir="ltr" className="font-mono">
                  {asset.serialNumber}
                </bdi>
              </span>
            )}
            {showHolder && (
              <span data-asset-holder={holder?.employeeId ?? ''}>
                {holder === null
                  ? t(`it.assets.status.${asset.status}`)
                  : t('it.assets.pickerHeldBy', {
                      name: holder.employeeName ?? holder.employeeCode ?? holder.employeeId,
                    })}
              </span>
            )}
          </span>
        </span>
      ) : (
        <span>{asset.name}</span>
      )}
      {/* With the facts beside it the code keeps to one line on a phone; today's row is untouched. */}
      <span
        className={`font-mono text-xs text-slate-500${facts ? ' shrink-0 whitespace-nowrap' : ''}`}
        dir="ltr"
      >
        {asset.assetCode}
      </span>
    </button>
  );
};
