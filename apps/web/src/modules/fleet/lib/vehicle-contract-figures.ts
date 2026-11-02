// «عقود توريد السيارات» — the figures the screens work out themselves, pure and React-free:
//   · the editor's line totals and the contract's total as they are typed — in piastres, so
//     22 × 4,700,000 never drifts;
//   · «المستلم حتى الآن» on a new contract — what each line already received, recorded by the
//     server as the contract's first delivery — and the bodies Save sends;
//   · «تسجيل استلام»: per line what was contracted, received before, still owed and typed now, and
//     whether a box asks for more than is owed (the server refuses it too);
//   · the new delivery's ordinal — its date's place among the live ones;
//   · the files a contract may take (the four types, 10 MB), and their order.
// Everything the server computes (received, remaining, the alarm) is read from the DTO, never
// recomputed here.
import {
  FLEET_VEHICLE_CONTRACT_FILE_MAX_MB,
  FLEET_VEHICLE_CONTRACT_FILE_MIMES,
  fleetContractLineTotal,
  type CreateFleetVehicleContract,
  type FleetVehicleContractDto,
  type FleetVehicleContractLineDto,
  type UpdateFleetVehicleContract,
} from '@ecms/contracts';

const toPiastres = (value: number): number => Math.round(value * 100);

/** `part` of `whole` as a whole percentage — 0 of nothing is 0%. */
export const pct = (part: number, whole: number): number =>
  whole <= 0 ? 0 : Math.round((part / whole) * 100);

/** What a count box holds, as a count — an empty box is none. */
export const typedCount = (raw: string | undefined): number => {
  if (raw === undefined || raw.trim() === '') return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
};

// ── The editor ──────────────────────────────────────────────────────────────────────────────────

/** One line as the editor holds it: the boxes' own text. */
export interface EditorLine {
  /** The row's own key, for React. */
  key: string;
  /** The saved line it edits; `null` for a new one. */
  id: string | null;
  typeId: string;
  count: string;
  price: string;
  /**
   * «المستلم حتى الآن» — on a new contract, the cars of this line already received (empty is
   * none). On an edit it holds the saved figure, shown locked.
   */
  received: string;
}

/** «الإجمالي» of a line — `null` until both its count and its price are written. */
export const editorLineTotal = (line: Pick<EditorLine, 'count' | 'price'>): number | null => {
  if (line.count.trim() === '' || line.price.trim() === '') return null;
  const price = Number(line.price);
  if (!Number.isFinite(price)) return null;
  return fleetContractLineTotal(typedCount(line.count), price);
};

export interface EditorTotals {
  /** «إجمالي العقد», EGP — a line without a price counts 0. */
  total: number;
  /** Cars across the lines. */
  cars: number;
  /** Lines whose total is worked out (count and price both written). */
  priced: number;
  /** «المستلم حتى الآن» across the lines — an empty box is none. */
  received: number;
}

export const editorTotals = (
  lines: readonly (Pick<EditorLine, 'count' | 'price'> & Partial<Pick<EditorLine, 'received'>>)[],
): EditorTotals =>
  lines.reduce<EditorTotals>(
    (sum, line) => {
      const total = editorLineTotal(line);
      return {
        total: (toPiastres(sum.total) + toPiastres(total ?? 0)) / 100,
        cars: sum.cars + typedCount(line.count),
        priced: sum.priced + (total === null ? 0 : 1),
        received: sum.received + typedCount(line.received),
      };
    },
    { total: 0, cars: 0, priced: 0, received: 0 },
  );

// ── «المستلم حتى الآن» ───────────────────────────────────────────────────────────────────────────

/**
 * How the editor offers «المستلم حتى الآن»:
 *   edit    — «عقد جديد» for a holder of «تسجيل استلام»: a box per line, recorded as the first delivery;
 *   locked  — «تعديل العقد»: the saved figure, read-only (it changes through «الاستلامات» on the
 *             contract's page; the Update schema refuses it);
 *   hidden  — «عقد جديد» without that grant: the column is not drawn (the server refuses received
 *             cars from such a user too).
 */
export type ReceivedMode = 'edit' | 'locked' | 'hidden';

export const receivedModeOf = (editing: boolean, mayReceive: boolean): ReceivedMode =>
  editing ? 'locked' : mayReceive ? 'edit' : 'hidden';

/** A received box asking for more cars than its line names — the box turns rose and Save waits. */
export const receivedOver = (line: Pick<EditorLine, 'count' | 'received'>): boolean =>
  typedCount(line.received) > typedCount(line.count);

export interface EditorReceived {
  /** Received across the lines: typed on a new contract, the saved figure on an edit. */
  received: number;
  /** Still owed once those arrived — never under 0. */
  left: number;
  /** The lines (with a count) whose box is over it — Save waits while there is one. */
  over: EditorLine[];
}

export const editorReceived = (
  lines: readonly EditorLine[],
  mode: ReceivedMode,
  saved: number,
): EditorReceived => {
  const cars = lines.reduce((sum, line) => sum + typedCount(line.count), 0);
  const received =
    mode === 'edit'
      ? lines.reduce((sum, line) => sum + typedCount(line.received), 0)
      : mode === 'locked'
        ? saved
        : 0;
  return {
    received,
    left: Math.max(0, cars - received),
    over:
      mode === 'edit'
        ? lines.filter((line) => typedCount(line.count) >= 1 && receivedOver(line))
        : [],
  };
};

// ── What Save sends ──────────────────────────────────────────────────────────────────────────────

/** The editor's form, as its boxes hold it. */
export interface EditorForm {
  date: string;
  deadline: string;
  name: string;
  supplier: string;
  lines: EditorLine[];
  /** «تاريخ الاستلام» of the first delivery — today until changed. */
  receivedDate: string;
}

const contractBodyOf = (form: EditorForm): Omit<UpdateFleetVehicleContract, 'version'> => ({
  name: form.name.trim(),
  date: new Date(form.date),
  deadline: form.deadline === '' ? null : new Date(form.deadline),
  supplier: form.supplier.trim(),
  lines: form.lines.map((line) => ({
    id: line.id,
    typeId: line.typeId,
    count: typedCount(line.count),
    unitPrice: line.price.trim() === '' ? null : Number(line.price),
  })),
});

/**
 * A NEW contract: each line with what it already received (0 where the column is not offered) and
 * the first delivery's day — `null` when nothing was received.
 */
export const createBodyOf = (form: EditorForm, mode: ReceivedMode): CreateFleetVehicleContract => {
  const body = contractBodyOf(form);
  const received = form.lines.map((line) => (mode === 'edit' ? typedCount(line.received) : 0));
  const any = received.some((n) => n > 0);
  return {
    ...body,
    lines: body.lines.map((line, index) => ({ ...line, received: received[index] ?? 0 })),
    receivedDate: any && form.receivedDate !== '' ? new Date(form.receivedDate) : null,
  };
};

/** An edit: the contract's own fields only — received cars change through «الاستلامات». */
export const updateBodyOf = (form: EditorForm, version: number): UpdateFleetVehicleContract => ({
  ...contractBodyOf(form),
  version,
});

// ── «تسجيل استلام» ───────────────────────────────────────────────────────────────────────────────

export interface DeliveryRow {
  line: FleetVehicleContractLineDto;
  /** Received on this line by the OTHER live deliveries. */
  received: number;
  /** Still owed on it, before this delivery. */
  left: number;
  /** What this delivery's box holds. */
  typed: number;
  /** More than is owed — the box turns rose and Save waits. */
  over: boolean;
}

export interface DeliveryFigures {
  rows: DeliveryRow[];
  contracted: number;
  /** Received by the other deliveries. */
  receivedBefore: number;
  leftBefore: number;
  /** Typed in this delivery. */
  comingNow: number;
  /** Received once this delivery is saved. */
  after: number;
  /** The rows over what is owed. */
  over: DeliveryRow[];
}

/**
 * The delivery dialog's table. On an edit (`editingId`), that delivery's own cars are given back
 * first — as the server checks it — so typing its old figure again is never «over».
 */
export const deliveryFigures = (
  contract: Pick<FleetVehicleContractDto, 'lines' | 'deliveries'>,
  typed: Readonly<Record<string, string>>,
  editingId: string | null,
): DeliveryFigures => {
  const editing = contract.deliveries.find((delivery) => delivery.id === editingId);
  const own = (lineId: string): number =>
    editing?.counts.find((entry) => entry.lineId === lineId)?.count ?? 0;
  const rows = contract.lines.map((line): DeliveryRow => {
    const received = line.received - own(line.id);
    const left = line.count - received;
    const now = typedCount(typed[line.id]);
    return { line, received, left, typed: now, over: now > left };
  });
  const contracted = rows.reduce((sum, row) => sum + row.line.count, 0);
  const receivedBefore = rows.reduce((sum, row) => sum + row.received, 0);
  const comingNow = rows.reduce((sum, row) => sum + row.typed, 0);
  return {
    rows,
    contracted,
    receivedBefore,
    leftBefore: contracted - receivedBefore,
    comingNow,
    after: receivedBefore + comingNow,
    over: rows.filter((row) => row.over),
  };
};

/** The boxes a delivery opens with: empty for a new one, its own counts for an edit. */
export const deliveryTyped = (
  contract: Pick<FleetVehicleContractDto, 'deliveries'>,
  editingId: string | null,
): Record<string, string> => {
  const editing = contract.deliveries.find((delivery) => delivery.id === editingId);
  return Object.fromEntries(
    (editing?.counts ?? []).map((entry) => [entry.lineId, String(entry.count)]),
  );
};

/** What Save sends: the lines that received a car, each once. */
export const deliveryCounts = (rows: readonly DeliveryRow[]): { lineId: string; count: number }[] =>
  rows.filter((row) => row.typed > 0).map((row) => ({ lineId: row.line.id, count: row.typed }));

/**
 * The delivery's place among the live ones once saved — what «رقم الاستلام» shows: by date, and
 * among deliveries of the same day by when each was written (a new one is written last).
 */
export const deliveryOrdinal = (
  contract: Pick<FleetVehicleContractDto, 'deliveries'>,
  dateYmd: string,
  editingId: string | null,
): number => {
  const editing = contract.deliveries.find((delivery) => delivery.id === editingId);
  const others = contract.deliveries.filter((delivery) => delivery.id !== editingId);
  const before = others.filter(
    (delivery) =>
      delivery.date < dateYmd ||
      (delivery.date === dateYmd &&
        (editing === undefined || delivery.createdAt < editing.createdAt)),
  );
  return before.length + 1;
};

// ── The attachments ─────────────────────────────────────────────────────────────────────────────

export const CONTRACT_FILE_ACCEPT = FLEET_VEHICLE_CONTRACT_FILE_MIMES.join(',');
const MAX_BYTES = FLEET_VEHICLE_CONTRACT_FILE_MAX_MB * 1024 * 1024;

/** A file the contract may take: an image or a PDF of the four types, 10 MB at most. */
export const acceptsContractFile = (file: { type: string; size: number }): boolean =>
  (FLEET_VEHICLE_CONTRACT_FILE_MIMES as readonly string[]).includes(file.type) &&
  file.size > 0 &&
  file.size <= MAX_BYTES;

export const isPdfMime = (mime: string): boolean => mime === 'application/pdf';

/**
 * «العقد كاملًا» + «PDF»: the name without its extension, and the extension apart — an Arabic name
 * followed by «.pdf» is reordered by the browser's bidi rules and reads wrong.
 */
export const splitFileName = (name: string): { base: string; ext: string } => {
  const dot = name.lastIndexOf('.');
  return dot <= 0
    ? { base: name, ext: '' }
    : { base: name.slice(0, dot), ext: name.slice(dot + 1) };
};

/** The list with the item at `from` moved to `to` — a drop, or a step with the arrows. */
export const moveItem = <T>(items: readonly T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
};
