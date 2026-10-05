// «فى الاخر يكون علامه السجل زى فى شاشه الحوادث … لو اديت ل كارت او اخدت من كارت او زود كارت
// ك رصيد اقدر اعدل او امسح»: one card's log — every charge, every transfer in or out, every
// receipt taken off it — newest first. A charge or a transfer takes a new amount or is removed;
// the server moves the balances with it (both cards of a transfer) and keeps a removed line on
// file, out of every list. A receipt line belongs to the receipts screen and is only shown here.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { type FleetFuelCardDto, type FleetFuelCardMovementDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { EditIcon, HistoryIcon, TrashIcon } from '../../../shared/ui/icons';
import {
  useDeleteFuelCardMovement,
  useFuelCardMovements,
  useUpdateFuelCardMovement,
} from '../api/fleet-queries';
import { CLOSE_PATH, DesignLogo, LOOK, MONO, SANS, Stroke } from './FuelCardDialog';
import { groupCardNumber } from '../lib/fuel-card-number';

const stamp = (iso: string): string => {
  const at = new Date(iso);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${at.getFullYear()}/${two(at.getMonth() + 1)}/${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
};

const KIND_TONE: Record<FleetFuelCardMovementDto['kind'], string> = {
  charge: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  transferIn: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
  transferOut: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  receipt: 'border-slate-600 bg-slate-800 text-slate-300',
};

/** A line's amount: signed, green in and red out, struck through while it is being changed. */
const Amount = ({ value, struck }: { value: number; struck: boolean }): JSX.Element => {
  const t = useT();
  return (
    <span
      className={cn(
        'flex items-baseline gap-1 text-base font-black',
        value >= 0 ? 'text-emerald-400' : 'text-red-400',
        struck && 'opacity-60 line-through',
      )}
    >
      <span dir="ltr" className={MONO}>
        {value >= 0 ? '+' : '−'}
        {Math.abs(value).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </span>
      <span className="text-xs font-bold">{t('fleet.fuelCards.board.kpi.currency')}</span>
    </span>
  );
};

export const FuelCardHistoryDialog = ({
  card,
  cards,
  onClose,
}: {
  /** The card the log is about; `null` = closed. */
  card: FleetFuelCardDto | null;
  /** Every card on the screen — a transfer's other card is named by its car. */
  cards: readonly FleetFuelCardDto[];
  onClose: () => void;
}): JSX.Element | null => {
  const t = useT();
  const can = useCan();
  const log = useFuelCardMovements(card?.id ?? '');
  const update = useUpdateFuelCardMovement();
  const remove = useDeleteFuelCardMovement();
  const [editing, setEditing] = useState<{ id: string; amount: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  if (card === null) return null;
  const look = LOOK.add;
  // Latin figures with their two decimals, as everywhere on the fuel boards; the unit beside.
  const figure = (n: number): string =>
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lines = log.data?.items ?? [];
  const placeOf = (cardId: string | null): string => {
    const other = cards.find((c) => c.id === cardId);
    return other?.vehicleCode ?? other?.label ?? '—';
  };
  // Who may change a line: the one who may charge for a charge, the one who may transfer for a
  // transfer. A receipt line is never changed here.
  const mayChange = (line: FleetFuelCardMovementDto): boolean =>
    line.kind === 'charge'
      ? can('fleetFuelCharge.approve')
      : line.kind === 'receipt'
        ? false
        : can('fleetFuelCharge.transfer');
  const what = (line: FleetFuelCardMovementDto): string =>
    line.kind === 'transferIn'
      ? t('fleet.fuelCards.history.kind.transferIn', { place: placeOf(line.counterpartCardId) })
      : line.kind === 'transferOut'
        ? t('fleet.fuelCards.history.kind.transferOut', { place: placeOf(line.counterpartCardId) })
        : t(`fleet.fuelCards.history.kind.${line.kind}`);

  const cents = (n: number): number => Math.round(n * 100) / 100;
  // What a change does to the balances before it is made — this card's, and for a transfer the
  // other card's too. `newAbs` null: the line is removed.
  const effects = (
    line: FleetFuelCardMovementDto,
    newAbs: number | null,
  ): { label: string; from: number; to: number }[] => {
    const next = newAbs === null ? 0 : Math.sign(line.amount) * newAbs;
    const delta = cents(next - line.amount);
    const label = (c: FleetFuelCardDto): string =>
      t('fleet.fuelCards.history.cardOf', {
        place: c.vehicleCode ?? c.label ?? '—',
        company: t(`fleet.fuelCards.company.${c.company}`),
      });
    const moves = [{ label: label(card), from: card.balance, to: cents(card.balance + delta) }];
    const other = cards.find((c) => c.id === line.counterpartCardId);
    if (line.kind !== 'charge' && line.kind !== 'receipt' && other !== undefined) {
      moves.push({ label: label(other), from: other.balance, to: cents(other.balance - delta) });
    }
    return moves;
  };

  const save = async (): Promise<void> => {
    if (editing === null) return;
    const amount = Number(editing.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    await update.mutateAsync({ id: editing.id, body: { amount } });
    toast.success(t('fleet.fuelCards.history.updated'));
    setEditing(null);
  };
  const confirmRemove = async (): Promise<void> => {
    if (removing === null) return;
    await remove.mutateAsync(removing);
    toast.success(t('fleet.fuelCards.history.removed'));
    setRemoving(null);
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto p-3 sm:p-4">
      <div
        className="fixed inset-0 animate-fade-in bg-[#03060c]/80 backdrop-blur-md"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('fleet.fuelCards.history.title')}
        data-fuel-history-dialog={card.id}
        className={cn(
          SANS,
          'relative my-auto w-full max-w-3xl animate-pop-in overflow-hidden rounded-2xl border text-slate-100 antialiased',
          look.panel,
          '!max-w-3xl',
        )}
      >
        <header className={cn('flex items-center justify-between border-b px-6', look.header)}>
          <div className="flex items-center gap-3">
            <div className={cn('flex items-center justify-center rounded-xl border', look.icon)}>
              <HistoryIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-wide text-white">
                {t('fleet.fuelCards.history.title')}
              </h2>
              <p className="text-[13px] font-medium text-slate-300">
                {card.vehicleCode ?? card.label ?? '—'} ·{' '}
                {t(`fleet.fuelCards.company.${card.company}`)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className={cn(
              'flex items-center text-slate-400 transition-all hover:text-white focus:outline-none',
              look.close,
            )}
          >
            <Stroke d={CLOSE_PATH} className="h-5 w-5" />
          </button>
        </header>

        <div className="max-h-[calc(100vh-9rem)] space-y-4 overflow-y-auto p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#2b3b6b] bg-[#0a1233]/80 px-4 py-3">
            <span className="flex items-center gap-3">
              <DesignLogo company={card.company} editing={false} />
              <span
                dir="ltr"
                className={cn('text-sm font-medium tracking-wider text-slate-200', MONO)}
              >
                {groupCardNumber(card.number)}
              </span>
            </span>
            <span className="text-sm text-slate-300">
              {t('fleet.fuelCards.fields.balance')}{' '}
              <b className={cn('text-base text-emerald-400', MONO)} dir="ltr">
                {figure(card.balance)}
              </b>{' '}
              {t('fleet.fuelCards.board.kpi.currency')}
            </span>
          </div>

          {log.isError ? (
            <p role="alert" className="py-6 text-center text-sm text-red-300">
              {t('fleet.fuelCards.history.loadFailed')}
            </p>
          ) : lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              {log.isPending ? t('common.loading') : t('fleet.fuelCards.history.empty')}
            </p>
          ) : (
            <ul className="space-y-2.5" data-fuel-history-lines="true">
              {lines.map((line) => {
                const isEditing = editing?.id === line.id;
                const isRemoving = removing === line.id;
                const active = isEditing || isRemoving;
                const newAmount = isEditing ? Number(editing.amount) : null;
                const amountOk =
                  newAmount === null || (Number.isFinite(newAmount) && newAmount > 0);
                const moves =
                  active && amountOk ? effects(line, isRemoving ? null : newAmount) : [];
                const negative = moves.some((move) => move.to < 0);
                return (
                  <li
                    key={line.id}
                    data-fuel-history-line={line.id}
                    className={cn(
                      'rounded-xl border px-4 py-3 transition',
                      isRemoving
                        ? 'border-red-500/60 bg-red-500/10 shadow-[0_0_22px_-8px_rgba(239,68,68,0.6)]'
                        : isEditing
                          ? 'border-[#6c63ff] [background:linear-gradient(145deg,rgba(108,99,255,0.18),rgba(15,23,60,0.7))] shadow-[0_0_0_1px_#6c63ff,0_0_22px_-6px_rgba(108,99,255,0.55)]'
                          : 'border-[#2b3b6b] bg-[#0a1233]/60',
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <span dir="ltr" className={cn('text-xs text-slate-400', MONO)}>
                        {stamp(line.at)}
                      </span>
                      <span
                        className={cn(
                          'rounded-md border px-2 py-0.5 text-xs font-bold',
                          KIND_TONE[line.kind],
                        )}
                      >
                        {what(line)}
                      </span>
                      <span className="ms-auto flex items-center gap-4">
                        <Amount value={line.amount} struck={active} />
                        {!active && (
                          <span className="text-xs text-slate-400">
                            {t('fleet.fuelCards.history.after')}{' '}
                            <b className={cn('text-slate-200', MONO)} dir="ltr">
                              {figure(line.balanceAfter)}
                            </b>
                          </span>
                        )}
                        {!active && mayChange(line) && (
                          <span className="flex items-center gap-1">
                            <button
                              type="button"
                              data-fuel-history-edit={line.id}
                              aria-label={t('common.edit')}
                              title={t('common.edit')}
                              onClick={() => {
                                setRemoving(null);
                                setEditing({ id: line.id, amount: String(Math.abs(line.amount)) });
                              }}
                              className="rounded-md p-1.5 text-slate-300 hover:bg-brand-500/15 hover:text-brand-200"
                            >
                              <EditIcon className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              data-fuel-history-remove={line.id}
                              aria-label={t('common.delete')}
                              title={t('common.delete')}
                              onClick={() => {
                                setEditing(null);
                                setRemoving(line.id);
                              }}
                              className="rounded-md p-1.5 text-slate-300 hover:bg-red-500/15 hover:text-red-300"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </span>
                        )}
                        {!active && line.kind === 'receipt' && (
                          <span className="text-[11px] text-slate-500">
                            {t('fleet.fuelCards.history.receiptNote')}
                          </span>
                        )}
                      </span>
                    </div>

                    {active && (
                      <div
                        data-fuel-history-panel={isEditing ? 'edit' : 'remove'}
                        className={cn(
                          'mt-3 space-y-3 border-t pt-3',
                          isRemoving ? 'border-red-500/30' : 'border-[#2b3b6b]/70',
                        )}
                      >
                        {isEditing ? (
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                              <span className="block text-xs font-bold text-slate-300">
                                {t('fleet.fuelCards.history.currentAmount')}
                              </span>
                              <div
                                dir="ltr"
                                className={cn(
                                  'rounded-lg border border-[#2b3b6b] bg-[#0a1233]/60 px-3 py-2 text-right text-base font-bold text-slate-300',
                                  MONO,
                                )}
                              >
                                {figure(Math.abs(line.amount))}
                              </div>
                            </div>
                            <div className="space-y-1">
                              <span className="block text-xs font-bold text-white">
                                {t('fleet.fuelCards.history.newAmount')}
                              </span>
                              <MoneyInput
                                value={editing.amount}
                                onChange={(amount) => setEditing({ id: line.id, amount })}
                                aria-label={t('fleet.fuelCards.history.newAmount')}
                                data-fuel-history-amount={line.id}
                                tone={cn(
                                  'border-[#6c63ff] bg-[#0a1233] py-2 text-right text-base font-bold text-white focus:border-[#8a83ff] focus:ring-[#6c63ff]/40',
                                  MONO,
                                )}
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-2.5">
                            <span className="mt-0.5 rounded-lg bg-red-500/15 p-1.5 text-red-300">
                              <TrashIcon className="h-4 w-4" />
                            </span>
                            <div>
                              <p className="text-sm font-bold text-red-200">
                                {t('fleet.fuelCards.history.removeTitle')}
                              </p>
                              <p className="text-xs text-slate-300">
                                {t('fleet.fuelCards.history.removeHint')}
                              </p>
                            </div>
                          </div>
                        )}

                        {moves.length > 0 && (
                          <div className="rounded-lg border border-[#2b3b6b]/70 bg-[#0a1233]/50 p-3">
                            <span className="mb-2 block text-xs font-bold text-slate-300">
                              {t('fleet.fuelCards.history.effects')}
                            </span>
                            <ul className="space-y-1.5">
                              {moves.map((move) => (
                                <li
                                  key={move.label}
                                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                                >
                                  <span className="text-slate-200">{move.label}</span>
                                  <span dir="ltr" className={cn('flex items-center gap-2', MONO)}>
                                    <span className="text-slate-400">{figure(move.from)}</span>
                                    <span className="text-slate-500">→</span>
                                    <b
                                      className={cn(
                                        move.to < 0
                                          ? 'text-red-400'
                                          : move.to > move.from
                                            ? 'text-emerald-400'
                                            : move.to < move.from
                                              ? 'text-amber-300'
                                              : 'text-slate-200',
                                      )}
                                    >
                                      {figure(move.to)}
                                    </b>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {negative && (
                          <p role="alert" className="text-xs font-bold text-red-300">
                            {t('fleet.fuelCards.history.negative')}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(null);
                              setRemoving(null);
                            }}
                            className="rounded-lg border border-[#2b3b6b] px-5 py-2 text-sm font-bold text-slate-200 transition hover:bg-slate-800/80"
                          >
                            {isEditing ? t('common.cancel') : t('fleet.fuelCards.history.back')}
                          </button>
                          {isEditing ? (
                            <button
                              type="button"
                              data-fuel-history-save={line.id}
                              disabled={update.isPending || !amountOk || negative}
                              onClick={() => void save()}
                              className="rounded-lg bg-gradient-to-r from-[#4f3dff] to-[#6a5cff] px-6 py-2 text-sm font-bold text-white shadow-[0_6px_24px_rgba(91,76,255,0.45)] transition hover:from-[#5a4aff] hover:to-[#7a6dff] disabled:opacity-50"
                            >
                              {t('fleet.fuelCards.history.saveEdit')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              data-fuel-history-confirm={line.id}
                              disabled={remove.isPending || negative}
                              onClick={() => void confirmRemove()}
                              className="rounded-lg bg-red-600 px-6 py-2 text-sm font-bold text-white shadow-[0_6px_24px_rgba(220,38,38,0.35)] transition hover:bg-red-500 disabled:opacity-50"
                            >
                              {t('fleet.fuelCards.history.confirmRemove')}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {lines.some((line) => line.kind === 'transferIn' || line.kind === 'transferOut') && (
            <p className="text-xs text-slate-400">{t('fleet.fuelCards.history.transferNote')}</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
