// «عداد الطابعة» (owner, 2026-11-19) — «وطبعا دا يتسجل للحبارة اللى كانت قبلها وفى نفس الوقت للطابعة
// اللى ركب عليها الحبارة»: the printer's counter, read where the owner asked for it.
//
//   · On the printer's page («عداد الطابعة»): every reading recorded as a toner went in, newest
//     first, each with the toner, the cartridge of the SAME item it replaced and the pages that one
//     printed — this reading less its own. A reset between the two leaves those pages unknown; the
//     first of an item on the printer (a new model, another colour) replaced none.
//   · On a toner item's movements («عمر الحبارات»): each cartridge, the printer it went into, the
//     reading it went in at and the one it was replaced at, and the average over those whose pages
//     are known.
//   · Under «قراءة عداد الطابعة» when issuing (and when «تعديل الجهاز» moves one): the printer's last
//     reading, and the toner it was taken with — or that it has none yet.
//
// Every figure is the server's: the pages are computed when read, over the printer's whole timeline
// (every store's issues on it), never by this client.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { useAppSelector } from '../../../store';
import { Button } from '../../../shared/ui/Button';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { formatDateTime, formatNumber } from '../../../shared/lib/format';
import { useItConsumableCartridges, useItPrinterCounter } from '../api/it-queries';
import { lastReadingWords, readingToner, type LatestReading } from '../lib/consumable-counter';
import { CounterReadingCell } from './ConsumableMovements';

/**
 * Under the reading box: «آخر قراءة مسجّلة لهذه الطابعة: ١٢٬٣٤٥ — …», and the toner it was taken
 * with; «لا توجد قراءة سابقة لهذه الطابعة» when there is none; and, for a memo dated before that
 * reading, that the server places it among the readings around its date.
 */
export const LastReadingNote = ({
  latest,
  unavailable,
  backdated,
}: {
  /** The printer's newest reading — null for none yet, undefined while it is not read. */
  latest: LatestReading | undefined;
  /** Its read failed: the server judges the reading on the save. */
  unavailable: boolean;
  backdated: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const toner = latest === undefined || latest === null ? null : readingToner(latest);
  return (
    <div
      aria-live="polite"
      data-counter-latest={
        latest === undefined
          ? unavailable
            ? 'unavailable'
            : 'loading'
          : latest === null
            ? 'none'
            : latest.reading
      }
      className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300"
    >
      {latest === undefined ? (
        <p>
          {unavailable
            ? t('it.consumables.counter.readingUnavailable')
            : t('it.consumables.counter.loadingReading')}
        </p>
      ) : latest === null ? (
        <p>{t('it.consumables.counter.noReading')}</p>
      ) : (
        <>
          <p className="font-medium text-slate-700 dark:text-slate-200">
            {lastReadingWords(t, latest, locale)}
          </p>
          {toner !== null && <p>{t('it.consumables.counter.lastReadingToner', { toner })}</p>}
          {latest.reset && <p>{t('it.consumables.counter.lastReadingReset')}</p>}
          {backdated && (
            <p className="text-amber-700 dark:text-amber-300">
              {t('it.consumables.counter.backdated')}
            </p>
          )}
        </>
      )}
    </div>
  );
};

/** Pages a cartridge printed: the figure, «غير معروف» across a reset, nothing while there is no pair. */
const PagesCell = ({ paired, pages }: { paired: boolean; pages: number | null }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  if (!paired) return <span>—</span>;
  if (pages === null) {
    return (
      <span className="text-slate-500 dark:text-slate-400">
        {t('it.consumables.counter.unknown')}
      </span>
    );
  }
  return (
    <span className="font-mono text-sm tabular-nums" dir="ltr" data-counter-pages={pages}>
      {formatNumber(pages, locale)}
    </span>
  );
};

/** A printer's card shows its newest readings; the rest are a click away, already read. */
const CARD_ROWS = 10;

/**
 * «عداد الطابعة» — the asset page's card. Drawn for every asset (the register has no «printer»
 * category to gate on), and hidden while the asset has no reading: a screen or a laptop never
 * shows an empty one. The page already requires `itAsset.view`, the grant the read rides.
 */
export const PrinterCounterCard = ({ assetId }: { assetId: string }): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const counter = useItPrinterCounter(assetId);
  const [all, setAll] = useState(false);
  const readings = counter.data?.readings ?? [];
  if (!counter.isError && readings.length === 0) return null;
  type Reading = (typeof readings)[number];
  const columns: Column<Reading>[] = [
    {
      key: 'at',
      header: t('it.consumables.movements.columns.at'),
      render: (r) => <span className="tabular-nums">{formatDateTime(r.at, locale)}</span>,
    },
    {
      key: 'reading',
      header: t('it.consumables.counter.columns.reading'),
      render: (r) => <CounterReadingCell reading={r.reading} reset={r.reset} />,
    },
    {
      key: 'toner',
      header: t('it.consumables.counter.columns.toner'),
      render: (r) => (
        <span className="flex flex-col leading-tight">
          <span>{r.consumableName ?? t('it.custody.assetUnknown')}</span>
          {/* The code isolated in its own direction, on the cell's own side, as the ledger's is. */}
          {r.consumableCode !== null && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              <bdi className="font-mono" dir="ltr">
                {r.consumableCode}
              </bdi>
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'replaced',
      header: t('it.consumables.counter.columns.replaced'),
      render: (r) =>
        r.replaced === null ? (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t('it.consumables.counter.firstOfItem')}
          </span>
        ) : (
          <span className="text-xs" data-counter-replaced={r.replaced.movementId}>
            {t('it.consumables.counter.replacedAt', {
              date: formatDateTime(r.replaced.at, locale),
              reading: formatNumber(r.replaced.reading, locale),
            })}
          </span>
        ),
    },
    {
      key: 'pages',
      header: t('it.consumables.counter.columns.pages'),
      render: (r) => <PagesCell paired={r.replaced !== null} pages={r.replaced?.pages ?? null} />,
    },
  ];
  const shown = all ? readings : readings.slice(0, CARD_ROWS);
  return (
    <Card className="lg:col-span-3">
      <CardHeader
        title={t('it.consumables.counter.cardTitle')}
        description={t('it.consumables.counter.cardHint')}
        {...(readings.length > CARD_ROWS
          ? {
              actions: (
                <Button size="sm" variant="secondary" onClick={() => setAll((open) => !open)}>
                  {all
                    ? t('it.consumables.counter.showFewer')
                    : t('it.consumables.counter.showAll', {
                        n: formatNumber(readings.length, locale),
                      })}
                </Button>
              ),
            }
          : {})}
      />
      <CardBody>
        <div data-printer-counter={assetId}>
          <DataTable
            embedded
            columns={columns}
            rows={shown}
            rowKey={(r) => r.movementId}
            loading={counter.isLoading}
            error={counter.isError ? counter.error : undefined}
            onRetry={() => void counter.refetch()}
          />
        </div>
      </CardBody>
    </Card>
  );
};

/**
 * «عمر الحبارات» — one toner item's cartridges, in its movements: the average pages a cartridge
 * printed, over the ones replaced on their printer, and each cartridge's life. Drawn once the item
 * has a cartridge; read only while the dialog is open.
 */
export const ConsumableCartridges = ({
  consumableId,
  open,
}: {
  consumableId: string;
  open: boolean;
}): JSX.Element | null => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const life = useItConsumableCartridges(consumableId, open);
  const cartridges = life.data?.cartridges ?? [];
  if (life.data === undefined || cartridges.length === 0) return null;
  // The asset's page is the assets' screen: a reader of the store alone reads the printer as text.
  const linksToAssets = can('itAsset.view');
  type Cartridge = (typeof cartridges)[number];
  const columns: Column<Cartridge>[] = [
    {
      key: 'at',
      header: t('it.consumables.movements.columns.at'),
      render: (c) => <span className="tabular-nums">{formatDateTime(c.at, locale)}</span>,
    },
    {
      key: 'printer',
      header: t('it.consumables.counter.columns.printer'),
      render: (c) => {
        const label =
          [c.assetCode, c.assetName]
            .filter((part): part is string => part !== null && part.trim() !== '')
            .join(' — ') || t('it.custody.assetUnknown');
        if (!linksToAssets) return label;
        return (
          <Link
            to={`/it/assets/${c.assetId}`}
            className="text-brand-700 hover:underline dark:text-brand-300"
          >
            {label}
          </Link>
        );
      },
    },
    {
      key: 'installReading',
      header: t('it.consumables.counter.columns.installReading'),
      render: (c) => <CounterReadingCell reading={c.installReading} reset={false} />,
    },
    {
      key: 'removedAt',
      header: t('it.consumables.counter.columns.removedAt'),
      render: (c) =>
        c.removedAt === null ? (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t('it.consumables.counter.latestOfItem')}
          </span>
        ) : (
          <span className="flex flex-col leading-tight">
            <span className="tabular-nums">{formatDateTime(c.removedAt, locale)}</span>
            {c.removedReading !== null && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                <bdi className="font-mono tabular-nums" dir="ltr">
                  {formatNumber(c.removedReading, locale)}
                </bdi>
              </span>
            )}
          </span>
        ),
    },
    {
      key: 'pages',
      header: t('it.consumables.counter.columns.pages'),
      render: (c) => <PagesCell paired={c.removedAt !== null} pages={c.pages} />,
    },
  ];
  const { averagePages, counted } = life.data;
  return (
    <section
      data-consumable-cartridges={consumableId}
      className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {t('it.consumables.counter.cartridgesTitle')}
        </h4>
        <p
          data-cartridges-average={averagePages ?? ''}
          className="rounded-md bg-sky-50 px-2 py-1 text-sm text-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
        >
          {averagePages === null
            ? t('it.consumables.counter.noAverage')
            : t('it.consumables.counter.average', {
                pages: formatNumber(averagePages, locale),
                n: formatNumber(counted, locale),
              })}
        </p>
      </div>
      <DataTable
        embedded
        columns={columns}
        rows={cartridges}
        rowKey={(c) => c.movementId}
        minColumnWidth={6}
      />
    </section>
  );
};
