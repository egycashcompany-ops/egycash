// إدارة وشحن الكروت — every car's two cards and their balances; a charge is REQUESTED on the row
// and then APPROVED (✓) or taken back (✕); balances move between cards through the transfer.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FleetSettingKeys, type FleetFuelCardDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { useMySettings } from '../../../platform/settings/settings-api';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Button } from '../../../shared/ui/Button';
import { Select } from '../../../shared/ui/form';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { StatStrip, type StatStripItem } from '../../../shared/ui/StatStrip';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatDate, formatMoney } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { cn } from '../../../shared/lib/cn';
import {
  useAllFuelCards,
  useApproveFuelCharge,
  useFuelCardSummary,
  useRequestFuelCharge,
} from '../api/fleet-queries';
import { DocumentActions } from '../components/DocumentActions';
import { FilteredCount } from '../components/FilteredCount';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { FuelTransferDialog } from '../components/FuelTransferDialog';
import {
  CardLine,
  EmptyCardLine,
  FUEL_CARD_COMPANIES,
  FramedField,
  VehicleCardTile,
  WarnBadge,
  groupByVehicle,
} from '../components/FuelCardTiles';
import { saveSheet } from '../lib/fleet-sheet';
import {
  CHARGING_STATES,
  cardsInStates,
  chargedToday,
  readChargingStates,
  type ChargingState,
} from '../lib/charging-state';
import { printFleetReport, reportMoney } from '../lib/fleet-report-print';
import { useReportSignatories } from '../lib/use-report-signatories';

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
  'border-transparent bg-transparent text-right text-[15px] font-bold tabular-nums text-slate-900 placeholder:font-normal placeholder:text-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:bg-transparent dark:text-slate-100 dark:placeholder:text-slate-600';

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
    <div className="flex min-w-[13rem] flex-col gap-1">
      <span className="min-h-[1.125rem] text-[11px] leading-[1.125rem]" />
      {/*
        The frame IS the box, as every other fact on the line is a frame: the amount is typed
        straight into it, in the frames' own bold figures. It used to hold a second, bordered input
        — a thin line inside the frame that grew the global focus ring, offset, on a click. Now
        the input is bare and the frame itself lights up while it is being typed in.
      */}
      <div
        className={cn(
          'rounded-lg border bg-white px-3 py-1.5 transition-colors dark:bg-slate-950',
          'focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500',
          waiting ? 'border-amber-400' : 'border-slate-200 dark:border-slate-700',
        )}
      >
        <span className="block text-[11px] text-slate-500 dark:text-slate-400">
          {t('fleet.fuelCards.fields.request')}
        </span>
        <span className="flex items-center gap-1">
          <MoneyInput
            value={shown}
            onChange={setTyped}
            disabled={waiting || !can('fleetFuelCharge.request')}
            aria-label={t('fleet.fuelCards.fields.request')}
            data-fuel-request={card.id}
            placeholder="0.00"
            tone={REQUEST_BOX_TONE}
            className="h-6 w-28 !px-0 !py-0"
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
                className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-sm font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
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
                className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
              >
                ✕
              </button>
            </>
          )}
        </span>
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
  const hasActiveFilters = vehicleCodes.length > 0 || company !== '' || states.length > 0;
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

  const money = (value: number): string => formatMoney(value, 'EGP', locale);
  const totals: StatStripItem[] = [
    {
      key: 'wataniya',
      label: t('fleet.fuelCards.totals.wataniya'),
      ...(summary.data === undefined ? {} : { value: money(summary.data.wataniyaBalance) }),
    },
    {
      key: 'chillout',
      label: t('fleet.fuelCards.totals.chillout'),
      ...(summary.data === undefined ? {} : { value: money(summary.data.chilloutBalance) }),
    },
    {
      key: 'requested',
      label: t('fleet.fuelCards.totals.requested'),
      ...(summary.data === undefined
        ? {}
        : { value: `${summary.data.requestedCount} — ${money(summary.data.requestedAmount)}` }),
    },
    {
      key: 'charged',
      label: t('fleet.fuelCards.totals.chargedToday'),
      ...(summary.data === undefined ? {} : { value: money(summary.data.chargedTodayAmount) }),
    },
  ];

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

  return (
    <PageContainer>
      <PageHeader
        title={t('fleet.nav.fuelCharging')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.fuelCharging') },
        ]}
        actions={
          <>
            {!isError && (
              <DocumentActions name="fuel-charging" onPrint={onPrint} onExport={exportSheet} />
            )}
            <Can permission="fleetFuelCharge.transfer">
              <Button
                size="sm"
                data-fuel-transfer-open="true"
                onClick={() => setTransferring(true)}
              >
                ↔ {t('fleet.fuelCards.transfer.title')}
              </Button>
            </Can>
          </>
        }
      />
      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() => patch({ vehicleCodes: null, company: null, state: null })}
          trailing={<FilteredCount value={data === undefined ? undefined : tiles.length} />}
        >
          <VehicleCodeFilter
            className="shrink-0"
            value={vehicleCodes}
            onChange={(next) => patch({ vehicleCodes: next.length === 0 ? null : next.join(',') })}
          />
          {/* «اى حاله فيها اكتر من 3 اخيار اقدر اعمل مالتى سلكت» — three states, so several at once. */}
          <MultiSelect
            clearable
            className="shrink-0"
            showSelectedValues
            label={t('fleet.fuelCards.filters.state')}
            options={CHARGING_STATES.map((value) => ({
              value,
              label: t(STATE_LABEL[value]),
            }))}
            value={states}
            onChange={(next) => patch({ state: next.length === 0 ? null : next.join(',') })}
          />
          <Select
            aria-label={t('fleet.fuelCards.fields.company')}
            title={t('fleet.fuelCards.fields.company')}
            value={company}
            onChange={(e) => patch({ company: e.target.value || null })}
            className="w-auto shrink-0"
          >
            <option value="">{t('fleet.fuelCards.filters.anyCompany')}</option>
            {FUEL_CARD_COMPANIES.map((option) => (
              <option key={option} value={option}>
                {t(`fleet.fuelCards.company.${option}`)}
              </option>
            ))}
          </Select>
        </FilterBar>

        <StatStrip columns={4} labelFirst items={totals} />

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
              <VehicleCardTile
                key={tile.vehicleId}
                code={tile.code}
                vehicleId={tile.vehicleId}
                noCar={tile.noCar}
              >
                {FUEL_CARD_COMPANIES.map((slot) => {
                  const card = tile.cards[slot];
                  if (card === undefined) {
                    return cardFiltered ? null : <EmptyCardLine key={slot} company={slot} />;
                  }
                  const low = card.balance < red ? 'red' : card.balance < yellow ? 'yellow' : null;
                  return (
                    <CardLine
                      key={slot}
                      company={slot}
                      tone={
                        card.requestedAmount !== null
                          ? 'request'
                          : chargedToday(card)
                            ? 'charged'
                            : undefined
                      }
                    >
                      <FramedField label={t('fleet.fuelCards.fields.number')} ltr>
                        {card.number}
                      </FramedField>
                      <FramedField
                        label={t('fleet.fuelCards.fields.balance')}
                        ltr
                        above={
                          low === null ? undefined : (
                            <WarnBadge tone={low}>
                              {t(
                                low === 'red'
                                  ? 'fleet.fuelCards.balanceRed'
                                  : 'fleet.fuelCards.balanceYellow',
                              )}
                            </WarnBadge>
                          )
                        }
                      >
                        {money(card.balance)}
                      </FramedField>
                      <ChargeRequest card={card} />
                      <FramedField
                        label={t('fleet.fuelCards.fields.lastCharged')}
                        ltr
                        className="min-w-[8rem]"
                      >
                        {card.lastChargedAt === null ? '—' : formatDate(card.lastChargedAt, locale)}
                      </FramedField>
                    </CardLine>
                  );
                })}
              </VehicleCardTile>
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
