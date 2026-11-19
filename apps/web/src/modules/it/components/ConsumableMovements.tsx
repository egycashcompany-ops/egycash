// The consumables ledger, as the screens show it (FR-20): one set of columns for every place a
// movement is read — the movements screen, one item's movements, the asset's «المستهلكات المركّبة
// عليه» card and an employee's card — so the four never disagree about what a movement says.
//
// Every figure is the server's. A movement's quantity is always positive and its KIND says which
// way it moved (in: a receipt, a return; out: an issue, a scrap), so the sign is drawn from the
// kind and never from arithmetic here. Read BY KIND: an issue names who received it, where it was
// installed, why («جديد» / «بدل تالف») and its memo; a scrap says why; a return may name who
// brought it back.
//
// «بدل تالف» is said in so many words wherever an issue is shown: the damaged unit it replaces is
// counted as scrap, though it never sat on the shelf — so the store's «الهالك» grows by it while
// «الرصيد» moves only by the new unit, and a reader comparing the two figures is told why.
//
// A transfer between two stores («ممكن أنقل 5 لفرع تاني») is a pair of movements: «تحويل إلى فرع» out
// of one, coloured as an issue is, and «تحويل من فرع» into the other, coloured as a receipt is. Each
// names the other side in the reason's place — the branch, and that store's item when known.
//
// «تعديل الجهاز» (2026-11-17 — «وضيف إمكانية تعديل الجهاز اللى عليه المستهلك بعد التسليم»): every
// issued row offers to correct the device its unit sits in — the ledger's one correctable fact, as
// it moves no quantity — in the four places alike, the asset's card included (where the device
// column is left out, the page being that device). Its own column at the row's end, as every IT
// register's actions are, drawn only for a reader who holds both grants it needs (the issue's
// `itConsumable.assign`, and `itAsset.view` for the box that searches the devices): a reader
// without them gets the ledger exactly as before, with no empty column. The dialog is
// `ConsumableInstalledOnDialog.tsx`, and it is held BESIDE the table, never in a row: a re-read can
// take the row off the list while the dialog is open (a 409 on an asset's card means the unit moved
// to another device, so the card no longer lists it), and a dialog mounted in that row would vanish
// with it, its refusal unsaid. `useConsumableMovementLedger` returns the columns and that dialog;
// each place renders both.
//
// «قراءة العداد» (2026-11-19): an issue of a toner names the printer's counter as it went in — as
// typed, or as «تعديل الجهاز» last corrected it — with «تصفير» when it started the counter again.
// Its own column after the device, in every place; one item's movements draw it only for a toner.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  type ItConsumableMovementDto,
  type ItConsumableMovementKind,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { useAppSelector } from '../../../store';
import { Badge, type Tone } from '../../../shared/ui/Badge';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Pagination } from '../../../shared/ui/Pagination';
import { ClipboardIcon, EditIcon } from '../../../shared/ui/icons';
import { cn } from '../../../shared/lib/cn';
import { formatDateTime, formatNumber, localized } from '../../../shared/lib/format';
import { useItBranchOptions, useItCatalog, useItConsumableMovements } from '../api/it-queries';
import { mayChangeDevices, mayChangeInstalledOn } from '../lib/consumable-installed-on';
import {
  MOVEMENT_SIGN,
  movementAsset,
  movementCounterpart,
  movementEmployee,
  movementReason,
} from '../lib/consumable-movement-register-export';
import { ConsumableInstalledOnDialog } from './ConsumableInstalledOnDialog';
import { ConsumableMemoActions } from './ConsumableMemo';
import { ItUserName } from './ItUserName';

/**
 * Each kind's colour: in is green, out to a person is blue, scrap is red, back is the brand's — and
 * stock sent to another branch is out as an issue is, stock arriving from one is in as a receipt is.
 */
export const MOVEMENT_TONE: Readonly<Record<ItConsumableMovementKind, Tone>> = {
  received: 'success',
  issued: 'info',
  scrapped: 'danger',
  returned: 'brand',
  transferredOut: 'info',
  transferredIn: 'success',
};

/** The kind, as a chip. */
export const ConsumableMovementKindBadge = ({
  kind,
}: {
  kind: ItConsumableMovementKind;
}): JSX.Element => {
  const t = useT();
  return (
    <Badge tone={MOVEMENT_TONE[kind]} size="sm">
      {t(`it.consumables.kind.${kind}`)}
    </Badge>
  );
};

/** «تعديل الجهاز» on one issued row — the button; the dialog it opens is the ledger's, not the row's. */
const InstalledOnAction = ({
  movement,
  onEdit,
}: {
  movement: ItConsumableMovementDto;
  onEdit: (movement: ItConsumableMovementDto) => void;
}): JSX.Element => {
  const t = useT();
  return (
    <button
      type="button"
      data-movement-device-edit={movement.id}
      className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 text-xs text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:text-slate-100"
      title={t('it.consumables.installedOn.actionHint')}
      onClick={() => onEdit(movement)}
    >
      <EditIcon className="h-4 w-4" aria-hidden="true" />
      {t('it.consumables.installedOn.action')}
    </button>
  );
};

/** Which columns a place shows — the item on a screen of many items, not on one item's list. */
export interface MovementColumnOptions {
  item?: boolean;
  employee?: boolean;
  asset?: boolean;
  /** «قراءة العداد» — the printer's counter a toner went in at (2026-11-19). */
  counter?: boolean;
  by?: boolean;
}

/**
 * «١٢٬٣٤٥» — the printer's counter as the toner went in, «تصفير» beside it when that reading started
 * the counter again; a dash on every row that carries none.
 */
export const CounterReadingCell = ({
  reading,
  reset,
}: {
  reading: number | null;
  reset: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  if (reading === null) return <span>—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-counter-reading={reading}>
      <span className="font-mono text-sm tabular-nums" dir="ltr">
        {formatNumber(reading, locale)}
      </span>
      {reset && (
        <Badge tone="warning" size="sm">
          {t('it.consumables.counter.resetBadge')}
        </Badge>
      )}
    </span>
  );
};

/**
 * The ledger's columns, in the screens' order: date, kind, item, qty, employee, asset, the counter
 * reading, reason, memo, by — and «تعديل الجهاز» last, for a reader who may correct a device.
 */
const useConsumableMovementColumns = (
  { item = true, employee = true, asset = true, counter = true, by = true }: MovementColumnOptions,
  onEditDevice: (movement: ItConsumableMovementDto) => void,
): Column<ItConsumableMovementDto>[] => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // The person's history (`/it/employees/:id`) and the asset's page are the ASSETS' screens: a
  // reader of the store who is not one of the assets reads both names as text — the movement still
  // says who received it and what it went into — rather than following a link to «no access».
  const linksToAssets = can('itAsset.view');
  const types = useItCatalog('consumableType');
  const typeName = new Map(
    (types.data?.items ?? []).map((type) => [type.id, localized(type.name, locale)] as const),
  );
  // The other side a transfer names — the same cached options every IT screen reads.
  const branches = useItBranchOptions();
  const branchName = new Map(
    (branches.data ?? []).map((branch) => [branch.id, localized(branch.name, locale)] as const),
  );

  const columns: (Column<ItConsumableMovementDto> | false)[] = [
    {
      key: 'at',
      header: t('it.consumables.movements.columns.at'),
      render: (m) => <span className="tabular-nums">{formatDateTime(m.at, locale)}</span>,
    },
    {
      key: 'kind',
      header: t('it.consumables.movements.columns.kind'),
      render: (m) => <ConsumableMovementKindBadge kind={m.kind} />,
    },
    item && {
      key: 'item',
      header: t('it.consumables.movements.columns.item'),
      render: (m) => (
        <span className="flex flex-col leading-tight">
          <span>{m.consumableName ?? t('it.custody.assetUnknown')}</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {m.consumableCode === null ? null : (
              <bdi className="font-mono" dir="ltr">
                {m.consumableCode}
              </bdi>
            )}
            {m.consumableCode !== null && m.typeId !== null && typeName.has(m.typeId)
              ? ' · '
              : null}
            {m.typeId === null ? null : typeName.get(m.typeId)}
          </span>
        </span>
      ),
    },
    {
      key: 'qty',
      header: t('it.consumables.movements.columns.qty'),
      render: (m) => (
        <span
          data-movement-qty={m.kind}
          dir="ltr"
          className={cn(
            'font-mono text-sm tabular-nums',
            MOVEMENT_SIGN[m.kind] > 0
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-amber-700 dark:text-amber-400',
          )}
        >
          {`${MOVEMENT_SIGN[m.kind] > 0 ? '+' : '−'}${formatNumber(m.qty, locale)}`}
        </span>
      ),
    },
    employee && {
      key: 'employee',
      header: t('it.consumables.movements.columns.employee'),
      render: (m) => {
        const label = movementEmployee(m);
        if (m.employeeId === null || label === null) return '—';
        if (!linksToAssets) return label;
        return (
          <Link to={`/it/employees/${m.employeeId}`} className="hover:underline">
            {label}
          </Link>
        );
      },
    },
    asset && {
      key: 'installedOn',
      header: t('it.consumables.movements.columns.installedOn'),
      render: (m) => {
        if (m.assetId === null) return '—';
        const label = movementAsset(m) ?? t('it.custody.assetUnknown');
        if (!linksToAssets) return <span data-installed-on={m.assetId}>{label}</span>;
        return (
          <Link
            to={`/it/assets/${m.assetId}`}
            data-installed-on={m.assetId}
            className="text-brand-700 hover:underline dark:text-brand-300"
          >
            {label}
          </Link>
        );
      },
    },
    counter && {
      key: 'counterReading',
      header: t('it.consumables.movements.columns.counter'),
      render: (m) => <CounterReadingCell reading={m.counterReading} reset={m.counterReset} />,
    },
    {
      key: 'reason',
      header: t('it.consumables.movements.columns.reason'),
      render: (m) => {
        const counterpart = movementCounterpart(t, m, branchName);
        const reason = movementReason(t, m, branchName);
        const notes = m.notes?.trim() ?? '';
        return (
          <span className="flex max-w-xs flex-col gap-0.5 leading-tight">
            {counterpart === null ? (
              <span>{reason ?? (notes === '' ? '—' : null)}</span>
            ) : (
              // The other store's item code isolated in its own direction, so the Latin code never
              // reorders the Arabic around it.
              <span data-transfer-counterpart={m.kind}>
                {counterpart.place}
                {counterpart.code === null ? null : (
                  <>
                    {' '}
                    <bdi className="font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
                      {counterpart.code}
                    </bdi>
                  </>
                )}
              </span>
            )}
            {m.kind === 'issued' && m.reason === 'replacement' && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {t('it.consumables.replacementNote')}
              </span>
            )}
            {notes !== '' && (
              <span className="flex items-start gap-1 text-xs text-slate-600 dark:text-slate-300">
                <ClipboardIcon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                <span>{notes}</span>
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'memo',
      header: t('it.consumables.movements.columns.memo'),
      render: (m) => (
        <ConsumableMemoActions
          memoId={m.memoId}
          memoNumber={m.memoNumber}
          memoSigned={m.memoSigned}
        />
      ),
    },
    by && {
      key: 'by',
      header: t('it.consumables.movements.columns.by'),
      render: (m) => <ItUserName id={m.byUserId} className="text-xs" />,
    },
    // «تعديل الجهاز» — only for a reader who holds both grants, and only on an issued row.
    mayChangeDevices(can) && {
      key: 'actions',
      header: t('it.assets.columns.actions'),
      align: 'end',
      render: (m) =>
        mayChangeInstalledOn(m, can) ? (
          <InstalledOnAction movement={m} onEdit={onEditDevice} />
        ) : null,
    },
  ];
  return columns.filter((column): column is Column<ItConsumableMovementDto> => column !== false);
};

/** The ledger a place renders: its columns, and the «تعديل الجهاز» dialog while one is open. */
export interface ConsumableLedger {
  columns: Column<ItConsumableMovementDto>[];
  /** Rendered beside the table, never inside it — `null` while no device is being changed. */
  editor: JSX.Element | null;
}

/**
 * The row the open dialog shows: the list's own while the list still has it — its version and its
 * device as last read, so a refusal re-read shows what now stands — and, once a re-read has taken
 * it off this list, the last copy the list showed (`kept`), marked `left` so the dialog says so
 * rather than point at a device it can no longer see.
 */
export const installedOnEditing = (
  kept: ItConsumableMovementDto | null,
  rows: readonly ItConsumableMovementDto[],
): { movement: ItConsumableMovementDto; left: boolean } | null => {
  if (kept === null) return null;
  const fresh = rows.find((row) => row.id === kept.id);
  return fresh === undefined ? { movement: kept, left: true } : { movement: fresh, left: false };
};

/**
 * The ledger's columns for one place, with the «تعديل الجهاز» dialog held here — above the table,
 * so a row leaving the list (moved to another device, pushed to the next page) never closes it.
 * `rows` are the rows the place shows now.
 */
export const useConsumableMovementLedger = (
  rows: readonly ItConsumableMovementDto[],
  options: MovementColumnOptions = {},
): ConsumableLedger => {
  // The row being edited, as the list last showed it: set by the row's button, and carried forward
  // on every re-read that still lists it (React's adjust-state-while-rendering pattern), so a row
  // that later leaves the list falls back to its latest version, never to the click's.
  const [kept, setKept] = useState<ItConsumableMovementDto | null>(null);
  const columns = useConsumableMovementColumns(options, setKept);
  const editing = installedOnEditing(kept, rows);
  if (editing !== null && !editing.left && editing.movement !== kept) setKept(editing.movement);
  const id = editing?.movement.id;
  return {
    columns,
    editor:
      editing === null ? null : (
        <ConsumableInstalledOnDialog
          // One dialog per row: opening another row never carries this one's choice or refusal.
          key={id}
          open
          // Closes only its own row: a save that settles after its dialog was closed, and another
          // row opened, leaves that other dialog alone.
          onClose={() => setKept((current) => (current?.id === id ? null : current))}
          movement={editing.movement}
          left={editing.left}
        />
      ),
  };
};

const CARD_PAGE_SIZE = 10;

/**
 * A card of the ledger narrowed to one asset or one person — newest first, a page at a time, read
 * under the ledger's own grant (`itConsumable.view`). The asset's page and a person's history are
 * the assets' screens, so each page draws its card only for a reader who also holds the store's
 * grant — a card of 403s is not drawn, and its read is not asked.
 */
const MovementsCard = ({
  title,
  description,
  empty,
  filter,
  options,
}: {
  title: string;
  description: string;
  empty: string;
  filter: { assetId: string } | { employeeId: string };
  options: MovementColumnOptions;
}): JSX.Element => {
  const [page, setPage] = useState(1);
  const movements = useItConsumableMovements({ ...filter, page, pageSize: CARD_PAGE_SIZE });
  const rows = movements.data?.items ?? [];
  const { columns, editor } = useConsumableMovementLedger(rows, options);
  return (
    <Card className="lg:col-span-3">
      <CardHeader title={title} description={description} />
      <CardBody>
        <DataTable
          embedded
          columns={columns}
          rows={rows}
          rowKey={(m) => m.id}
          loading={movements.isLoading}
          error={movements.isError ? movements.error : undefined}
          onRetry={() => void movements.refetch()}
          empty={empty}
        />
        {movements.data !== undefined && movements.data.meta.totalPages > 1 && (
          <Pagination meta={movements.data.meta} onPageChange={setPage} />
        )}
        {editor}
      </CardBody>
    </Card>
  );
};

/**
 * «المستهلكات المركّبة عليه» — «لو حاجة بتتركب فى حاجة تانية زى الهرد والماوس والكابلات أقدر أذكر
 * الجهاز اللى أتركب عليه من اللأصول»: every consumable issued as installed on this asset, with who
 * received it and its memo.
 */
export const AssetConsumablesCard = ({ assetId }: { assetId: string }): JSX.Element => {
  const t = useT();
  return (
    <MovementsCard
      title={t('it.consumables.assetCard.title')}
      description={t('it.consumables.assetCard.hint')}
      empty={t('it.consumables.assetCard.empty')}
      filter={{ assetId }}
      options={{ asset: false }}
    />
  );
};

/** «اتبدل لمين» — what was issued to this person, and what they gave back, each issue with its memo. */
export const EmployeeConsumablesCard = ({ employeeId }: { employeeId: string }): JSX.Element => {
  const t = useT();
  return (
    <MovementsCard
      title={t('it.nav.consumables')}
      description={t('it.consumables.employeeCard.hint')}
      empty={t('it.consumables.employeeCard.empty')}
      filter={{ employeeId }}
      options={{ employee: false }}
    />
  );
};
