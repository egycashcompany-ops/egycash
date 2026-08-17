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
