// إدارة وشحن الكروت — every car's two cards and their balances; a charge is REQUESTED on the row
// and then APPROVED (✓) or taken back (✕); balances move between cards through the transfer.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FleetSettingKeys, type FleetFuelCardDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { useMySettings } from '../../../platform/settings/settings-api';
import { Button } from '../../../shared/ui/Button';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatDate } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { cn } from '../../../shared/lib/cn';
import {
  useAllFuelCards,
  useApproveFuelCharge,
  useFuelCardSummary,
  useRequestFuelCharge,
} from '../api/fleet-queries';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { FuelTransferDialog } from '../components/FuelTransferDialog';
import { FUEL_CARD_COMPANIES, groupByVehicle } from '../components/FuelCardTiles';
import {
  BOARD_FONT,
  BoardIcon,
  BoardKpi,
  CompanyBadge,
  EmptySlotRow,
  NUM,
  PATH,
  VehicleFuelGroup,
  ymd,
} from '../components/FuelCardBoard';
import { saveSheet } from '../lib/fleet-sheet';
import {
  CHARGING_STATES,
  cardsInStates,
  readChargingStates,
  type ChargingState,
} from '../lib/charging-state';
import { printFleetReport, reportMoney } from '../lib/fleet-report-print';
import { useReportSignatories } from '../lib/use-report-signatories';
import { groupCardNumber } from '../lib/fuel-card-number';

const REMEMBERED_FILTERS = ['vehicleCodes', 'company', 'state'] as const;
const STATE_LABEL: Record<ChargingState, string> = {
  requested: 'fleet.fuelCards.filters.requested',
  charged: 'fleet.fuelCards.filters.chargedToday',
  low: 'fleet.fuelCards.filters.low',
};
const csv = (raw: string | null): string[] => (raw ?? '').split(',').filter((v) => v !== '');

/**
 * The request box's own colours, given as the input's `tone` so the input drops its border and
 * white ground: no frame of its own and no focus ring — the surrounding frame is the box.
 */
const REQUEST_BOX_TONE =
  'border-transparent bg-transparent text-right text-xs font-bold tabular-nums text-slate-100 placeholder:font-normal placeholder:text-slate-600 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:bg-transparent';

/**
 * «طلب رصيد»: type an amount and the row colours; ✓ sends it to the card, ✕ takes it back.
 * A request already on the row is shown in the box with its ✓ ✕ until somebody decides.
 */
const ChargeRequest = ({ card }: { card: FleetFuelCardDto }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [typed, setTyped] = useState('');
  const request = useRequestFuelCharge();
  const approve = useApproveFuelCharge();
  const waiting = card.requestedAmount !== null;
  const shown = waiting ? String(card.requestedAmount) : typed;
  const value = Number(shown);
  const canDecide = waiting ? can('fleetFuelCharge.approve') : can('fleetFuelCharge.request');
  const busy = request.isPending || approve.isPending;

  const tick = async (): Promise<void> => {
    if (waiting) {
      await approve.mutateAsync({ id: card.id, body: { version: card.version } });
      toast.success(t('fleet.fuelCards.charged'));
      return;
    }
    if (!Number.isFinite(value) || value <= 0) return;
    await request.mutateAsync({ id: card.id, body: { amount: value, version: card.version } });
    setTyped('');
    toast.success(t('fleet.fuelCards.requested'));
  };
  const cross = async (): Promise<void> => {
    if (waiting) {
      await request.mutateAsync({ id: card.id, body: { amount: null, version: card.version } });
      toast.success(t('fleet.fuelCards.requestCancelled'));
      return;
    }
    setTyped('');
  };
  const showButtons = waiting || (typed !== '' && Number.isFinite(value) && value > 0);
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-md border bg-[#0b0f19] px-2 py-1 transition-colors',
        'focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500',
        'border-slate-800',
      )}
    >
      <span className="whitespace-nowrap text-[10px] text-slate-500">
        {t('fleet.fuelCards.fields.request')}
      </span>
      <MoneyInput
        value={shown}
        onChange={setTyped}
        disabled={waiting || !can('fleetFuelCharge.request')}
        aria-label={t('fleet.fuelCards.fields.request')}
        data-fuel-request={card.id}
        placeholder="0.00"
        tone={REQUEST_BOX_TONE}
        className="!h-5 !w-20 !px-0 !py-0"
      />
      {showButtons && canDecide && (
        <>
          <button
            type="button"
            data-fuel-tick={card.id}
            aria-label={waiting ? t('fleet.fuelCards.approve') : t('fleet.fuelCards.request')}
            title={waiting ? t('fleet.fuelCards.approve') : t('fleet.fuelCards.request')}
            disabled={busy}
            onClick={() => void tick()}
            className="rounded border border-emerald-500/30 bg-emerald-600/20 px-1.5 text-xs font-bold text-emerald-400 hover:bg-emerald-600/30 disabled:opacity-50"
          >
            ✓
          </button>
          <button
            type="button"
            data-fuel-cross={card.id}
            aria-label={t('fleet.fuelCards.cancelRequest')}
            title={t('fleet.fuelCards.cancelRequest')}
            disabled={busy}
            onClick={() => void cross()}
            className="rounded border border-red-500/30 bg-red-600/20 px-1.5 text-xs font-bold text-red-400 hover:bg-red-600/30 disabled:opacity-50"
          >
            ✕
          </button>
        </>
      )}
    </div>
  );
};

/** One card's line on the charging board — the fuel cards screen's line, with its money. */
const ChargeRow = ({
  card,
  red,
  yellow,
}: {
  card: FleetFuelCardDto;
  red: number;
  yellow: number;
}): JSX.Element => {
  const t = useT();
  const low = card.balance < red ? 'red' : card.balance < yellow ? 'yellow' : null;
  const waiting = card.requestedAmount !== null;
  // «الاخضر فى حالة لو اتشحن اليوم» — charged on today's date, not within the last 24 hours.
  const charged =
    card.lastChargedAt !== null &&
    new Date(card.lastChargedAt).toDateString() === new Date().toDateString();
  return (
    <div
      data-fuel-line={card.company}
      data-fuel-card={card.id}
      className={cn(
        // «الصف بتاع الفيزا يكون بكل بياناته على صف واحد» — never wraps; a narrow screen scrolls it.
        'flex flex-nowrap items-center justify-between gap-3 overflow-x-auto rounded-xl border px-3 py-2.5 transition hover:shadow-md',
        // The whole line carries its state: amber while a request waits, green when charged today,
        // red when the balance is about to run out.
        waiting
          ? 'border-amber-500/60 bg-amber-500/15'
          : charged
            ? 'border-emerald-500/60 bg-emerald-500/15'
            : low === 'red'
              ? 'border-red-500/60 bg-red-500/15'
              : 'border-slate-800 bg-[#111827] hover:border-slate-700/80',
      )}
    >
      <div className="flex min-w-[190px] shrink-0 items-center gap-3">
        <CompanyBadge company={card.company} />
        <div className="flex flex-col">
          <span className="font-mono text-xs font-bold tracking-wide text-white">{card.name}</span>
          <span
            className={cn(
              'mt-0.5 flex items-center gap-1 text-[10px] font-medium',
              card.company === 'wataniya' ? 'text-emerald-400' : 'text-amber-400',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                card.company === 'wataniya' ? 'bg-emerald-400' : 'bg-amber-400',
              )}
            />
            {t(`fleet.fuelCards.company.${card.company}`)}
          </span>
        </div>
      </div>
      <div className="my-auto flex shrink-0 flex-nowrap items-center gap-2.5">
        <div className="flex items-center rounded-md border border-slate-800 bg-[#0b0f19] px-2.5 py-1">
          <span dir="ltr" className={cn('text-xs font-bold tracking-wider text-slate-200', NUM)}>
            {groupCardNumber(card.number)}
          </span>
        </div>
        <div
          data-fuel-balance={card.id}
          className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-[#0b0f19] px-2.5 py-1"
        >
          <span className="text-[10px] text-slate-500">{t('fleet.fuelCards.fields.balance')}</span>
          <span
            className={cn(
              'text-xs font-black',
              NUM,
              low === 'red'
                ? 'text-red-400'
                : low === 'yellow'
                  ? 'text-amber-400'
                  : 'text-emerald-400',
            )}
          >
            {card.balance.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
          {low !== null && (
            <span
              className={cn(
                'rounded border px-1 py-[0.05rem] text-[9px] font-medium',
                low === 'red'
                  ? 'border-red-700/50 bg-red-950 text-red-400'
                  : 'border-amber-700/50 bg-amber-950 text-amber-400',
              )}
            >
              {t(
                low === 'red'
                  ? 'fleet.fuelCards.board.charge.critical'
                  : 'fleet.fuelCards.balanceYellow',
              )}
            </span>
          )}
        </div>
        <ChargeRequest card={card} />
        <div className={cn('flex shrink-0 items-center gap-1.5 text-xs text-slate-300', NUM)}>
          <BoardIcon d={PATH.calendar} className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-[10px] text-slate-500">
            {t('fleet.fuelCards.fields.lastCharged')}
          </span>
          <span className="font-semibold text-slate-200" dir="ltr">
            {ymd(card.lastChargedAt)}
          </span>
        </div>
      </div>
    </div>
  );
};

export const FuelChargingPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const signatories = useReportSignatories();

  const vehicleCodes = csv(sp.get('vehicleCodes'));
  const company = sp.get('company') ?? '';
  const states = readChargingStates(sp.get('state'));
  // One state the server can narrow by: the totals then count exactly the cards shown, as before.
  const onlyState = states.length === 1 ? states[0] : undefined;
  const paramsKey = sp.toString();
  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    setSp(next);
  };
  // A filter on the CARD leaves a car's other card out of the answer — filtered away, not empty.
  const cardFiltered = company !== '' || states.length > 0;

  // The colour lines — «قبل ما الرصيد بتاع الفيزا يخلص اقدر ادى انذار احمر واصفر».
  const settings = useMySettings();
  const setting = (key: string, fallback: number): number =>
    Number(settings.data?.find((s) => s.key === key)?.value ?? fallback);
  const yellow = setting(FleetSettingKeys.FuelCardBalanceYellow, 300);
  const red = setting(FleetSettingKeys.FuelCardBalanceRed, 100);

  const filters = useMemo(
    () => ({
      vehicleCodes: vehicleCodes.length > 0 ? vehicleCodes : undefined,
      company: company || undefined,
      requested: onlyState === 'requested' ? true : undefined,
      balanceBelow: onlyState === 'low' ? yellow : undefined,
    }),
    [paramsKey, yellow],
  );
  const { data, isLoading, isError, error, refetch } = useAllFuelCards(filters);
  const summary = useFuelCardSummary(filters);
  // Several states read as ANY of them; the server narrows by one at most, so the rest is done here.
  const cards = useMemo(
    () => cardsInStates(data?.items ?? [], states, yellow),
    [data, paramsKey, yellow],
  );
  const tiles = useMemo(() => groupByVehicle(cards), [cards]);
  const [transferring, setTransferring] = useState(false);

  const header = [
    t('fleet.odometer.columns.vehicle'),
    t('fleet.fuelCards.fields.company'),
    t('fleet.fuelCards.fields.number'),
    t('fleet.fuelCards.fields.balance'),
    t('fleet.fuelCards.fields.request'),
    t('fleet.fuelCards.fields.lastCharged'),
  ];
  const rows = () =>
    cards.map((card) => [
      card.vehicleCode ?? card.label ?? '',
      t(`fleet.fuelCards.company.${card.company}`),
      card.number,
      card.balance,
      card.requestedAmount ?? '',
      card.lastChargedAt === null ? '' : formatDate(card.lastChargedAt, locale),
    ]);
  const exportSheet = async (): Promise<void> => {
    saveSheet({
      name: t('fleet.nav.fuelCharging'),
      serialHeader: t('fleet.violations.report.serial'),
      header,
      rows: rows(),
      moneyColumns: [3, 4],
    });
  };
  const onPrint = (): void => {
    try {
      printFleetReport({
        title: t('fleet.nav.fuelCharging'),
        department: t('fleet.violations.report.department'),
        subtitle: '',
        header,
        rows: rows().map((row) =>
          row.map((cell) => (typeof cell === 'number' ? reportMoney(cell) : String(cell))),
        ),
        totals:
          summary.data === undefined
            ? []
            : [
                {
                  label: t('fleet.fuelCards.totals.wataniya'),
                  value: reportMoney(summary.data.wataniyaBalance),
                },
                {
                  label: t('fleet.fuelCards.totals.chillout'),
                  value: reportMoney(summary.data.chilloutBalance),
                },
              ],
        signatories,
        serialHeader: t('fleet.violations.report.serial'),
        emptyLabel: t('fleet.violations.report.empty'),
      });
    } catch {
      toast.error(t('fleet.violations.popupBlocked'));
    }
  };

  const selectBox =
    'h-[34px] cursor-pointer rounded-lg border border-slate-700/80 bg-[#080C14] py-0 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0';
  const darkTrigger =
    '[&_button[aria-haspopup]]:!h-[34px] [&_button[aria-haspopup]]:!py-0 [&_button[aria-haspopup]]:!rounded-lg [&_button[aria-haspopup]]:!border-slate-700/80 [&_button[aria-haspopup]]:!bg-[#080C14] [&_button[aria-haspopup]]:!text-xs [&_button[aria-haspopup]]:!text-slate-100';
  const latin = (value: number): string =>
    Math.round(value).toLocaleString('en-US', { maximumFractionDigits: 0 });

  return (
    <PageContainer>
      <div className={cn(BOARD_FONT, 'space-y-6 text-slate-100 antialiased')}>
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <BoardKpi
            testId="wataniya"
            tone="emerald"
            icon={PATH.card}
            label={t('fleet.fuelCards.totals.wataniya')}
            value={summary.data === undefined ? '—' : latin(summary.data.wataniyaBalance)}
            valueClass="text-emerald-400"
            unit={t('fleet.fuelCards.board.kpi.currency')}
            note={
              <span className="text-slate-400">
                {t('fleet.fuelCards.board.charge.cardsNote', {
                  count: String(cards.filter((c) => c.company === 'wataniya').length),
                })}
              </span>
            }
          />
          <BoardKpi
            testId="chillout"
            tone="amber"
            icon={PATH.card}
            label={t('fleet.fuelCards.totals.chillout')}
            value={summary.data === undefined ? '—' : latin(summary.data.chilloutBalance)}
            valueClass="text-amber-400"
            unit={t('fleet.fuelCards.board.kpi.currency')}
            note={
              <span className="text-slate-400">
                {t('fleet.fuelCards.board.charge.cardsNote', {
                  count: String(cards.filter((c) => c.company === 'chillout').length),
                })}
              </span>
            }
          />
          <BoardKpi
            testId="requested"
            tone="blue"
            icon={PATH.warn}
            hoverBorder="hover:border-amber-500/40"
            label={t('fleet.fuelCards.totals.requested')}
            value={summary.data === undefined ? '—' : String(summary.data.requestedCount)}
            unit={t('fleet.fuelCards.board.charge.requestedUnit')}
            note={
              summary.data !== undefined && summary.data.requestedCount > 0 ? (
                <span className="text-amber-400">
                  ⚠️{' '}
                  {t('fleet.fuelCards.board.charge.requestedNote', {
                    amount: latin(summary.data.requestedAmount),
                  })}
                </span>
              ) : (
                <span className="text-emerald-400">
                  ✓ {t('fleet.fuelCards.board.charge.requestedNone')}
                </span>
              )
            }
          />
          <BoardKpi
            testId="charged"
            tone="cyan"
            icon={PATH.trend}
            label={t('fleet.fuelCards.totals.chargedToday')}
            value={summary.data === undefined ? '—' : latin(summary.data.chargedTodayAmount)}
            unit={t('fleet.fuelCards.board.kpi.currency')}
            unitClass="font-bold text-cyan-400"
            note={
              <span className="text-slate-400">
                {t('fleet.fuelCards.board.charge.chargedNote')}
              </span>
            }
          />
        </section>

        <section className="flex flex-col items-stretch justify-between gap-4 rounded-xl border border-slate-800 bg-[#111827] p-4 md:flex-row md:items-center">
          <div className="flex w-full items-center justify-between gap-2.5 overflow-x-auto">
            <div className="flex flex-1 shrink-0 items-center gap-2">
              <div className="relative w-40 shrink-0">
                <VehicleCodeFilter
                  className={cn('w-full', darkTrigger, '[&_button[aria-haspopup]]:!ps-9')}
                  fullWidth
                  placeholder={t('fleet.fuelCards.board.searchCar')}
                  value={vehicleCodes}
                  onChange={(next) =>
                    patch({ vehicleCodes: next.length === 0 ? null : next.join(',') })
                  }
                />
                <span className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3">
                  <BoardIcon d={PATH.truck} className="h-4 w-4 text-emerald-400" />
                </span>
              </div>
              {/* «اى حاله فيها اكتر من 3 اخيار اقدر اعمل مالتى سلكت» — three states, several at once. */}
              <MultiSelect
                clearable
                className={cn('shrink-0', darkTrigger)}
                showSelectedValues
                label={t('fleet.fuelCards.filters.state')}
                placeholder={t('fleet.fuelCards.board.charge.stateAny')}
                options={CHARGING_STATES.map((value) => ({
                  value,
                  label: t(STATE_LABEL[value]),
                }))}
                value={states}
                onChange={(next) => patch({ state: next.length === 0 ? null : next.join(',') })}
              />
              <select
                aria-label={t('fleet.fuelCards.fields.company')}
                value={company}
                onChange={(e) => patch({ company: e.target.value || null })}
                className={cn(selectBox, 'shrink-0 px-2.5')}
              >
                <option value="">{t('fleet.fuelCards.board.anyCompany')}</option>
                {FUEL_CARD_COMPANIES.map((option) => (
                  <option key={option} value={option}>
                    {t(`fleet.fuelCards.company.${option}`)}
                  </option>
                ))}
              </select>
            </div>
            {!isError && (
              <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-700 bg-slate-800/80 p-0.5">
                <button
                  type="button"
                  data-export="fuel-charging"
                  onClick={() => void exportSheet()}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-emerald-950/60 hover:text-emerald-300"
                >
                  <BoardIcon d={PATH.excel} className="h-3.5 w-3.5 text-emerald-400" />
                  <span>{t('fleet.fuelCards.board.excel')}</span>
                </button>
                <span className="h-4 w-px bg-slate-700" />
                <button
                  type="button"
                  data-print="fuel-charging"
                  onClick={onPrint}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-red-950/40 hover:text-red-400"
                >
                  <BoardIcon d={PATH.pdf} className="h-3.5 w-3.5 text-red-400" />
                  <span>{t('fleet.fuelCards.board.pdf')}</span>
                </button>
              </div>
            )}
            <Can permission="fleetFuelCharge.transfer">
              <button
                type="button"
                data-fuel-transfer-open="true"
                onClick={() => setTransferring(true)}
                className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-3.5 py-2 text-xs font-black text-white shadow-md shadow-emerald-700/25 transition hover:from-emerald-500 hover:to-teal-500"
              >
                ↔ {t('fleet.fuelCards.board.charge.transfer')}
              </button>
            </Can>
          </div>
        </section>

        {isError ? (
          <EmptyState
            title={t('common.error')}
            description={String(error)}
            action={<Button onClick={() => void refetch()}>{t('common.retry')}</Button>}
          />
        ) : !isLoading && tiles.length === 0 ? (
          <EmptyState title={t('fleet.fuelCards.empty')} />
        ) : (
          <div className="space-y-3">
            {tiles.map((tile) => (
              <VehicleFuelGroup
                key={tile.vehicleId}
                vehicleId={tile.vehicleId}
                code={tile.code}
                held={Object.keys(tile.cards).length}
              >
                {FUEL_CARD_COMPANIES.map((slot) => {
                  const card = tile.cards[slot];
                  if (card === undefined) {
                    return cardFiltered ? null : <EmptySlotRow key={slot} company={slot} />;
                  }
                  return <ChargeRow key={slot} card={card} red={red} yellow={yellow} />;
                })}
              </VehicleFuelGroup>
            ))}
          </div>
        )}
      </div>
      <FuelTransferDialog
        open={transferring}
        onClose={() => setTransferring(false)}
        cards={data?.items ?? []}
      />
    </PageContainer>
  );
};
