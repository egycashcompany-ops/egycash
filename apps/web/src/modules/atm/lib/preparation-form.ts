// Preparation's capture form, pure (docs/12-planning/atm-settlements-phase1.md §9.3, §9.6, DS-13,
// DS-15, GS-32): the order the scanner walks the fields in, what a key press does, the local checks
// a scan runs at once, what is still missing, and how the local values survive a refetch and a 409.
//
// THE ORDER (GS-32). Per bag, its cassettes in slot order, then its QR: bag 1's seals → bag 1's QR
// → bag 2's seals → bag 2's QR. The bag is closed after its cassettes are in it, so its QR is the
// last thing scanned for it.
//
// A WEDGE SCANNER IS A KEYBOARD. It types the code and presses Enter — or Tab, on some scanners.
// Both move to the next field, and both are `preventDefault`ed, so Enter never submits the form
// (a half-scanned line would be saved) and Tab never leaves the form for the page around it.
//
// LOCAL VALUES ARE THE USER'S (UI-21). They are seeded once when a line opens; a refetch (every
// minute, or on a signal) never overwrites them while they hold unsaved changes; and after a 409
// they are re-applied onto the new version, a field the server ALSO changed meanwhile being marked
// for the user to choose — never silently decided either way.
import {
  bagNeedsQr,
  cleanScannedValue,
  scannedValueWarnings,
  sealKey,
  type AtmPreparationLineDto,
  type AtmScannedValueWarning,
  type SaveAtmPreparation,
} from '@ecms/contracts';

export { cleanScannedValue, sealKey };

export type CaptureField = { kind: 'seal'; bag: 1 | 2; slot: number } | { kind: 'qr'; bag: 1 | 2 };

/** A field's stable id: `seal:3`, `qr:1`. */
export type CaptureFieldId = `seal:${number}` | `qr:${1 | 2}`;

export const fieldId = (field: CaptureField): CaptureFieldId =>
  field.kind === 'seal' ? `seal:${field.slot}` : `qr:${field.bag}`;

/** The bags as the preparation lists them: each with its slot numbers. */
export type CaptureBags = readonly { bag: 1 | 2; slots: readonly number[] }[];

/** Per bag, its cassettes in slot order, then its QR (GS-32). */
export const fieldOrder = (bags: CaptureBags): CaptureField[] =>
  [...bags]
    .sort((a, b) => a.bag - b.bag)
    .flatMap((bag): CaptureField[] => [
      ...[...bag.slots]
        .sort((a, b) => a - b)
        .map((slot): CaptureField => ({ kind: 'seal', bag: bag.bag, slot })),
      { kind: 'qr', bag: bag.bag },
    ]);

/** The field after `current`; null past the last one — focus then moves to «حفظ». */
export const nextField = (
  order: readonly CaptureField[],
  current: CaptureFieldId,
): CaptureField | null => {
  const at = order.findIndex((f) => fieldId(f) === current);
  if (at === -1) return null;
  return order[at + 1] ?? null;
};

/**
 * What a key press in a seal or QR field does: Enter, or the Tab a scanner appends, → `'next'` (the
 * caller calls `preventDefault`, cleans the value, runs the local checks and moves on). Shift+Tab is
 * a person going back and is left to the browser, as is every other key.
 */
export const sealKeyAction = (event: { key: string; shiftKey?: boolean }): 'next' | 'none' => {
  if (event.key === 'Enter') return 'next';
  if (event.key === 'Tab' && event.shiftKey !== true) return 'next';
  return 'none';
};

/** The local values, by field id, as typed or scanned (the server cleans them again). */
export type CaptureValues = Readonly<Partial<Record<CaptureFieldId, string>>>;

export type LocalDuplicateCode = 'SEAL_REPEATED' | 'QR_REPEATED' | 'OTHER_FIELD';

export interface LocalDuplicate {
  field: CaptureFieldId;
  /**
   * `SEAL_REPEATED` «هذا السيلز مكرر في هذه الماكينة.» — a seal equal to another seal;
   * `QR_REPEATED` «هذا الـ QR مكرر.» — a QR equal to the other bag's QR;
   * `OTHER_FIELD` «هذه القيمة مسجلة في خانة أخرى من هذه الماكينة.» — a QR equal to a seal.
   */
  code: LocalDuplicateCode;
  others: CaptureFieldId[];
}

const kindOf = (id: CaptureFieldId): 'seal' | 'qr' => (id.startsWith('seal:') ? 'seal' : 'qr');

/**
 * Every field whose value repeats another field of this line, by `sealKey` — so Arabic-Indic and
 * ASCII digits, letter case, white space and a scanner's trailing CR all compare equal (DS-15). A
 * repeat of the same kind is named first; a QR against a seal is `OTHER_FIELD`. Warnings only.
 */
export const localDuplicates = (values: CaptureValues): LocalDuplicate[] => {
  const byKey = new Map<string, CaptureFieldId[]>();
  for (const [id, raw] of Object.entries(values) as [CaptureFieldId, string | undefined][]) {
    const value = cleanScannedValue(raw);
    if (value === null) continue;
    const key = sealKey(value);
    byKey.set(key, [...(byKey.get(key) ?? []), id]);
  }
  const out: LocalDuplicate[] = [];
  for (const ids of byKey.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      const others = ids.filter((o) => o !== id);
      const same = others.some((o) => kindOf(o) === kindOf(id));
      const code: LocalDuplicateCode = same
        ? kindOf(id) === 'seal'
          ? 'SEAL_REPEATED'
          : 'QR_REPEATED'
        : 'OTHER_FIELD';
      out.push({ field: id, code, others });
    }
  }
  return out;
};

/** `ARABIC_LETTERS` per field: the keyboard was on the Arabic layout when the scanner typed. */
export const localWarnings = (
  values: CaptureValues,
): { field: CaptureFieldId; code: AtmScannedValueWarning }[] =>
  (Object.entries(values) as [CaptureFieldId, string | undefined][]).flatMap(([id, raw]) => {
    const value = cleanScannedValue(raw);
    return value === null ? [] : scannedValueWarnings(value).map((code) => ({ field: id, code }));
  });

export type MissingCapture = { kind: 'seal'; slot: number } | { kind: 'qr'; bag: 1 | 2 };

/**
 * What «تم التجهيز» still waits for — the server's rule (DS-13): a seal for every bagged cassette
 * holding notes, and a QR for every bag unless all its cassettes hold 0 notes (`bagNeedsQr`). A
 * 0-note cassette's seal and an all-zero bag's QR are optional. Blank after cleaning is missing.
 */
export const requiredMissing = (
  prep: {
    bags: readonly { bag: 1 | 2; slots: readonly number[]; qr: string | null }[];
    seals: readonly { slot: number; value: string | null }[];
  },
  slots: readonly { slot: number; notes: number }[],
): MissingCapture[] => {
  const notesOf = (slot: number): number => slots.find((s) => s.slot === slot)?.notes ?? 0;
  const sealOf = (slot: number): string | null =>
    cleanScannedValue(prep.seals.find((s) => s.slot === slot)?.value ?? null);
  const missing: MissingCapture[] = [];
  for (const bag of [...prep.bags].sort((a, b) => a.bag - b.bag)) {
    for (const slot of [...bag.slots].sort((a, b) => a - b)) {
      if (notesOf(slot) > 0 && sealOf(slot) === null) missing.push({ kind: 'seal', slot });
    }
    if (bagNeedsQr(bag, slots) && cleanScannedValue(bag.qr) === null) {
      missing.push({ kind: 'qr', bag: bag.bag });
    }
  }
  return missing;
};

/** The server's values of a line, by field id ('' for a blank field). */
export const serverValues = (line: AtmPreparationLineDto): Record<CaptureFieldId, string> => {
  const values: Partial<Record<CaptureFieldId, string>> = {};
  for (const field of fieldOrder(line.preparation.bags)) {
    const id = fieldId(field);
    values[id] =
      field.kind === 'qr'
        ? (line.preparation.bags.find((b) => b.bag === field.bag)?.qr ?? '')
        : (line.preparation.seals.find((s) => s.slot === field.slot)?.value ?? '');
  }
  return values as Record<CaptureFieldId, string>;
};

/** One open line's form: the values it was seeded from, and the user's. */
export interface CaptureForm {
  lineId: string;
  /** The preparation version `base` came from — what a save carries. */
  version: number;
  /** The server's values when the form was seeded or last merged. */
  base: Readonly<Record<CaptureFieldId, string>>;
  /** The user's values. */
  values: Readonly<Record<CaptureFieldId, string>>;
  /** Fields the user changed AND the server changed meanwhile, to a different value: theirs to pick. */
  conflicts: readonly { field: CaptureFieldId; server: string }[];
}

/** True while the user holds a value the server has not seen. */
export const isDirty = (form: CaptureForm): boolean =>
  (Object.keys(form.values) as CaptureFieldId[]).some((id) => form.values[id] !== form.base[id]);

/**
 * The form for `line`: a fresh one when another line is opened (or none was), the CURRENT one when
 * it holds unsaved values — a refetch never overwrites them — and otherwise re-read from the
 * server, so a clean form shows what a colleague captured meanwhile.
 */
export const seedOnce = (current: CaptureForm | null, line: AtmPreparationLineDto): CaptureForm => {
  if (current !== null && current.lineId === line.lineId) {
    if (isDirty(current) || current.conflicts.length > 0) return current;
    if (current.version === line.preparation.version) return current;
  }
  const base = serverValues(line);
  return {
    lineId: line.lineId,
    version: line.preparation.version,
    base,
    values: base,
    conflicts: [],
  };
};

/** One field typed or scanned. */
export const setFieldValue = (
  form: CaptureForm,
  field: CaptureFieldId,
  value: string,
): CaptureForm => ({
  ...form,
  values: { ...form.values, [field]: value },
});

/**
 * After a 409: re-apply the user's changes onto the new version. A field the user did not touch
 * takes the server's new value; a field the user changed keeps the user's value; and where the
 * server changed it too, to something else, the field is listed in `conflicts` for the user.
 */
export const mergeAfterConflict = (
  local: CaptureForm,
  fresh: AtmPreparationLineDto,
): CaptureForm => {
  const server = serverValues(fresh);
  const values: Partial<Record<CaptureFieldId, string>> = {};
  const conflicts: { field: CaptureFieldId; server: string }[] = [];
  for (const id of Object.keys(server) as CaptureFieldId[]) {
    const mine = local.values[id];
    const theirs = server[id] ?? '';
    if (mine === undefined || mine === local.base[id]) {
      values[id] = theirs;
      continue;
    }
    values[id] = mine;
    if (theirs !== local.base[id] && theirs !== mine) conflicts.push({ field: id, server: theirs });
  }
  return {
    lineId: fresh.lineId,
    version: fresh.preparation.version,
    base: server,
    values: values as Record<CaptureFieldId, string>,
    conflicts,
  };
};

/** The user picks for a conflicted field: keep theirs, or take the server's value. */
export const resolveConflict = (
  form: CaptureForm,
  field: CaptureFieldId,
  choice: 'mine' | 'server',
): CaptureForm => {
  const conflict = form.conflicts.find((c) => c.field === field);
  if (conflict === undefined) return form;
  return {
    ...form,
    values: choice === 'server' ? { ...form.values, [field]: conflict.server } : form.values,
    conflicts: form.conflicts.filter((c) => c.field !== field),
  };
};

/** P3's body: every field, blank as null; the raw values — the server cleans them (§3.5). */
export const saveBodyOf = (form: CaptureForm, bags: CaptureBags): SaveAtmPreparation => {
  const blankAsNull = (value: string | undefined): string | null =>
    value === undefined || value.trim() === '' ? null : value;
  const order = fieldOrder(bags);
  return {
    version: form.version,
    bags: order
      .filter((f): f is Extract<CaptureField, { kind: 'qr' }> => f.kind === 'qr')
      .map((f) => ({ bag: f.bag, qr: blankAsNull(form.values[fieldId(f)]) })),
    seals: order
      .filter((f): f is Extract<CaptureField, { kind: 'seal' }> => f.kind === 'seal')
      .map((f) => ({ slot: f.slot, value: blankAsNull(form.values[fieldId(f)]) })),
  };
};
