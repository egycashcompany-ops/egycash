// Round 33 B — «الشحنات المسلَّمة»: which shipment has reached its bank, the day the screen asks for,
// and the ✓ «لازم يكون فيه رقم الايصال … و يحدد البنك من او الى اللى هيتحسب عليه تكلفة نقل الشحنة».
import { describe, expect, it } from 'vitest';
import {
  ConfirmOperationsDeliverySchema,
  ErrorCodes,
  EVENT_ACTION_NAMES,
  OPERATIONS_DELIVERY_BILLED_SIDES,
  OPERATIONS_DELIVERY_RECEIPT_NUMBER_MAX,
  OPERATIONS_SHIPMENT_LOG_FIELDS,
  OPERATIONS_SHIPMENT_LOG_KINDS,
  OperationsDeliveredBoardQuerySchema,
  OperationsEvents,
  OperationsShipmentDeliveryPayloadV1,
  UndoOperationsDeliverySchema,
  deliveryReceiptNumberProblem,
  isOperationsReceiptPhotoAddable,
  isOperationsShipmentDeliveredToBank,
} from '../index.js';

const AT = '2026-11-20T09:30:00.000Z';

describe('isOperationsShipmentDeliveredToBank — «هتظهرلى لما تكون تم التسليم بس»', () => {
  it('a daily shipment once its captain delivered it, whatever the desk did', () => {
    for (const status of ['draft', 'completed'] as const) {
      expect(
        isOperationsShipmentDeliveredToBank({
          shipmentType: 'daily',
          status,
          captainDeliveredAt: AT,
        }),
      ).toBe(true);
      expect(
        isOperationsShipmentDeliveredToBank({
          shipmentType: 'daily',
          status,
          captainDeliveredAt: null,
        }),
      ).toBe(false);
    }
  });

  it('a محصنة only once it left the vault for the bank AND its delivery captain delivered it', () => {
    const secured = (status: 'draft' | 'inVault' | 'dispatched' | 'completed', at: string | null) =>
      isOperationsShipmentDeliveredToBank({
        shipmentType: 'secured',
        status,
        captainDeliveredAt: at,
      });
    expect(secured('dispatched', AT)).toBe(true);
    expect(secured('completed', AT)).toBe(true);
    // Out for delivery, not delivered yet.
    expect(secured('dispatched', null)).toBe(false);
    // Still in the vault, or never in it: it has not gone to the bank, whatever its leg says.
    expect(secured('inVault', AT)).toBe(false);
    expect(secured('draft', AT)).toBe(false);
    // A desk-completed محصنة its captain never delivered in the app is not «تم التسليم» here.
    expect(secured('completed', null)).toBe(false);
  });

  it('takes the instant as a Date too (the server’s own rows)', () => {
    expect(
      isOperationsShipmentDeliveredToBank({
        shipmentType: 'daily',
        status: 'draft',
        captainDeliveredAt: new Date(AT),
      }),
    ).toBe(true);
  });
});

describe('isOperationsReceiptPhotoAddable — «ويفضل الصورة تكون مرفوعه», «اختيارية مع تنبيه»', () => {
  const row = (
    shipmentType: 'daily' | 'secured',
    status: 'draft' | 'inVault' | 'dispatched' | 'completed',
    captainDeliveredAt: string | null,
    hasReceiptImage: boolean,
  ) =>
    isOperationsReceiptPhotoAddable({ shipmentType, status, captainDeliveredAt, hasReceiptImage });

  it('takes a first photo on any unlocked shipment, as before', () => {
    expect(row('daily', 'draft', null, false)).toBe(true);
    expect(row('daily', 'completed', AT, false)).toBe(true);
    expect(row('secured', 'draft', null, false)).toBe(true);
  });

  it('keeps Round 10’s lock on a محصنة the vault holds or sent out undelivered', () => {
    expect(row('secured', 'inVault', null, false)).toBe(false);
    expect(row('secured', 'inVault', AT, false)).toBe(false);
    expect(row('secured', 'dispatched', null, false)).toBe(false);
  });

  it('opens a locked محصنة ONCE it reached its bank, for its FIRST photo only', () => {
    expect(row('secured', 'dispatched', AT, false)).toBe(true);
    expect(row('secured', 'completed', AT, false)).toBe(true);
    // A photo there already is what the vault signed for — never replaced on a locked row.
    expect(row('secured', 'dispatched', AT, true)).toBe(false);
    // «Add» is for a row without one, on every shipment.
    expect(row('daily', 'draft', AT, true)).toBe(false);
  });
});

describe('the receipt number — «لازم يكون فيه رقم الايصال»', () => {
  it('is required, trimmed, and capped', () => {
    expect(deliveryReceiptNumberProblem(undefined)).toBe('required');
    expect(deliveryReceiptNumberProblem(null)).toBe('required');
    expect(deliveryReceiptNumberProblem('')).toBe('required');
    expect(deliveryReceiptNumberProblem('   ')).toBe('required');
    expect(deliveryReceiptNumberProblem(' 12345 ')).toBeNull();
    expect(
      deliveryReceiptNumberProblem('x'.repeat(OPERATIONS_DELIVERY_RECEIPT_NUMBER_MAX)),
    ).toBeNull();
    // Spaces around it do not count against the cap — it is stored trimmed.
    expect(
      deliveryReceiptNumberProblem(` ${'x'.repeat(OPERATIONS_DELIVERY_RECEIPT_NUMBER_MAX)} `),
    ).toBeNull();
    expect(
      deliveryReceiptNumberProblem('x'.repeat(OPERATIONS_DELIVERY_RECEIPT_NUMBER_MAX + 1)),
    ).toBe('tooLong');
  });
});

describe('the ✓ and its undo on the wire', () => {
  it('takes the number, the side and the version — the bank and the person are the server’s', () => {
    expect(
      ConfirmOperationsDeliverySchema.parse({
        receiptNumber: 'R-1',
        billedSide: 'destination',
        version: 3,
      }),
    ).toEqual({ receiptNumber: 'R-1', billedSide: 'destination', version: 3 });
    // A bank or a user named by the client is refused outright, never read.
    expect(
      ConfirmOperationsDeliverySchema.safeParse({
        receiptNumber: 'R-1',
        billedSide: 'origin',
        billedBankId: '0123456789abcdef01234567',
        version: 0,
      }).success,
    ).toBe(false);
    expect(
      ConfirmOperationsDeliverySchema.safeParse({
        receiptNumber: 'R-1',
        billedSide: 'origin',
        confirmedById: '0123456789abcdef01234567',
        version: 0,
      }).success,
    ).toBe(false);
  });

  it('leaves an empty number and a missing side to the server’s coded 422 — not a bare 400', () => {
    expect(ConfirmOperationsDeliverySchema.safeParse({ version: 0 }).success).toBe(true);
    expect(
      ConfirmOperationsDeliverySchema.safeParse({ receiptNumber: '', billedSide: null, version: 0 })
        .success,
    ).toBe(true);
    // …but a side that is neither of the two is no side at all.
    expect(
      ConfirmOperationsDeliverySchema.safeParse({ billedSide: 'middle', version: 0 }).success,
    ).toBe(false);
    expect(ConfirmOperationsDeliverySchema.safeParse({ receiptNumber: 'R-1' }).success).toBe(false);
    expect(OPERATIONS_DELIVERY_BILLED_SIDES).toEqual(['origin', 'destination']);
  });

  it('undoes on the version alone', () => {
    expect(UndoOperationsDeliverySchema.parse({ version: 4 })).toEqual({ version: 4 });
    expect(UndoOperationsDeliverySchema.safeParse({}).success).toBe(false);
  });
});

describe('the day the screen asks for', () => {
  it('is a real day, or none (today in Cairo)', () => {
    expect(OperationsDeliveredBoardQuerySchema.parse({})).toEqual({});
    expect(OperationsDeliveredBoardQuerySchema.parse({ date: '2026-11-20' })).toEqual({
      date: '2026-11-20',
    });
    expect(OperationsDeliveredBoardQuerySchema.safeParse({ date: '2026-02-30' }).success).toBe(
      false,
    );
    expect(OperationsDeliveredBoardQuerySchema.safeParse({ date: '20-11-2026' }).success).toBe(
      false,
    );
    expect(OperationsDeliveredBoardQuerySchema.safeParse({ from: '2026-11-20' }).success).toBe(
      false,
    );
  });
});

describe('the record of the act', () => {
  it('names its own refusals', () => {
    expect(ErrorCodes.OPERATIONS_SHIPMENT_NOT_DELIVERED).toBe('OPERATIONS_SHIPMENT_NOT_DELIVERED');
    expect(ErrorCodes.OPERATIONS_DELIVERY_ALREADY_CONFIRMED).toBe(
      'OPERATIONS_DELIVERY_ALREADY_CONFIRMED',
    );
    expect(ErrorCodes.OPERATIONS_DELIVERY_NOT_CONFIRMED).toBe('OPERATIONS_DELIVERY_NOT_CONFIRMED');
    expect(ErrorCodes.OPERATIONS_DELIVERY_RECEIPT_NUMBER_REQUIRED).toBe(
      'OPERATIONS_DELIVERY_RECEIPT_NUMBER_REQUIRED',
    );
    expect(ErrorCodes.OPERATIONS_DELIVERY_RECEIPT_NUMBER_TOO_LONG).toBe(
      'OPERATIONS_DELIVERY_RECEIPT_NUMBER_TOO_LONG',
    );
    expect(ErrorCodes.OPERATIONS_DELIVERY_BILLED_SIDE_REQUIRED).toBe(
      'OPERATIONS_DELIVERY_BILLED_SIDE_REQUIRED',
    );
  });

  it('is its own log kind with its own fields — never the desk’s «received»', () => {
    expect(OPERATIONS_SHIPMENT_LOG_KINDS).toContain('deliveryConfirmed');
    expect(OPERATIONS_SHIPMENT_LOG_KINDS).toContain('deliveryUnconfirmed');
    expect(OPERATIONS_SHIPMENT_LOG_FIELDS).toContain('deliveryReceiptNumber');
    expect(OPERATIONS_SHIPMENT_LOG_FIELDS).toContain('billedBank');
    // `other` stays last — the catch-all.
    expect(OPERATIONS_SHIPMENT_LOG_KINDS.at(-1)).toBe('other');
  });

  it('emits its own events, worded in both languages', () => {
    expect(OperationsEvents.ShipmentDeliveryConfirmed).toBe(
      'operations.shipment.deliveryConfirmed',
    );
    expect(OperationsEvents.ShipmentDeliveryUnconfirmed).toBe(
      'operations.shipment.deliveryUnconfirmed',
    );
    expect(EVENT_ACTION_NAMES.deliveryConfirmed?.ar).toBe('تأكيد التسليم');
    expect(EVENT_ACTION_NAMES.deliveryUnconfirmed?.en).toBe('delivery confirmation undone');
    expect(
      OperationsShipmentDeliveryPayloadV1.safeParse({
        shipmentId: '0123456789abcdef01234567',
        shipmentType: 'daily',
        status: 'draft',
        receiptNumber: 'R-1',
        billedSide: 'origin',
        billedBankId: '0123456789abcdef01234568',
      }).success,
    ).toBe(true);
  });
});
