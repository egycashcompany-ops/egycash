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
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  type ItConsumableMovementDto,
  type ItConsumableMovementKind,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Badge, type Tone } from '../../../shared/ui/Badge';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Pagination } from '../../../shared/ui/Pagination';
import { ClipboardIcon } from '../../../shared/ui/icons';
import { cn } from '../../../shared/lib/cn';
import { formatDateTime, formatNumber, localized } from '../../../shared/lib/format';
import { useItCatalog, useItConsumableMovements } from '../api/it-queries';
import {
  MOVEMENT_SIGN,
  movementAsset,
  movementEmployee,
  movementReason,
} from '../lib/consumable-movement-register-export';
import { ConsumableMemoActions } from './ConsumableMemo';
import { ItUserName } from './ItUserName';

/** Each kind's colour: in is green, out to a person is blue, scrap is red, back is the brand's. */
export const MOVEMENT_TONE: Readonly<Record<ItConsumableMovementKind, Tone>> = {
  received: 'success',
  issued: 'info',
  scrapped: 'danger',
  returned: 'brand',
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

/** Which columns a place shows — the item on a screen of many items, not on one item's list. */
export interface MovementColumnOptions {
  item?: boolean;
  employee?: boolean;
  asset?: boolean;
  by?: boolean;
}

/** The ledger's columns, in the screens' order: date, kind, item, qty, employee, asset, reason, memo, by. */
export const useConsumableMovementColumns = ({
  item = true,
  employee = true,
  asset = true,
  by = true,
}: MovementColumnOptions = {}): Column<ItConsumableMovementDto>[] => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const types = useItCatalog('consumableType');
  const typeName = new Map(
    (types.data?.items ?? []).map((type) => [type.id, localized(type.name, locale)] as const),
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
        return (
          <Link
            to={`/it/assets/${m.assetId}`}
            data-installed-on={m.assetId}
            className="text-brand-700 hover:underline dark:text-brand-300"
          >
            {movementAsset(m) ?? t('it.custody.assetUnknown')}
          </Link>
        );
      },
    },
    {
      key: 'reason',
      header: t('it.consumables.movements.columns.reason'),
      render: (m) => {
        const reason = movementReason(t, m);
        const notes = m.notes?.trim() ?? '';
        return (
          <span className="flex max-w-xs flex-col gap-0.5 leading-tight">
            <span>{reason ?? (notes === '' ? '—' : null)}</span>
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
  ];
  return columns.filter((column): column is Column<ItConsumableMovementDto> => column !== false);
};

const CARD_PAGE_SIZE = 10;

/**
 * A card of the ledger narrowed to one asset or one person — newest first, a page at a time, read
 * under the page's own grant (`itAsset.view`), which is the ledger's.
 */
const MovementsCard = ({
  title,
  description,
  empty,
  filter,
  columns,
}: {
  title: string;
  description: string;
  empty: string;
  filter: { assetId: string } | { employeeId: string };
  columns: Column<ItConsumableMovementDto>[];
}): JSX.Element => {
  const [page, setPage] = useState(1);
  const movements = useItConsumableMovements({ ...filter, page, pageSize: CARD_PAGE_SIZE });
  return (
    <Card className="lg:col-span-3">
      <CardHeader title={title} description={description} />
      <CardBody>
        <DataTable
          embedded
          columns={columns}
          rows={movements.data?.items ?? []}
          rowKey={(m) => m.id}
          loading={movements.isLoading}
          error={movements.isError ? movements.error : undefined}
          onRetry={() => void movements.refetch()}
          empty={empty}
        />
        {movements.data !== undefined && movements.data.meta.totalPages > 1 && (
          <Pagination meta={movements.data.meta} onPageChange={setPage} />
        )}
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
  const columns = useConsumableMovementColumns({ asset: false });
  return (
    <MovementsCard
      title={t('it.consumables.assetCard.title')}
      description={t('it.consumables.assetCard.hint')}
      empty={t('it.consumables.assetCard.empty')}
      filter={{ assetId }}
      columns={columns}
    />
  );
};

/** «اتبدل لمين» — what was issued to this person, and what they gave back, each issue with its memo. */
export const EmployeeConsumablesCard = ({ employeeId }: { employeeId: string }): JSX.Element => {
  const t = useT();
  const columns = useConsumableMovementColumns({ employee: false });
  return (
    <MovementsCard
      title={t('it.nav.consumables')}
      description={t('it.consumables.employeeCard.hint')}
      empty={t('it.consumables.employeeCard.empty')}
      filter={{ employeeId }}
      columns={columns}
    />
  );
};
