// The preview of a «رفع جماعي» — step 2 of `/it/assets/import`: what the file would do, line by
// line, before anything is written.
//
// «ويكون فى Preview الأول للى هيتضاف ويوضح لو فى تكرار أو تضارب مع بيانات موجوده» — so every line
// shows the server's decision in words (a device in another branch says which, a repeat says which
// row took the device), the doubts that leave a new line unticked, and what a matched device would
// be filled with or keeps. The chips count the decisions and filter the table; the kinds table is
// where a «النوع» the server could not file is given its category. Presentation only: the rules
// (the ticks, the words, the chips) live in `lib/asset-import.ts`.
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  type ItAssetImportDecision,
  type ItAssetImportPreviewDto,
  type ItAssetImportRowDto,
  type Locale,
} from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { AlertIcon, CheckIcon } from '../../../shared/ui/icons';
import { cn } from '../../../shared/lib/cn';
import { formatNumber } from '../../../shared/lib/format';
import { ItCatalogSelect } from './ItCatalogSelect';
import {
  IMPORT_DECISION_TONE,
  allTicked,
  decisionChips,
  decisionCountLabel,
  decisionLabel,
  fillsShown,
  importFieldLabel,
  keptRows,
  plannedBranchLabel,
  rowsInView,
  toggleAll,
  toggleChip,
  toggleRow,
  warningLabel,
} from '../lib/asset-import';

type Kind = ItAssetImportPreviewDto['kinds'][number];

/** The decisions whose server note says why the line stands where it does. */
const EXPLAINED: readonly ItAssetImportDecision[] = ['invalid', 'outOfScope', 'ambiguous'];

/**
 * The lines' box on a computer: the DataTable's own wrapper (its direct child — `stickyHead`
 * makes it scroll both ways) capped at one screen less what has to stay in view with it.
 */
const LINES_BOX = 'lg:[&>div]:max-h-[calc(100dvh-15rem)]';

const chipClass = (pressed: boolean): string =>
  cn(
    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
    pressed
      ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-950 dark:text-brand-200'
      : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600',
  );

export const AssetImportPreview = ({
  preview,
  selection,
  onSelectionChange,
  filter,
  onFilterChange,
  categoryOf,
  onCategoryChange,
  branchName,
  busy,
  confirming,
  onConfirm,
}: {
  preview: ItAssetImportPreviewDto;
  selection: ReadonlySet<number>;
  onSelectionChange: (next: Set<number>) => void;
  /** The chip pressed — the table shows that decision's lines only. */
  filter: ItAssetImportDecision | null;
  onFilterChange: (next: ItAssetImportDecision | null) => void;
  /** A kind's category as the select shows it — the reviewer's pick, else the server's match. */
  categoryOf: (kind: Kind) => string;
  onCategoryChange: (kind: string, categoryId: string) => void;
  branchName: (id: string) => string | undefined;
  /** A preview or an apply is running: nothing here may change underneath it. */
  busy: boolean;
  confirming: boolean;
  onConfirm: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const n = (value: number): string => formatNumber(value, locale);

  const chips = decisionChips(preview.counts);
  const inView = rowsInView(preview.rows, filter);
  const kept = keptRows(selection, preview.rows);
  const selectable = preview.rows.filter((row) => row.selectable).length;
  const viewTicked = allTicked(selection, inView);
  const join = t('it.assets.import.listJoin');

  const suggested =
    preview.suggestedBranchId !== null && preview.suggestedBranchId === preview.branchId;
  const sheetBranch =
    preview.suggestedBranchId !== null && preview.suggestedBranchId !== preview.branchId
      ? branchName(preview.suggestedBranchId)
      : undefined;

  const details = (row: ItAssetImportRowDto): ReactNode => {
    const lines: ReactNode[] = [];
    if (row.asset !== null) {
      lines.push(
        <span key="asset">
          {t('it.assets.import.matched')}{' '}
          <Link
            to={`/it/assets/${row.asset.id}`}
            className="font-mono text-brand-700 hover:underline dark:text-brand-300"
            dir="ltr"
          >
            {row.asset.assetCode}
          </Link>
        </span>,
      );
    }
    // What a new line is registered with — the serial number is the tag when the sheet has one
    // (the Dell service tag), so the reader sees which label became which field.
    if (row.decision === 'new' || row.decision === 'unknownKind') {
      for (const [field, value] of [
        ['serialNumber', row.serialNumber],
        ['externalTag', row.externalTag],
      ] as const) {
        if (value === null) continue;
        lines.push(
          <span key={field}>
            {importFieldLabel(t, field)}:{' '}
            <span className="font-mono" dir="ltr">
              {value}
            </span>
          </span>,
        );
      }
    }
    // «يُكمَّل» only where a tick writes it — never on a line out of the reader's reach.
    const fills = fillsShown(row);
    if (fills.length > 0) {
      lines.push(
        <span key="fills" className="text-sky-700 dark:text-sky-300">
          {t('it.assets.import.fills', {
            fields: fills.map((field) => importFieldLabel(t, field)).join(join),
          })}
        </span>,
      );
    }
    for (const value of row.kept) {
      lines.push(
        <span key={`kept:${value.field}`} className="text-amber-800 dark:text-amber-200" dir="auto">
          {t('it.assets.import.kept', {
            field: importFieldLabel(t, value.field),
            register: value.register,
            sheet: value.sheet,
          })}
        </span>,
      );
    }
    // The server's own words (English, as every API message is) under the decision's — which right
    // is missing, which cell is too long.
    if (row.message !== null && EXPLAINED.includes(row.decision)) {
      lines.push(
        <span key="message" className="text-slate-500 dark:text-slate-400" dir="auto">
          {row.message}
        </span>,
      );
    }
    return lines.length === 0 ? (
      '—'
    ) : (
      <span className="flex flex-col gap-0.5 text-xs">{lines}</span>
    );
  };

  const columns: Column<ItAssetImportRowDto>[] = [
    {
      key: 'tick',
      header: '',
      className: 'w-10',
      render: (row) => (
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:opacity-40"
          checked={row.selectable && selection.has(row.row)}
          disabled={!row.selectable || busy}
          onChange={() => onSelectionChange(toggleRow(selection, row))}
          aria-label={t('it.assets.import.tickRow', { row: row.row })}
          data-import-tick={row.row}
        />
      ),
    },
    {
      key: 'row',
      header: t('it.assets.import.columns.row'),
      render: (row) => <span className="tabular-nums">{row.row}</span>,
    },
    { key: 'kind', header: t('it.assets.import.columns.kind'), render: (row) => row.kind ?? '—' },
    { key: 'name', header: t('it.assets.import.columns.name'), render: (row) => row.name ?? '—' },
    {
      key: 'serial',
      header: t('it.assets.import.columns.serial'),
      render: (row) =>
        row.serial === null ? (
          '—'
        ) : (
          <span className="font-mono text-xs" dir="ltr">
            {row.serial}
          </span>
        ),
    },
    {
      key: 'tag',
      header: t('it.assets.import.columns.tag'),
      render: (row) =>
        row.tag === null ? (
          '—'
        ) : (
          <span className="font-mono text-xs" dir="ltr">
            {row.tag}
          </span>
        ),
    },
    {
      key: 'decision',
      header: t('it.assets.import.columns.decision'),
      render: (row) => (
        <span data-import-decision={row.decision}>
          <Badge tone={IMPORT_DECISION_TONE[row.decision]} size="sm">
            {decisionLabel(t, row, branchName)}
          </Badge>
        </span>
      ),
    },
    {
      key: 'warnings',
      header: t('it.assets.import.columns.warnings'),
      render: (row) =>
        row.warnings.length === 0 ? (
          '—'
        ) : (
          <span className="flex flex-col gap-1">
            {row.warnings.map((warning) => (
              <span
                key={warning}
                data-import-warning={warning}
                className="inline-flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300"
              >
                <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {warningLabel(t, warning, row)}
              </span>
            ))}
          </span>
        ),
    },
    { key: 'details', header: t('it.assets.import.columns.details'), render: details },
  ];

  const kindColumns: Column<Kind>[] = [
    { key: 'kind', header: t('it.assets.import.kinds.kind'), render: (kind) => kind.kind },
    {
      key: 'rows',
      header: t('it.assets.import.kinds.lines'),
      render: (kind) => <span className="tabular-nums">{n(kind.rows)}</span>,
    },
    {
      key: 'category',
      header: t('it.assets.import.kinds.category'),
      render: (kind) => (
        <ItCatalogSelect
          kind="assetCategory"
          value={categoryOf(kind)}
          onChange={(categoryId) => onCategoryChange(kind.kind, categoryId)}
          allLabel={t('it.assets.import.kinds.choose')}
          ariaLabel={t('it.assets.import.kinds.categoryOf', { kind: kind.kind })}
          className="w-full min-w-[10rem]"
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Said before anything else: a preview has touched nothing, and must not read as done. */}
      <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        <p>{t('it.assets.import.previewNotice')}</p>
        {/* The branch «تأكيد» writes to, in words — the plan's, whatever the select above shows. */}
        <p className="font-semibold" data-import-plan-branch={preview.branchId}>
          {plannedBranchLabel(t, preview.branchId, branchName)}
        </p>
        <p className="text-xs" dir="auto">
          {t('it.assets.import.sheet', { name: preview.sheetName })}
          {suggested && <> · {t('it.assets.import.suggested')}</>}
          {sheetBranch !== undefined && (
            <> · {t('it.assets.import.otherThanSheet', { branch: sheetBranch })}</>
          )}
        </p>
      </div>

      {/* The counts are the filter: a chip shows its lines, pressed again shows them all. */}
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label={t('it.assets.import.columns.decision')}
      >
        <button
          type="button"
          className={chipClass(filter === null)}
          aria-pressed={filter === null}
          onClick={() => onFilterChange(null)}
        >
          {t('it.assets.import.all')}
          <Badge size="sm">{n(preview.rows.length)}</Badge>
        </button>
        {chips.map(({ decision, count }) => (
          <button
            key={decision}
            type="button"
            className={chipClass(filter === decision)}
            aria-pressed={filter === decision}
            data-import-chip={decision}
            onClick={() => onFilterChange(toggleChip(filter, decision))}
          >
            {decisionCountLabel(t, decision)}
            <Badge tone={IMPORT_DECISION_TONE[decision]} size="sm">
              {n(count)}
            </Badge>
          </button>
        ))}
      </div>

      {preview.kinds.length > 0 && (
        <Card>
          <CardHeader
            title={t('it.assets.import.kinds.title')}
            description={t('it.assets.import.kinds.hint')}
          />
          <CardBody>
            {/* A disabled fieldset stills every select while a preview or an apply runs. */}
            <fieldset disabled={busy} className="min-w-0">
              <DataTable
                columns={kindColumns}
                rows={preview.kinds}
                rowKey={(kind) => kind.kind}
                dense
                minColumnWidth={8}
              />
            </fieldset>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={t('it.assets.import.rows.title')} />
        <CardBody className="space-y-3">
          {/* The actions wrap on a phone; the count says how much the confirm will send. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || inView.every((row) => !row.selectable)}
                onClick={() => onSelectionChange(toggleAll(selection, inView))}
              >
                {viewTicked ? t('it.assets.import.clearAll') : t('it.assets.import.selectAll')}
              </Button>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {t('it.assets.import.selected', { n: n(kept.length), of: n(selectable) })}
              </span>
            </div>
            <Button
              size="sm"
              leftIcon={<CheckIcon className="h-4 w-4" />}
              disabled={kept.length === 0 || busy}
              loading={confirming}
              onClick={onConfirm}
              data-import-confirm
            >
              {t('it.assets.import.confirm', { n: n(kept.length) })}
            </Button>
          </div>
          {selectable === 0 && (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t('it.assets.import.noSelectable')}
            </p>
          )}
          {/* «مش عايز كل الصفحة تعمل Scroll !! عايز فقط الجدول لكن الزراير والفلتر يبقوا ثابتين»
              (2026-11-17): on a computer the lines scroll in a box of their own, under a head that
              stays, and the sideways scroll of a narrow screen sits at the box's foot rather than
              under the last of hundreds of lines. Capped, not the board frame the registers use
              (`shared/ui/board-scroll.ts`): the steps, the notice, the chips and the kinds above
              already take more than a screen, so a frame would leave the lines only its 14rem
              floor. One screen less the top bar, this card's head, its «تأكيد» row and the page's
              foot — at the page's end the whole card, «تأكيد» with it, is in view while only the
              lines move. */}
          <div className={LINES_BOX}>
            <DataTable
              columns={columns}
              rows={inView}
              rowKey={(row) => String(row.row)}
              dense
              hoverable
              minColumnWidth={6.5}
              stickyHead
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
};
