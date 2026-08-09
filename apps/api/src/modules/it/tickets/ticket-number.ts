// Ticket code formatting (design §2.1): `TKT-00001` — global, monotonic, permanent, never reused.
// Pure formatting; allocation goes through the module's shared atomic counter.
import { nextSequenceValue } from '../shared/sequence';

export const TICKET_SEQUENCE_KEY = 'ticket:global';

/** Width the code pads to; larger sequences simply grow wider — the format never truncates. */
export const TICKET_CODE_MIN_DIGITS = 5;

export const formatTicketCode = (seq: number): string =>
  `TKT-${String(seq).padStart(TICKET_CODE_MIN_DIGITS, '0')}`;

export const nextTicketCode = async (): Promise<string> =>
  formatTicketCode(await nextSequenceValue(TICKET_SEQUENCE_KEY));
