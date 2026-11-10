// Status and type badges for a cash shipment.
//
// The status ladder is the single most dangerous thing to misread in this domain: the legacy codes
// are NON-ORDINAL, and the literal 1 is the TERMINAL state, not the first step (discovery §6). The
// tones below therefore follow MEANING, not numeric order — `completed` is the success tone
// because the shipment is delivered, and `draft` is neutral because nothing has happened yet.
import {
  type OperationsShipmentStatus,
  type OperationsShipmentType,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Badge, StatusBadge, type Tone } from '../../../shared/ui/Badge';
import { cn } from '../../../shared/lib/cn';

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
 * the badge's title says it in words for whoever cannot tell the colours apart.
 */
const DELIVERY_TONE = { desk: 'success', captain: 'warning', none: 'neutral' } as const;
const DELIVERY_DOT = { desk: 'bg-emerald-500', captain: 'bg-amber-500', none: 'bg-slate-400' } as const;

export const DeliveryStatusBadge = ({
  delivery,
}: {
  delivery: 'desk' | 'captain' | 'none';
}): JSX.Element => {
  const t = useT();
  const label = t(
    delivery === 'none' ? 'operations.board.status.notDelivered' : 'operations.board.status.delivered',
  );
  return (
    <span
      data-delivery={delivery}
      title={
        delivery === 'captain'
          ? t('operations.board.status.byCaptain')
          : delivery === 'desk'
            ? t('operations.board.status.byDesk')
            : undefined
      }
    >
      {/* The small size: the board has fourteen columns to fit beside the menu. */}
      <Badge tone={DELIVERY_TONE[delivery]} size="sm">
        <span className={cn('h-1.5 w-1.5 rounded-full', DELIVERY_DOT[delivery])} />
        {label}
      </Badge>
    </span>
  );
};
