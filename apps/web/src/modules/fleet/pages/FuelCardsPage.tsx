// بطاقات الوقود (الفيز) — the registry of cards, one tile per car, Wataniya above Chill Out.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FleetSettingKeys,
  type FleetFuelCardCompany,
  type FleetFuelCardDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { useMySettings } from '../../../platform/settings/settings-api';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { Input, Select } from '../../../shared/ui/form';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EditIcon, EyeIcon, EyeOffIcon, PlusIcon, TrashIcon } from '../../../shared/ui/icons';
import { formatDate } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { useAllFuelCards, useDeleteFuelCard } from '../api/fleet-queries';
import { revealFuelCardPassword } from '../api/fleet-api';
import { DocumentActions } from '../components/DocumentActions';
import { FilteredCount } from '../components/FilteredCount';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { FuelCardDialog } from '../components/FuelCardDialog';
import { FuelCardImageControl, FuelCardImageDialog } from '../components/FuelCardImage';
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
import { printFleetReport } from '../lib/fleet-report-print';
import { useReportSignatories } from '../lib/use-report-signatories';

const REMEMBERED_FILTERS = ['vehicleCodes', 'company', 'number', 'expiresBefore'] as const;
const csv = (raw: string | null): string[] => (raw ?? '').split(',').filter((v) => v !== '');
const DAY_MS = 24 * 60 * 60 * 1000;

const actionButton =
  'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

/** «كلمة السر» — hidden, shown by the eye for a reader with the grant, fetched only then. */
const PasswordField = ({ card }: { card: FleetFuelCardDto }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [shown, setShown] = useState<string | null>(null);
  const reveal = async (): Promise<void> => {
    const { password } = await revealFuelCardPassword(card.id);
    setShown(password ?? '');
  };
  return (
    <FramedField label={t('fleet.fuelCards.fields.password')} ltr className="min-w-[8rem]">
      <span className="inline-flex items-center gap-2">
        {shown === null ? (card.hasPassword ? '••••' : '—') : shown === '' ? '—' : shown}
        {card.hasPassword && shown === null && can('fleetFuelCard.reveal') && (
          <button
            type="button"
            data-fuel-reveal={card.id}
            aria-label={t('fleet.fuelCards.reveal')}
            title={t('fleet.fuelCards.reveal')}
            onClick={() => void reveal()}
            className="rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <EyeIcon className="h-4 w-4" />
          </button>
        )}
        {/* Shown, it hides again — the eye that opened it has a twin that closes it. */}
        {shown !== null && (
          <button
            type="button"
            data-fuel-hide={card.id}
            aria-label={t('fleet.fuelCards.hide')}
            title={t('fleet.fuelCards.hide')}
            onClick={() => setShown(null)}
            className="rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <EyeOffIcon className="h-4 w-4" />
          </button>
        )}
      </span>
    </FramedField>
  );
};

export const FuelCardsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const signatories = useReportSignatories();

  const vehicleCodes = csv(sp.get('vehicleCodes'));
  const company = sp.get('company') ?? '';
  const number = sp.get('number') ?? '';
  const expiresBefore = sp.get('expiresBefore') ?? '';
  const paramsKey = sp.toString();
  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    setSp(next);
  };
  // A filter on the CARD (its company, its number, its expiry) leaves a car's other card out of the
  // answer — that slot is filtered away, not empty, and must not read «لا يوجد كارت».
  const cardFiltered = company !== '' || number !== '' || expiresBefore !== '';
  const hasActiveFilters =
    vehicleCodes.length > 0 || company !== '' || number !== '' || expiresBefore !== '';
  const filters = useMemo(
    () => ({
      vehicleCodes: vehicleCodes.length > 0 ? vehicleCodes : undefined,
      company: company || undefined,
      number: number || undefined,
      expiresBefore: expiresBefore || undefined,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useAllFuelCards(filters);
  const cards = data?.items ?? [];
  const tiles = useMemo(() => groupByVehicle(cards), [cards]);

  // «المعاد اللى عاوز احطه قبل انتهاء الفيزا عشان الانذار» — from Fleet settings.
  const settings = useMySettings();
  const warnDays = Number(
    settings.data?.find((s) => s.key === FleetSettingKeys.FuelCardExpiryWarnDays)?.value ?? 30,
  );
  // A card whose expiry is not known yet warns of nothing.
  const expiresSoon = (card: FleetFuelCardDto): boolean =>
    card.expiresAt !== null && new Date(card.expiresAt).getTime() - Date.now() <= warnDays * DAY_MS;

  const [adding, setAdding] = useState<{
    vehicleId: string;
    company?: FleetFuelCardCompany;
  } | null>(null);
  const [editing, setEditing] = useState<FleetFuelCardDto | null>(null);
  // The card whose photo is open, read from the list each render so a replaced photo shows at once.
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = viewingId === null ? null : (cards.find((c) => c.id === viewingId) ?? null);
  const viewingCode = viewing === null ? '' : (viewing.vehicleCode ?? viewing.label ?? '—');
  const [deleting, setDeleting] = useState<FleetFuelCardDto | null>(null);
  const remove = useDeleteFuelCard();
  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    await remove.mutateAsync(deleting.id);
    toast.success(t('fleet.fuelCards.deleted'));
    setDeleting(null);
  };

  const header = [
    t('fleet.odometer.columns.vehicle'),
    t('fleet.fuelCards.fields.company'),
    t('fleet.fuelCards.fields.name'),
    t('fleet.fuelCards.fields.number'),
    t('fleet.fuelCards.fields.expiresAt'),
    t('fleet.fuelCards.fields.balance'),
  ];
  const sheetRows = () =>
    cards.map((card) => [
      card.vehicleCode ?? card.label ?? '',
      t(`fleet.fuelCards.company.${card.company}`),
      card.name,
      card.number,
      formatDate(card.expiresAt, locale),
      card.balance,
    ]);
  const exportSheet = async (): Promise<void> => {
    saveSheet({
      name: t('fleet.nav.fuelCards'),
      serialHeader: t('fleet.violations.report.serial'),
      header,
      rows: sheetRows(),
      moneyColumns: [5],
    });
  };
  const onPrint = (): void => {
    try {
      printFleetReport({
        title: t('fleet.nav.fuelCards'),
        department: t('fleet.violations.report.department'),
        subtitle: '',
        header,
        rows: sheetRows().map((row) => row.map(String)),
        totals: [],
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
        title={t('fleet.nav.fuelCards')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.fuelCards') },
        ]}
        actions={
          <>
            {!isError && (
              <DocumentActions name="fuel-cards" onPrint={onPrint} onExport={exportSheet} />
            )}
            <Can permission="fleetFuelCard.create">
              <Button
                size="sm"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => setAdding({ vehicleId: '' })}
              >
                {t('fleet.fuelCards.add')}
              </Button>
            </Can>
          </>
        }
      />
      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() =>
            patch({ vehicleCodes: null, company: null, number: null, expiresBefore: null })
          }
          trailing={<FilteredCount value={data === undefined ? undefined : tiles.length} />}
        >
          <VehicleCodeFilter
            className="shrink-0"
            value={vehicleCodes}
            onChange={(next) => patch({ vehicleCodes: next.length === 0 ? null : next.join(',') })}
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
          {/* Widths on the WRAPPERS: `Input` carries its own `w-full`, and a width passed as a
              class only joins it (`cn` does not merge) — the number box took the whole row, and
              the date (in an inline span, which takes no width) fell to a third line. */}
          <div className="w-48 shrink-0">
            <Input
              aria-label={t('fleet.fuelCards.filters.number')}
              placeholder={t('fleet.fuelCards.filters.number')}
              value={number}
              onChange={(e) => patch({ number: e.target.value || null })}
              rule="digits"
            />
          </div>
          <div className="relative w-40 shrink-0">
            <Input
              type="date"
              dir="ltr"
              aria-label={t('fleet.fuelCards.filters.expiresBefore')}
              title={t('fleet.fuelCards.filters.expiresBefore')}
              value={expiresBefore}
              onChange={(e) => patch({ expiresBefore: e.target.value || null })}
              className={
                expiresBefore === ''
                  ? 'peer [&:not(:focus)::-webkit-datetime-edit]:opacity-0'
                  : undefined
              }
            />
            {expiresBefore === '' && (
              <span
                aria-hidden="true"
                data-date-caption="expiresBefore"
                className="pointer-events-none absolute inset-y-0 left-2 right-8 flex items-center justify-center truncate text-sm text-slate-400 peer-focus:hidden dark:text-slate-500"
              >
                {t('fleet.fuelCards.filters.expiresBefore')}
              </span>
            )}
          </div>
        </FilterBar>

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
                    if (cardFiltered) return null;
                    return (
                      <EmptyCardLine
                        key={slot}
                        company={slot}
                        // A tile of a card on no car has no car to put another card on.
                        {...(can('fleetFuelCard.create') && !tile.noCar
                          ? {
                              onAdd: () => setAdding({ vehicleId: tile.vehicleId, company: slot }),
                            }
                          : {})}
                      />
                    );
                  }
                  return (
                    <CardLine key={slot} company={slot}>
                      <FramedField
                        label={t('fleet.fuelCards.fields.name')}
                        className="min-w-[11rem]"
                      >
                        {card.name}
                      </FramedField>
                      <FramedField
                        label={t('fleet.fuelCards.fields.number')}
                        ltr
                        className="min-w-[14rem]"
                      >
                        {card.number}
                      </FramedField>
                      <FramedField
                        label={t('fleet.fuelCards.fields.expiresAt')}
                        ltr
                        above={
                          expiresSoon(card) ? (
                            <WarnBadge tone="yellow">{t('fleet.fuelCards.expiresSoon')}</WarnBadge>
                          ) : undefined
                        }
                      >
                        {formatDate(card.expiresAt, locale)}
                      </FramedField>
                      <PasswordField card={card} />
                      <FramedField
                        label={t('fleet.fuelCards.image.title')}
                        className="min-w-[7rem]"
                      >
                        <FuelCardImageControl card={card} onOpen={(c) => setViewingId(c.id)} />
                      </FramedField>
                      <span className="ms-auto inline-flex items-center gap-1 self-center">
                        {can('fleetFuelCard.edit') && (
                          <button
                            type="button"
                            data-fuel-edit={card.id}
                            className={actionButton}
                            aria-label={t('fleet.fuelCards.edit')}
                            title={t('fleet.fuelCards.edit')}
                            onClick={() => setEditing(card)}
                          >
                            <EditIcon className="h-4 w-4" />
                          </button>
                        )}
                        {can('fleetFuelCard.delete') && (
                          <button
                            type="button"
                            data-fuel-delete={card.id}
                            className={actionButton}
                            aria-label={t('common.delete')}
                            title={t('common.delete')}
                            onClick={() => setDeleting(card)}
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        )}
                      </span>
                    </CardLine>
                  );
                })}
              </VehicleCardTile>
            ))}
          </div>
        )}
      </div>

      <FuelCardDialog
        open={adding !== null || editing !== null}
        onClose={() => {
          setAdding(null);
          setEditing(null);
        }}
        card={editing}
        photoCard={editing === null ? null : (cards.find((c) => c.id === editing.id) ?? editing)}
        onOpenPhoto={(c) => setViewingId(c.id)}
        initialVehicleId={adding?.vehicleId ?? ''}
        {...(adding?.company === undefined ? {} : { initialCompany: adding.company })}
      />
      {/* After the form, so the photo opened from it sits above it. */}
      <FuelCardImageDialog
        open={viewing !== null}
        onClose={() => setViewingId(null)}
        card={viewing}
        code={viewingCode}
      />
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('fleet.fuelCards.deleteTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => void confirmDelete()}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('fleet.fuelCards.deleteBody')}
        </p>
      </Dialog>
    </PageContainer>
  );
};
