// The action log's own words and looks — «هيكون فى سجل بالاكشنز اللى حصلت على الشحنة». The server
// sends every value already resolved; these are the screen's half: a sentence and a look for every
// kind the contract can send, a label for every field, yes / no for a flag, the Cairo hour, and the
// line under the dialog's title that names the shipment.
import { describe, expect, it } from 'vitest';
import {
  OPERATIONS_SHIPMENT_LOG_BOOLEAN_FIELDS,
  OPERATIONS_SHIPMENT_LOG_FIELDS,
  OPERATIONS_SHIPMENT_LOG_KINDS,
  type Locale,
} from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import {
  LOG_EMPTY_VALUE,
  LOG_KIND_LOOK,
  ltrIsolate,
  cairoStamp,
  cairoStampText,
  logFieldKey,
  logFieldLabel,
  logKindKey,
  logKindLook,
  logValue,
  shipmentCaption,
  showsOldValues,
} from './shipment-log';

const LOCALES: Locale[] = ['ar', 'en'];
const tOf = (locale: Locale) => (key: string, params?: Record<string, string | number>) =>
  translate(locale, key, params);
const ar = tOf('ar');

describe('every kind the server can send reads as a sentence, in a look of its own', () => {
  it('has a look — a tone and a drawing — for each of the contract’s kinds', () => {
    expect(Object.keys(LOG_KIND_LOOK).sort()).toEqual([...OPERATIONS_SHIPMENT_LOG_KINDS].sort());
    for (const kind of OPERATIONS_SHIPMENT_LOG_KINDS) {
      expect(LOG_KIND_LOOK[kind].icon.length, kind).toBeGreaterThan(0);
    }
  });

  it('words each kind in both languages, and no two kinds alike', () => {
    for (const locale of LOCALES) {
      const sentences = OPERATIONS_SHIPMENT_LOG_KINDS.map((kind) => {
        const key = logKindKey(kind);
        const value = translate(locale, key);
        expect(value, `${locale}: ${key}`).not.toBe(key);
        return value;
      });
      expect(new Set(sentences).size).toBe(sentences.length);
    }
  });

  it('says the owner’s acts in his words', () => {
    expect(ar(logKindKey('created'))).toBe('أُنشئت الشحنة');
    expect(ar(logKindKey('edited'))).toBe('عُدّلت الشحنة');
    expect(ar(logKindKey('executionDelivered'))).toBe('سلّمها قائد الطاقم');
    expect(ar(logKindKey('received'))).toBe('أكّد المكتب التسليم');
    expect(ar(logKindKey('receiveUndone'))).toBe('أُلغي تأكيد التسليم');
    expect(ar(logKindKey('receiptImageAdded'))).toBe('رُفعت صورة الإيصال');
    expect(ar(logKindKey('deleted'))).toBe('حُذفت الشحنة');
    expect(ar(logKindKey('restored'))).toBe('استُرجعت الشحنة');
  });

  it('colours the captain’s delivery and the desk’s ✓ as the board colours their rows', () => {
    // Yellow: the crew captain delivered; green: the desk confirmed — the row tints' own meaning.
    expect(LOG_KIND_LOOK.executionDelivered.tone).toBe('amber');
    expect(LOG_KIND_LOOK.received.tone).toBe('emerald');
    expect(LOG_KIND_LOOK.deleted.tone).toBe('red');
  });

  it('shows a kind a newer server adds as «إجراء آخر» — shown, never hidden', () => {
    expect(logKindKey('somethingNew')).toBe('operations.shipment.log.kind.other');
    expect(logKindLook('somethingNew')).toBe(LOG_KIND_LOOK.other);
    expect(ar(logKindKey('somethingNew'))).toBe('إجراء آخر');
  });
});

describe('every field a change can carry has a label', () => {
  it('labels each of the contract’s fields in both languages', () => {
    for (const locale of LOCALES) {
      for (const field of OPERATIONS_SHIPMENT_LOG_FIELDS) {
        const key = logFieldKey(field);
        expect(translate(locale, key), `${locale}: ${key}`).not.toBe(key);
        expect(logFieldLabel(field, tOf(locale))).toBe(translate(locale, key));
      }
    }
  });

  it('names the shipment’s fields as the board and the form name them', () => {
    expect(logFieldLabel('originBranch', ar)).toBe(ar('operations.shipment.origin'));
    expect(logFieldLabel('destinationBranch', ar)).toBe(ar('operations.shipment.destination'));
    expect(logFieldLabel('lines', ar)).toBe(ar('operations.shipment.form.amount'));
    expect(logFieldLabel('captain', ar)).toBe(ar('operations.board.captain'));
    expect(logFieldLabel('collectionDate', ar)).toBe(ar('operations.shipment.collectionDate'));
  });

  it('falls back to the field’s own key for one this screen does not know yet', () => {
    expect(logFieldLabel('fuelLevel', ar)).toBe('fuelLevel');
  });
});

describe('a change’s value', () => {
  it('is the server’s display string as it came', () => {
    expect(logValue('lines', 'مصري 1,500.5، دولار 100', ar)).toBe('مصري 1,500.5، دولار 100');
    expect(logValue('collectionDate', '2026-11-12', ar)).toBe('2026-11-12');
  });

  it('is the dash when there is none', () => {
    expect(logValue('notes', null, ar)).toBe(LOG_EMPTY_VALUE);
    expect(logValue('notes', '  ', ar)).toBe(LOG_EMPTY_VALUE);
  });

  it('says a flag as yes / no in the page’s language, and only a flag', () => {
    expect(OPERATIONS_SHIPMENT_LOG_BOOLEAN_FIELDS).toContain('serialTracked');
    expect(logValue('serialTracked', 'true', ar)).toBe('نعم');
    expect(logValue('serialTracked', 'false', ar)).toBe('لا');
    expect(logValue('serialTracked', 'true', tOf('en'))).toBe('Yes');
    // A note that happens to read «true» is a note.
    expect(logValue('notes', 'true', ar)).toBe('true');
  });

  it('is read old → new on an edit, and elsewhere only when something came before', () => {
    const first = [{ old: null }, { old: null }];
    // An edit always — a field filled for the first time reads «— ← …».
    expect(showsOldValues({ kind: 'edited', changes: first })).toBe(true);
    // A booking, a first crew, a vault receipt: first values, listed plainly.
    expect(showsOldValues({ kind: 'created', changes: first })).toBe(false);
    expect(showsOldValues({ kind: 'crewAssigned', changes: first })).toBe(false);
    expect(showsOldValues({ kind: 'vaultReceived', changes: first })).toBe(false);
    // A crew change names the captain it replaced.
    expect(
      showsOldValues({ kind: 'crewChanged', changes: [{ old: 'وليد سيد فوزي' }, { old: null }] }),
    ).toBe(true);
  });
});

describe('when — the Cairo day and hour, Latin digits', () => {
  it('reads the desk’s clock, not the browser’s', () => {
    // Winter: Cairo is UTC+2 — 22:30Z is half past midnight the NEXT day in Cairo.
    expect(cairoStamp('2026-11-10T22:30:00.000Z')).toEqual({ day: '2026-11-11', time: '00:30' });
    expect(cairoStamp('2026-11-11T12:05:00.000Z')).toEqual({ day: '2026-11-11', time: '14:05' });
    // Summer: UTC+3.
    expect(cairoStamp('2026-07-01T09:15:00.000Z')).toEqual({ day: '2026-07-01', time: '12:15' });
  });

  it('writes the hour on a 24-hour clock and the day as the board writes it', () => {
    expect(cairoStampText('2026-11-11T18:40:00.000Z')).toBe('2026-11-11 20:40');
    expect(cairoStampText('2026-11-11T18:40:00.000Z')).toMatch(/^[0-9-]+ [0-9:]+$/);
  });

  it('says a broken instant as the dash rather than «Invalid Date»', () => {
    expect(cairoStampText('not a date')).toBe(LOG_EMPTY_VALUE);
  });
});

describe('the line under the dialog’s title names the shipment', () => {
  const bankNameOf = (id: string): string => (id === 'b-ahly' ? 'الأهلي' : '');
  const side = (name: string) => ({
    id: name,
    name,
    code: 'X',
    bankId: 'b-ahly',
    bankName: 'الأهلي',
  });
  const daily = {
    mainBankId: 'b-ahly',
    origin: side('المعادي'),
    destination: side('الدقي'),
    shipmentType: 'daily' as const,
    collectionDate: '2026-11-11T00:00:00.000Z',
    deliveryDate: null,
  };

  it('reads bank · من ← إلى · the board day', () => {
    expect(shipmentCaption(daily, bankNameOf, ar)).toBe(
      `الأهلي · المعادي ← الدقي · ${ltrIsolate('2026-11-11')}`,
    );
    expect(shipmentCaption(daily, bankNameOf, tOf('en'))).toBe(
      `الأهلي · المعادي → الدقي · ${ltrIsolate('2026-11-11')}`,
    );
  });

  it('keeps the day year first after the Arabic words — a left-to-right isolate around it', () => {
    // Without it the browser reads «2026-11-11» after Arabic as three numbers split by dashes and
    // draws «11-11-2026» (the first screenshot of this dialog did).
    expect(ltrIsolate('2026-11-11')).toBe('\u20662026-11-11\u2069');
    expect(shipmentCaption(daily, bankNameOf, ar).endsWith('\u20662026-11-11\u2069')).toBe(true);
  });

  it('dates a secured shipment by its delivery day, as the board does', () => {
    expect(
      shipmentCaption(
        {
          ...daily,
          shipmentType: 'secured',
          collectionDate: '2026-11-08T00:00:00.000Z',
          deliveryDate: '2026-11-12T00:00:00.000Z',
        },
        bankNameOf,
        ar,
      ),
    ).toBe(`الأهلي · المعادي ← الدقي · ${ltrIsolate('2026-11-12')}`);
  });

  it('says «…» for what the row cannot name, as the board’s cells do', () => {
    expect(shipmentCaption({ ...daily, mainBankId: 'gone', origin: null }, bankNameOf, ar)).toBe(
      `… · … ← الدقي · ${ltrIsolate('2026-11-11')}`,
    );
  });
});
