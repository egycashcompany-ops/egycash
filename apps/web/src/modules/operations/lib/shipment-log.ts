// The shipment's action log, as the screen reads it — «هيكون فى سجل بالاكشنز اللى حصلت على الشحنة»,
// on the day board and on the history alike («السجل … على الشاشتين»).
//
// The server sends the story already in words: every value resolved to a name, a code, a day or an
// amount (`OperationsShipmentLogDto`). What is left to the screen is its own language — the
// sentence each `kind` reads as, the label each `field` reads under, yes / no for a flag — and how
// each kind looks. Pure, so every kind and every field is pinned in `shipment-log.spec.ts` rather
// than through a rendered dialog. The lists are the contract's own CLOSED lists; a kind or a field
// a newer server adds is still shown — as «إجراء آخر», or under its own key — never hidden.
import {
  OPERATIONS_SHIPMENT_LOG_BOOLEAN_FIELDS,
  OPERATIONS_SHIPMENT_LOG_FIELDS,
  OPERATIONS_SHIPMENT_LOG_KINDS,
  type OperationsDayBoardShipmentDto,
  type OperationsShipmentLogField,
  type OperationsShipmentLogKind,
} from '@ecms/contracts';
import { PATH } from '../../fleet/components/FuelCardBoard';
import { SHIPMENT_PATH } from '../components/shipment-icons';
import { boardDateOf } from './day-board';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * The colour of an entry's tile. Two of them are the board's own colours on purpose: the captain's
 * «تم التسليم» is the YELLOW of the row he turns yellow, and the desk's ✓ the GREEN of the row it
 * turns green — so the log and the table say the same thing in the same colour.
 */
export type LogTone =
  | 'brand'
  | 'blue'
  | 'red'
  | 'emerald'
  | 'rose'
  | 'sky'
  | 'violet'
  | 'slate'
  | 'cyan'
  | 'amber'
  | 'teal'
  | 'indigo';

export interface LogKindLook {
  tone: LogTone;
  /** A stroke drawing (`BoardIcon`). */
  icon: readonly string[];
}

/** How each kind looks — every member of the contract's list, so none can render without one. */
export const LOG_KIND_LOOK: Readonly<Record<OperationsShipmentLogKind, LogKindLook>> = {
  created: { tone: 'brand', icon: PATH.plus },
  // The edit action's own blue (the pen in the row's box), the delete's red, the restore's green.
  edited: { tone: 'blue', icon: PATH.edit },
  deleted: { tone: 'red', icon: PATH.trash },
  restored: { tone: 'teal', icon: SHIPMENT_PATH.trashRestore },
  received: { tone: 'emerald', icon: SHIPMENT_PATH.check },
  receiveUndone: { tone: 'rose', icon: SHIPMENT_PATH.undo },
  receiptImageAdded: { tone: 'sky', icon: PATH.image },
  receiptImageReplaced: { tone: 'sky', icon: PATH.image },
  receiptImageRemoved: { tone: 'rose', icon: PATH.image },
  crewAssigned: { tone: 'violet', icon: SHIPMENT_PATH.crew },
  crewChanged: { tone: 'violet', icon: SHIPMENT_PATH.crew },
  reordered: { tone: 'slate', icon: SHIPMENT_PATH.reorder },
  executionStarted: { tone: 'cyan', icon: SHIPMENT_PATH.play },
  executionPickedUp: { tone: 'cyan', icon: PATH.box },
  executionDelivered: { tone: 'amber', icon: SHIPMENT_PATH.checkCircle },
  executionCompleted: { tone: 'teal', icon: SHIPMENT_PATH.flag },
  vaultReceived: { tone: 'indigo', icon: PATH.lock },
  dispatched: { tone: 'indigo', icon: PATH.truck },
  other: { tone: 'slate', icon: SHIPMENT_PATH.info },
};

const KINDS: ReadonlySet<string> = new Set(OPERATIONS_SHIPMENT_LOG_KINDS);
const FIELDS: ReadonlySet<string> = new Set(OPERATIONS_SHIPMENT_LOG_FIELDS);
const FLAGS: ReadonlySet<string> = new Set(OPERATIONS_SHIPMENT_LOG_BOOLEAN_FIELDS);

const knownKind = (kind: string): OperationsShipmentLogKind =>
  KINDS.has(kind) ? (kind as OperationsShipmentLogKind) : 'other';

/** The look of an entry — an unknown kind looks like «إجراء آخر». */
export const logKindLook = (kind: string): LogKindLook => LOG_KIND_LOOK[knownKind(kind)];

/** The sentence an entry reads as («أُنشئت الشحنة», «سلّمها قائد الطاقم» …). */
export const logKindKey = (kind: string): string =>
  `operations.shipment.log.kind.${knownKind(kind)}`;

/** The key of a field's label — every field the contract lists has one. */
export const logFieldKey = (field: OperationsShipmentLogField): string =>
  `operations.shipment.log.field.${field}`;

/** A change's label: the field's own words, or — for a field this screen does not know yet — its key. */
export const logFieldLabel = (field: string, t: Translate): string =>
  FIELDS.has(field) ? t(logFieldKey(field as OperationsShipmentLogField)) : field;

/** No value (`null`, or an empty one) — the boards' dash. */
export const LOG_EMPTY_VALUE = '—';

/**
 * A change's value as the reader sees it. Everything is a display string already (names, codes,
 * days, «مصري 1,500.5»); only a flag is 'true' / 'false', said as yes / no in the page's language.
 */
export const logValue = (field: string, value: string | null, t: Translate): string => {
  if (value === null || value.trim() === '') return LOG_EMPTY_VALUE;
  if (FLAGS.has(field)) {
    if (value === 'true') return t('operations.shipment.log.yes');
    if (value === 'false') return t('operations.shipment.log.no');
  }
  return value;
};

/**
 * Whether an entry's changes are read old → new. An edit always is — that is what «اللى يتعدل
 * يظهر ف السجل» asks to see, a field filled for the first time included («— ← …»). Any other entry
 * is read old → new only when something came before: a booking, a first crew or a vault receipt
 * carries FIRST values (every `old` null), and «— ←» on every line would only say, line after
 * line, that nothing came before. A crew CHANGE carries the captain it replaced, and shows it.
 */
export const showsOldValues = (entry: {
  kind: string;
  changes: readonly { old: string | null }[];
}): boolean => entry.kind === 'edited' || entry.changes.some((change) => change.old !== null);

const CAIRO_STAMP = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * When an act happened, on the desk's clock: the Cairo day and time («2026-11-11», «14:05»),
 * whatever the reader's browser zone — two people reading the same log must read the same hour.
 * Latin digits and the day written as the board writes it (year first, with dashes).
 */
export const cairoStamp = (iso: string): { day: string; time: string } => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return { day: LOG_EMPTY_VALUE, time: '' };
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    CAIRO_STAMP.formatToParts(at).find((p) => p.type === type)?.value ?? '';
  return {
    day: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
};

/** «2026-11-11 14:05» — one Cairo stamp on one line. */
export const cairoStampText = (iso: string): string => {
  const { day, time } = cairoStamp(iso);
  return time === '' ? day : `${day} ${time}`;
};

/**
 * A run of Latin figures kept in its own order inside Arabic text — a left-to-right ISOLATE (U+2066
 * … U+2069). Written after Arabic words, «2026-11-11» is otherwise read as three Arabic-context
 * numbers split by two dashes, and shows as «11-11-2026». For text that has no element of its own
 * to carry `dir="ltr"` — a dialog's subtitle, a sentence filled from the catalog.
 */
export const ltrIsolate = (text: string): string => `\u2066${text}\u2069`;

/**
 * What the log is ABOUT, under its title: «الأهلي · المعادي ← الدقي · 2026-11-11» — the bank, the
 * route as the board's two branch columns name it, and the board day (a secured shipment's is its
 * delivery day, as on the board), isolated so it reads year first. A name the row cannot give
 * reads «…», as the board's cells do.
 */
export const shipmentCaption = (
  row: Pick<
    OperationsDayBoardShipmentDto,
    'mainBankId' | 'origin' | 'destination' | 'shipmentType' | 'collectionDate' | 'deliveryDate'
  >,
  bankNameOf: (bankId: string) => string,
  t: Translate,
): string => {
  const bank = bankNameOf(row.mainBankId);
  const route = t('operations.shipment.log.route', {
    origin: row.origin?.name ?? '…',
    destination: row.destination?.name ?? '…',
  });
  const day = (boardDateOf(row as OperationsDayBoardShipmentDto) ?? row.collectionDate).slice(
    0,
    10,
  );
  return [bank === '' ? '…' : bank, route, ltrIsolate(day)].join(' · ');
};
