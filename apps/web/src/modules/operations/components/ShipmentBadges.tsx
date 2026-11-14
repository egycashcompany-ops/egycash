// Status and type badges for a cash shipment.
//
// The status ladder is the single most dangerous thing to misread in this domain: the legacy codes
// are NON-ORDINAL, and the literal 1 is the TERMINAL state, not the first step (discovery §6). The
// tones below therefore follow MEANING, not numeric order — `completed` is the success tone
// because the shipment is delivered, and `draft` is neutral because nothing has happened yet.
import {
  type OperationsSecuredStage,
  type OperationsShipmentStatus,
  type OperationsShipmentType,
  type OperationsVaultQueueShipmentDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Badge, StatusBadge, type Tone } from '../../../shared/ui/Badge';
import { cn } from '../../../shared/lib/cn';
import { type VaultHoldColumn, type VaultPickupColumn } from '../lib/day-board';
import { cairoToday } from '../lib/shipment-history';
import { ltrIsolate } from '../lib/shipment-log';
import { queueStampText, vaultHoldCell, vaultPickupCell } from '../lib/vault-queue';
import {
  BuildingIcon,
  CheckIcon,
  ExternalLinkIcon,
  LockIcon,
  TruckIcon,
} from '../../../shared/ui/icons';

const STATUS_TONES: Record<OperationsShipmentStatus, Tone> = {
  draft: 'neutral',
  inVault: 'info',
  dispatched: 'warning',
  completed: 'success',
};

export const ShipmentStatusBadge = ({
  status,
}: {
  status: OperationsShipmentStatus;
}): JSX.Element => {
  const t = useT();
  return (
    <StatusBadge tone={STATUS_TONES[status]} label={t(`operations.shipment.status.${status}`)} />
  );
};

/**
 * `daily` (يومي) vs `secured` (محصنة). The distinction drives which date the row is about and
 * which workflow the shipment follows, so it is always visible rather than inferred from context.
 */
export const ShipmentTypeBadge = ({
  shipmentType,
}: {
  shipmentType: OperationsShipmentType;
}): JSX.Element => {
  const t = useT();
  return (
    <Badge tone={shipmentType === 'secured' ? 'brand' : 'neutral'} size="sm">
      {t(`operations.shipment.type.${shipmentType}`)}
    </Badge>
  );
};

/**
 * The day board's «الحالة»: «تم التسليم» or «لم يتم التسليم», as the owner words it. Who delivered
 * changes the ROW's colour (yellow: the crew captain from the mobile app; green: the desk's ✓), and
 * the badge says it without colour too: its glyph (a van, a tick), and the words for a screen
 * reader and on hover.
 */
const DELIVERY_TONE = { desk: 'success', captain: 'warning', none: 'neutral' } as const;
const DELIVERY_DOT = {
  desk: 'bg-emerald-500',
  captain: 'bg-amber-500',
  none: 'bg-slate-400',
} as const;

export const DeliveryStatusBadge = ({
  delivery,
}: {
  delivery: 'desk' | 'captain' | 'none';
}): JSX.Element => {
  const t = useT();
  const label = t(
    delivery === 'none'
      ? 'operations.board.status.notDelivered'
      : 'operations.board.status.delivered',
  );
  const who =
    delivery === 'captain'
      ? t('operations.board.status.byCaptain')
      : delivery === 'desk'
        ? t('operations.board.status.byDesk')
        : null;
  return (
    <span data-delivery={delivery} title={who ?? undefined}>
      {/* The small size: the board has fourteen columns to fit beside the menu. */}
      <Badge tone={DELIVERY_TONE[delivery]} size="sm">
        {/* WHO delivered is not left to colour alone (yellow and green are the pair a red-green
            colour-blind reader confuses): a van for the captain, a tick for the desk, and the
            words for a screen reader. */}
        {delivery === 'captain' ? (
          <TruckIcon className="h-3.5 w-3.5" aria-hidden />
        ) : delivery === 'desk' ? (
          <CheckIcon className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <span className={cn('h-1.5 w-1.5 rounded-full', DELIVERY_DOT[delivery])} />
        )}
        {label}
        {who !== null && <span className="sr-only"> — {who}</span>}
      </Badge>
    </span>
  );
};

/**
 * A محصنة's «الحالة», on the secured screen and on the day board and the history alike — where it
 * stands (`securedStage`, `lib/secured-stage.ts`), in the owner's words: «لم يتم التسليم», «تم
 * الاستلام من القائد», «تم الاستلام من العمليات», «بالخزينة», «خرجت للتسليم», «تم التسليم». The row's
 * colour says the same (yellow once collected, green in the vault, blue on the road); the badge says
 * it WITHOUT colour too, as the daily one does: a glyph per stage — the captain's van, the
 * Operations office (the two yellows are told apart by it, not by their colour), the vault's lock,
 * an arrow leaving it, the desk's tick — and a sentence on hover and for a screen reader.
 */
const STAGE_TONE: Record<OperationsSecuredStage, Tone> = {
  awaitingPickup: 'neutral',
  withCaptain: 'warning',
  withOperations: 'warning',
  inVault: 'success',
  dispatched: 'info',
  completed: 'success',
};

/** `shrink-0`: beside a label that wraps, the glyph keeps its size. */
const STAGE_GLYPH: Record<OperationsSecuredStage, JSX.Element> = {
  awaitingPickup: <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />,
  withCaptain: <TruckIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />,
  withOperations: <BuildingIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />,
  inVault: <LockIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />,
  dispatched: <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />,
  completed: <CheckIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />,
};

/**
 * How narrow a badge's words may wrap. The stage badge's floor (`wide`) is the daily badge's «لم
 * يتم التسليم». The vault queue's two columns share about ONE column's width between them, so their
 * floors are lower and the badge's sides come in: «حالة الاستلام» (`pickup`) as wide as «من
 * العمليات», so «تم الاستلام» sits over it in exactly two lines; «حالة الخزينة» (`hold`) narrower
 * still — its column is as wide as its «استُلمت 09:40» anyway, and its longer words take two lines
 * («لم تُستلم» over «بعد», «خرجت» over «للتسليم»). That is what keeps the actions on a 1440 laptop
 * beside the menu. Written out because Tailwind reads class names from the source text.
 */
const FACE_FIT = {
  wide: { label: 'min-w-[4.75rem]', badge: '' },
  pickup: { label: 'min-w-[4.25rem]', badge: '!px-1.5' },
  hold: { label: 'min-w-[3rem]', badge: '!px-1.5' },
} as const;

/** The muted face of an absence («لم يتم الاستلام»): no fill, a thin ring, quieter words. */
const MUTED_FACE =
  '!bg-transparent !text-slate-500 ring-1 ring-inset ring-slate-300 dark:!bg-transparent dark:!text-slate-400 dark:ring-slate-600';

/**
 * A stage's badge face — its tone, its glyph, its words and, for a screen reader, its sentence.
 * Shared by the stage badge and the vault queue's two columns, which speak in the same badges.
 */
const StageFace = ({
  look,
  label,
  hint,
  muted = false,
  fit = 'wide',
}: {
  look: OperationsSecuredStage;
  label: string;
  hint: string;
  muted?: boolean;
  fit?: keyof typeof FACE_FIT;
}): JSX.Element => (
  // «تم الاستلام من القائد» and «تم الاستلام من العمليات» are the longest statuses a board prints:
  // on one line they widened «الحالة» by some 60px, enough to push the actions past the edge of a
  // 1440 laptop beside the menu. So the label may wrap — but from a floor as wide as the daily
  // badge's «لم يتم التسليم», or the table, which squeezes a wrapping cell to its longest word,
  // stacks it a word a line. The short labels keep their one line; the long ones take exactly two.
  <Badge tone={STAGE_TONE[look]} size="sm" className={cn(FACE_FIT[fit].badge, muted && MUTED_FACE)}>
    {STAGE_GLYPH[look]}
    <span className={cn(FACE_FIT[fit].label, 'whitespace-normal')}>{label}</span>
    <span className="sr-only"> — {hint}</span>
  </Badge>
);

export const SecuredStageBadge = ({ stage }: { stage: OperationsSecuredStage }): JSX.Element => {
  const t = useT();
  const hint = t(`operations.board.stageHint.${stage}`);
  return (
    <span data-secured-stage={stage} title={hint}>
      <StageFace look={stage} label={t(`operations.board.stage.${stage}`)} hint={hint} />
    </span>
  );
};

/**
 * ROUND 13 — THE VAULT QUEUE'S TWO STATUS COLUMNS. «انا عايز الجدول بتاع استلام الخزينه يكون مكان
 * الحاله عمودين. العمود الاولاني يبقى خاص يبين ان اللي حصل استلام من القائد او من العمليات، والعمود
 * التاني بتاع الحاله برضو يبين استلام من الخزينه» — each in the stage badge's own face (the same
 * tones and glyphs as every board: yellow with a van or the Operations office for a pickup, the
 * vault's green lock, the blue arrow out, the desk's tick), with WHEN under it:
 *
 *   · «حالة الاستلام» — «تم الاستلام من القائد» / «تم الاستلام من العمليات» and the time of that ✓,
 *     or «لم يتم الاستلام», muted — on a draft nobody collected yet, and for good on a receipt
 *     nobody handed over («والخزنه تستلم عادي»: the vault never writes the pickup);
 *   · «حالة الخزينة» — «لم تُستلم بعد», «بالخزينة», or for a receipt of today that has already left,
 *     «خرجت للتسليم» / «تم التسليم» — each received one with «استُلمت …», the vault's own time.
 *
 * A stamp is the time alone when it is today (every receipt here is, and most pickups) and the day
 * with it otherwise (`queueStampText`) — a pickup from yesterday still waiting says so.
 */
const PICKUP_LOOK: Record<VaultPickupColumn, OperationsSecuredStage> = {
  captain: 'withCaptain',
  operations: 'withOperations',
  none: 'awaitingPickup',
};
export const VAULT_PICKUP_LABEL: Record<VaultPickupColumn, string> = {
  captain: 'operations.board.stage.withCaptain',
  operations: 'operations.board.stage.withOperations',
  none: 'operations.vault.queue.awaiting',
};
const HOLD_LOOK: Record<VaultHoldColumn, OperationsSecuredStage> = {
  waiting: 'awaitingPickup',
  inVault: 'inVault',
  dispatched: 'dispatched',
  completed: 'completed',
};
export const VAULT_HOLD_LABEL: Record<VaultHoldColumn, string> = {
  waiting: 'operations.vault.queue.hold.waiting',
  inVault: 'operations.board.stage.inVault',
  dispatched: 'operations.board.stage.dispatched',
  completed: 'operations.board.stage.completed',
};
const HOLD_HINT: Record<VaultHoldColumn, string> = {
  waiting: 'operations.vault.queue.holdHint.waiting',
  inVault: 'operations.board.stageHint.inVault',
  dispatched: 'operations.board.stageHint.dispatched',
  completed: 'operations.board.stageHint.completed',
};

/**
 * The line under a column's badge — a Cairo stamp, its figures kept in their own order. A pickup's
 * may wrap at its space (`wrap`), so one from another day («2026-11-13 16:30») takes two short lines
 * rather than widening the column past its badge; the vault's «استُلمت 09:40» is always today's, and
 * keeps its one line.
 */
const QueueStamp = ({
  iso,
  wrap = false,
  children,
}: {
  iso: string;
  wrap?: boolean;
  children: string;
}): JSX.Element => (
  <time
    dateTime={iso}
    data-vault-stamp
    className={cn(
      'block text-[11px] leading-tight text-slate-500 dark:text-slate-400',
      wrap ? 'whitespace-normal' : 'whitespace-nowrap',
    )}
  >
    {children}
  </time>
);

export const VaultPickupStatus = ({
  row,
}: {
  row: Pick<OperationsVaultQueueShipmentDto, 'pickedUpBy' | 'pickedUpAt'>;
}): JSX.Element => {
  const t = useT();
  const { by, at } = vaultPickupCell(row);
  const hint = t(`operations.vault.queue.pickupHint.${by}`);
  return (
    <span data-vault-pickup={by} title={hint} className="inline-flex flex-col items-start gap-0.5">
      <StageFace
        look={PICKUP_LOOK[by]}
        label={t(VAULT_PICKUP_LABEL[by])}
        hint={hint}
        muted={by === 'none'}
        fit="pickup"
      />
      {at !== null && (
        <QueueStamp iso={at} wrap>
          {ltrIsolate(queueStampText(at, cairoToday()))}
        </QueueStamp>
      )}
    </span>
  );
};

export const VaultHoldStatus = ({
  row,
}: {
  row: Pick<OperationsVaultQueueShipmentDto, 'status'> &
    Partial<Pick<OperationsVaultQueueShipmentDto, 'vaultReceivedAt'>>;
}): JSX.Element => {
  const t = useT();
  const { hold, at } = vaultHoldCell(row);
  const hint = t(HOLD_HINT[hold]);
  return (
    <span data-vault-hold={hold} title={hint} className="inline-flex flex-col items-start gap-0.5">
      <StageFace look={HOLD_LOOK[hold]} label={t(VAULT_HOLD_LABEL[hold])} hint={hint} fit="hold" />
      {at !== null && (
        <QueueStamp iso={at}>
          {t('operations.vault.queue.receivedAt', {
            at: ltrIsolate(queueStampText(at, cairoToday())),
          })}
        </QueueStamp>
      )}
    </span>
  );
};
