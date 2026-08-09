// Maintenance-order code formatting (design §2.1): `MO-00001` — global, monotonic, permanent,
// never reused. Pure formatting; allocation goes through the module's shared atomic counter, the
// same one asset and ticket codes come off.
import { nextSequenceValue } from '../shared/sequence';

export const MAINTENANCE_ORDER_SEQUENCE_KEY = 'maintenanceOrder:global';

/** Width the code pads to; larger sequences simply grow wider — the format never truncates. */
export const MAINTENANCE_ORDER_CODE_MIN_DIGITS = 5;

export const formatMaintenanceOrderCode = (seq: number): string =>
  `MO-${String(seq).padStart(MAINTENANCE_ORDER_CODE_MIN_DIGITS, '0')}`;

export const nextMaintenanceOrderCode = async (): Promise<string> =>
  formatMaintenanceOrderCode(await nextSequenceValue(MAINTENANCE_ORDER_SEQUENCE_KEY));
