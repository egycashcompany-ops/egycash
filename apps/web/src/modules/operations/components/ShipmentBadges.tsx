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
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Badge, StatusBadge, type Tone } from '../../../shared/ui/Badge';
import { cn } from '../../../shared/lib/cn';
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

export const SecuredStageBadge = ({ stage }: { stage: OperationsSecuredStage }): JSX.Element => {
  const t = useT();
  const hint = t(`operations.board.stageHint.${stage}`);
  return (
    <span data-secured-stage={stage} title={hint}>
      {/* «تم الاستلام من القائد» and «تم الاستلام من العمليات» are the longest statuses a board
          prints: on one line they widened «الحالة» by some 60px, enough to push the actions past
          the edge of a 1440 laptop beside the menu. So the label may wrap — but from a floor as
          wide as the daily badge's «لم يتم التسليم», or the table, which squeezes a wrapping cell
          to its longest word, stacks it a word a line. The short labels keep their one line; the
          long ones take exactly two. */}
      <Badge tone={STAGE_TONE[stage]} size="sm">
        {STAGE_GLYPH[stage]}
        <span className="min-w-[4.75rem] whitespace-normal">
          {t(`operations.board.stage.${stage}`)}
        </span>
        <span className="sr-only"> — {hint}</span>
      </Badge>
    </span>
  );
};
