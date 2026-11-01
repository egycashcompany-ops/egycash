// «عقود توريد السيارات» — the figures the screens work out themselves, pure and React-free:
//   · the editor's line totals and the contract's total as they are typed — in piastres, so
//     22 × 4,700,000 never drifts;
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
  type FleetVehicleContractDto,
  type FleetVehicleContractLineDto,
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
}

export const editorTotals = (lines: readonly Pick<EditorLine, 'count' | 'price'>[]): EditorTotals =>
  lines.reduce<EditorTotals>(
    (sum, line) => {
      const total = editorLineTotal(line);
      return {
        total: (toPiastres(sum.total) + toPiastres(total ?? 0)) / 100,
        cars: sum.cars + typedCount(line.count),
        priced: sum.priced + (total === null ? 0 : 1),
      };
    },
    { total: 0, cars: 0, priced: 0 },
  );

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
