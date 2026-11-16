// «رفع جماعي» — the asset register's bulk upload, its rules kept pure so they are proved without a
// DOM (apps/web has none): what each decision and warning is called and how it is coloured, which
// lines are ticked and what «تحديد الكل» does, what the request carries, the chips that filter the
// preview, how a refusal is worded, and the template's one row.
//
// «في الأصول عايز زرار Bulk Upload للأصول بنفس شكل عهدة الأفرع ويكون فى Preview الأول للى هيتضاف ويوضح
// لو فى تكرار أو تضارب مع بيانات موجوده وهكذا» (the owner, 2026-11-16). The SERVER decides every line
// against the live register (`ItAssetImportRowDto.decision`) — this file only names what it decided
// and keeps the reviewer's ticks honest: a line the server calls unselectable can never be sent.
import {
  IT_ASSET_IMPORT_COLUMNS,
  IT_ASSET_IMPORT_DECISIONS,
  type ItAssetImportDecision,
  type ItAssetImportResultDto,
  type ItAssetImportRowDto,
  type ItAssetImportWarning,
  type Locale,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { type XlsxGridSheet } from '../../../shared/lib/xlsx-writer';
import { type Tone } from '../../../shared/ui/Badge';
import { SPEC_FIELDS } from './asset-specs';

type Translate = (key: string, params?: Record<string, string | number>) => string;

// ── What a line comes to: its words and its colour ──────────────────────────────────────────────

/**
 * A decision's tone. Green is the only line that adds a device; blue and brand change one that
 * exists; amber is a line to look at twice (left in another branch, a repeat, a kind with no
 * category); red is a line that cannot be written as it stands; grey is a line with nothing to do.
 */
export const IMPORT_DECISION_TONE: Readonly<Record<ItAssetImportDecision, Tone>> = {
  new: 'success',
  fill: 'info',
  move: 'brand',
  complete: 'neutral',
  heldElsewhere: 'warning',
  outOfScope: 'danger',
  duplicateInFile: 'warning',
  ambiguous: 'danger',
  noIdentifier: 'neutral',
  unknownKind: 'warning',
  invalid: 'danger',
};

/**
 * The four ways a `heldElsewhere` line is worded — each a key under `decision`/`decisionNoBranch`.
 * `heldElsewhere` itself is the decision's own name, said where nothing tells why the device stays
 * («في فرع X — لا يُنقل»); the others say why.
 */
export const HELD_ELSEWHERE_WORDINGS = [
  'heldElsewhere',
  'assignedElsewhere',
  'inMaintenanceElsewhere',
  'disposedElsewhere',
] as const;
export type HeldElsewhereWording = (typeof HELD_ELSEWHERE_WORDINGS)[number];

/**
 * Why a device found in another branch stays there, as its register line says it. `heldElsewhere`
 * is one decision for every device the upload leaves where it is, but «متسلَّم» is a claim about a
 * person, so only an `assigned` device is «متسلَّم في فرع X». A device kept by maintenance —
 * `underMaintenance`, or still `inStock` under an open maintenance order (the only way an in-stock
 * device of another branch is not moved; the API says 'an open maintenance order holds it') — is
 * «في الصيانة», and a disposed one is «مستبعَد», which is not a move refused but a device out of
 * service. A device the line does not name (no `asset`) gets the decision's own, neutral words
 * («في فرع X — لا يُنقل»): the server decided it is not moved, and nothing says why — so nothing
 * claims a holder it may not have.
 */
export const heldElsewhereWording = (
  row: Pick<ItAssetImportRowDto, 'asset'>,
): HeldElsewhereWording => {
  switch (row.asset?.status) {
    case 'assigned':
      return 'assignedElsewhere';
    case 'underMaintenance':
    case 'inStock':
      return 'inMaintenanceElsewhere';
    case 'disposed':
      return 'disposedElsewhere';
    default:
      return 'heldElsewhere';
  }
};

/**
 * The badge's words for one line — «نقل من فرع أكتوبر», «مكرر — الصف 14». The branch is named when
 * the screen knows it; a line whose branch or first row is missing still says what it is, without
 * the name, rather than a dash inside a sentence. A device left in another branch says why
 * (`heldElsewhereWording`).
 */
export const decisionLabel = (
  t: Translate,
  row: Pick<ItAssetImportRowDto, 'decision' | 'fromBranchId' | 'firstRow' | 'asset'>,
  branchName: (id: string) => string | undefined,
): string => {
  const { decision } = row;
  if (decision === 'move' || decision === 'heldElsewhere') {
    const key = decision === 'move' ? decision : heldElsewhereWording(row);
    const branch = row.fromBranchId === null ? undefined : branchName(row.fromBranchId);
    return branch === undefined || branch === ''
      ? t(`it.assets.import.decisionNoBranch.${key}`)
      : t(`it.assets.import.decision.${key}`, { branch });
  }
  if (decision === 'duplicateInFile') {
    return row.firstRow === null
      ? t('it.assets.import.decisionNoBranch.duplicateInFile')
      : t('it.assets.import.decision.duplicateInFile', { row: row.firstRow });
  }
  return t(`it.assets.import.decision.${decision}`);
};

/**
 * A count chip's name — the decision without its particulars («نقل», not «نقل من فرع X»). A chip
 * counts every line of its decision, so its words must be true of each: the `heldElsewhere` chip
 * counts devices held, kept by maintenance and disposed alike, and says only what they share —
 * «في فرع آخر — لا يُنقل», never «متسلَّم».
 */
export const decisionCountLabel = (t: Translate, decision: ItAssetImportDecision): string =>
  t(`it.assets.import.count.${decision}`);

/** A warning's words: «قريب من جهاز مسجَّل: AST-00031 — راجع الملصق». */
export const warningLabel = (
  t: Translate,
  warning: ItAssetImportWarning,
  row: Pick<ItAssetImportRowDto, 'near'>,
): string => {
  if (warning === 'nearSerial') {
    // `near` is filled only when the reader may see that device — the doubt is said either way.
    return row.near === null
      ? t('it.assets.import.warningNoCode.nearSerial')
      : t('it.assets.import.warning.nearSerial', { code: row.near.assetCode });
  }
  return t(`it.assets.import.warning.${warning}`);
};

// ── The fields a line fills, or keeps — in the asset screen's own words ─────────────────────────

const FIELD_LABELS: Readonly<Record<string, string>> = {
  name: 'it.assets.fields.name',
  categoryId: 'it.assets.fields.category',
  serialNumber: 'it.assets.fields.serialNumber',
  externalTag: 'it.assets.fields.externalTag',
  manufacturer: 'it.assets.fields.manufacturer',
  model: 'it.assets.fields.model',
  location: 'it.assets.fields.location',
  description: 'it.assets.fields.description',
  notes: 'it.assets.fields.notes',
  accessories: 'it.assets.fields.accessories',
  'specs.networkAdapters': 'it.assets.specs.networkAdapters',
  ...Object.fromEntries(SPEC_FIELDS.map(({ key, label }) => [`specs.${key}`, label])),
};

/** The label key of a field the server names (`specs.processor`, `model` …); null when unknown. */
export const importFieldLabelKey = (field: string): string | null => FIELD_LABELS[field] ?? null;

/** A field as the asset screen labels it — or as the server named it, when the screen has no label. */
export const importFieldLabel = (t: Translate, field: string): string => {
  const key = importFieldLabelKey(field);
  return key === null ? field : t(key);
};

/** The decisions that write something when the line is ticked (the selectable ones). */
const WRITING_DECISIONS: ReadonlySet<ItAssetImportDecision> = new Set<ItAssetImportDecision>([
  'new',
  'fill',
  'move',
  'heldElsewhere',
]);

/**
 * The fields «يُكمَّل» names on a line — only where something will be written. A line out of the
 * reader's reach may still carry the fields its device lacks (the plan found them before the
 * scope was judged), but nothing is written there, and «يُكمَّل» would promise a fill that never
 * comes. Nor on a line the server will not let through, whatever its decision.
 */
export const fillsShown = (
  row: Pick<ItAssetImportRowDto, 'decision' | 'fills' | 'selectable'>,
): readonly string[] => (row.selectable && WRITING_DECISIONS.has(row.decision) ? row.fills : []);

// ── The ticks ───────────────────────────────────────────────────────────────────────────────────
// Keyed by the sheet's row number — what the apply's `rows` names. A row the server calls
// unselectable is never ticked, whatever was clicked: the server would refuse the whole apply.

/** What the preview opens with: every selectable line the server ticked (`selected`). */
export const defaultSelection = (rows: readonly ItAssetImportRowDto[]): Set<number> =>
  new Set(rows.filter((row) => row.selectable && row.selected).map((row) => row.row));

/** One tick turned over — a line that cannot be written stays as it is. */
export const toggleRow = (
  selection: ReadonlySet<number>,
  row: Pick<ItAssetImportRowDto, 'row' | 'selectable'>,
): Set<number> => {
  const next = new Set(selection);
  if (!row.selectable) return next;
  if (next.has(row.row)) next.delete(row.row);
  else next.add(row.row);
  return next;
};

/** Every selectable line of `rows` ticked — false when there is none to tick. */
export const allTicked = (
  selection: ReadonlySet<number>,
  rows: readonly Pick<ItAssetImportRowDto, 'row' | 'selectable'>[],
): boolean => {
  const selectable = rows.filter((row) => row.selectable);
  return selectable.length > 0 && selectable.every((row) => selection.has(row.row));
};

/**
 * «تحديد الكل / إلغاء» over the lines in view (the chip's, or all of them): ticks every selectable
 * one — a line with a warning included, since asking for all is asking for it — or, when they are
 * all ticked already, unticks them. Lines out of view keep their ticks.
 */
export const toggleAll = (
  selection: ReadonlySet<number>,
  rows: readonly Pick<ItAssetImportRowDto, 'row' | 'selectable'>[],
): Set<number> => {
  const next = new Set(selection);
  const selectable = rows.filter((row) => row.selectable);
  const clear = allTicked(selection, rows);
  for (const row of selectable) {
    if (clear) next.delete(row.row);
    else next.add(row.row);
  }
  return next;
};

/** The apply's `rows`: the ticked lines that may be written, in the sheet's order. */
export const keptRows = (
  selection: ReadonlySet<number>,
  rows: readonly Pick<ItAssetImportRowDto, 'row' | 'selectable'>[],
): number[] =>
  rows
    .filter((row) => row.selectable && selection.has(row.row))
    .map((row) => row.row)
    .sort((a, b) => a - b);

const sameWarnings = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/**
 * The ticks after the SAME file is previewed again — another branch, a kind's category, or the
 * register changing under an apply (409). A line the reviewer already judged keeps their tick while
 * it still means the same thing (the same decision, the same device, the same doubts); any line
 * whose meaning changed opens with the server's default, so nothing new is ticked unseen.
 */
export const carrySelection = (
  previous: {
    rows: readonly ItAssetImportRowDto[];
    selection: ReadonlySet<number>;
  } | null,
  next: readonly ItAssetImportRowDto[],
): Set<number> => {
  if (previous === null) return defaultSelection(next);
  const before = new Map(previous.rows.map((row) => [row.row, row]));
  const out = new Set<number>();
  for (const row of next) {
    if (!row.selectable) continue;
    const old = before.get(row.row);
    const same =
      old !== undefined &&
      old.selectable &&
      old.decision === row.decision &&
      (old.asset?.id ?? null) === (row.asset?.id ?? null) &&
      sameWarnings(old.warnings, row.warnings);
    if (same ? previous.selection.has(row.row) : row.selected) out.add(row.row);
  }
  return out;
};

// ── The chips: the counts, and the filter they are ─────────────────────────────────────────────

/** The decisions the file holds, in the catalogue's order, each with its count — none at zero. */
export const decisionChips = (
  counts: Readonly<Partial<Record<ItAssetImportDecision, number>>>,
): { decision: ItAssetImportDecision; count: number }[] =>
  IT_ASSET_IMPORT_DECISIONS.flatMap((decision) => {
    const count = counts[decision] ?? 0;
    return count > 0 ? [{ decision, count }] : [];
  });

/** A chip pressed: its decision, or none when it was the one already pressed. */
export const toggleChip = (
  current: ItAssetImportDecision | null,
  pressed: ItAssetImportDecision,
): ItAssetImportDecision | null => (current === pressed ? null : pressed);

/** The lines a chip shows — every line when none is pressed. */
export const rowsInView = <T extends Pick<ItAssetImportRowDto, 'decision'>>(
  rows: readonly T[],
  decision: ItAssetImportDecision | null,
): T[] => (decision === null ? [...rows] : rows.filter((row) => row.decision === decision));

// ── The request ─────────────────────────────────────────────────────────────────────────────────

/** What the apply adds to a preview's fields: the lines kept and the preview's two hashes. */
export interface AssetImportApply {
  fileSha256: string;
  planHash: string;
  rows: readonly number[];
}

export interface AssetImportRequest {
  /** The branch chosen on the screen; null on a first preview — the sheet's name suggests it. */
  branchId: string | null;
  /** The categories the reviewer chose for a kind — the server matches the others itself. */
  kindCategories: Readonly<Record<string, string>>;
  apply?: AssetImportApply;
}

/**
 * The multipart text fields, in order (`ItAssetImportFieldsSchema`): the file goes beside them. The
 * kinds are written in a fixed order, so the same choice is the same request; an empty choice is no
 * field at all. Without `apply` it is a preview and says nothing of applying.
 */
export const assetImportFields = (request: AssetImportRequest): [string, string][] => {
  const fields: [string, string][] = [];
  if (request.branchId !== null && request.branchId !== '') {
    fields.push(['branchId', request.branchId]);
  }
  const kinds = Object.entries(request.kindCategories)
    .filter(([kind, categoryId]) => kind.trim() !== '' && categoryId !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (kinds.length > 0) fields.push(['kindCategories', JSON.stringify(Object.fromEntries(kinds))]);
  if (request.apply !== undefined) {
    fields.push(
      ['apply', 'true'],
      ['fileSha256', request.apply.fileSha256],
      ['planHash', request.apply.planHash],
      ['rows', JSON.stringify([...request.apply.rows])],
    );
  }
  return fields;
};

/** A kind's category picked on the screen — '' hands the kind back to the server's own match. */
export const withKindCategory = (
  chosen: Readonly<Record<string, string>>,
  kind: string,
  categoryId: string,
): Record<string, string> => {
  const next = { ...chosen };
  if (categoryId === '') delete next[kind];
  else next[kind] = categoryId;
  return next;
};

// ── The branch the plan is for ──────────────────────────────────────────────────────────────────
// The apply writes to the branch the preview on screen was PLANNED for (`preview.branchId`) — so
// the select must never show another choice over that plan, and step 2 says which branch it is.

/**
 * What a change of the branch select sends once a preview is on the screen — null when it sends
 * nothing: no preview yet (the next «معاينة» takes the select as it stands), or the plan on screen
 * is already that branch's.
 *
 * «من اسم الورقة» is a request too. Left over another branch's preview it showed one thing while
 * «تأكيد» wrote to the branch planned before; it previews the same file again with NO branch, and
 * the server suggests one from the sheet's name again (or asks for one — and the select goes back
 * to the plan on screen).
 */
export const branchChangeRequest = (
  chosen: string,
  onScreen: { branchId: string; kindCategories: Readonly<Record<string, string>> } | null,
): Omit<AssetImportRequest, 'apply'> | null => {
  if (onScreen === null) return null;
  if (chosen === '') return { branchId: null, kindCategories: onScreen.kindCategories };
  if (chosen === onScreen.branchId) return null;
  return { branchId: chosen, kindCategories: onScreen.kindCategories };
};

/**
 * Step 2's words for the branch the plan is for — «المعاينة لفرع الشيخ زايد» — whatever the select
 * above shows; a branch the screen cannot name yet is still said to be the one chosen.
 */
export const plannedBranchLabel = (
  t: Translate,
  branchId: string,
  branchName: (id: string) => string | undefined,
): string => {
  const name = branchName(branchId);
  return name === undefined || name === ''
    ? t('it.assets.import.planForUnnamed')
    : t('it.assets.import.planFor', { branch: name });
};

// ── A refusal, in the reader's words ────────────────────────────────────────────────────────────

/** The register changed between the preview and the apply — the preview is read again. */
export const isRegisterChanged = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 409;

/**
 * What the screen says when the upload is refused. The server's sentences are English, as every
 * API message is, so the lead line is the screen's own and the server's sentence follows it as a
 * detail where it names something the reader can fix (the header it missed, the cap it passed).
 */
export const importErrorText = (
  error: unknown,
  t: Translate,
  locale: Locale,
  limits: { maxRows: number; maxMb: number },
): { text: string; detail: string | null } => {
  if (!(error instanceof ApiError)) return { text: errorMessage(error, locale), detail: null };
  if (error.status === 409) return { text: t('it.assets.import.error.changed'), detail: null };
  if (error.status === 403) return { text: t('it.assets.import.error.forbidden'), detail: null };
  const details = error.details ?? [];
  // The reader's own caps (a part past its inflated size, too many zip entries, the read's
  // deadline) — `SHEET_TOO_LARGE`, apart from multer's: a 1 MB file whose sheet unpacks past one
  // branch's page is not «larger than 5 MB», and saying so sends the reader to shrink the wrong
  // thing. What it names (the part, 'entries', 'time') is the server's, not the reader's to fix.
  if (details.some((d) => d.field === 'file' && d.code === 'SHEET_TOO_LARGE')) {
    return {
      text: t('it.assets.import.error.sheetTooLarge', { rows: limits.maxRows }),
      detail: null,
    };
  }
  // The upload's cap: multer's refusal names the file part (`TOO_LARGE`), a proxy's is a 413.
  if (
    error.status === 413 ||
    error.code === 'FILE_TOO_LARGE' ||
    details.some((d) => d.field === 'file' && d.code === 'TOO_LARGE')
  ) {
    return { text: t('it.assets.import.error.tooLarge', { mb: limits.maxMb }), detail: null };
  }
  if (error.status === 422) {
    const detail = error.message === '' ? null : error.message;
    // A first preview whose sheet's name points to no branch: «الفرع بيتختار من الشاشة».
    if (details.some((d) => d.field === 'branchId') || /choose the branch/i.test(error.message)) {
      return { text: t('it.assets.import.error.chooseBranch'), detail: null };
    }
    // A kind filed under a category that is no longer an active one — the detail names the kind.
    if (/categor/i.test(error.message)) {
      return { text: t('it.assets.import.error.category'), detail };
    }
    // The sheet itself: not an .xlsx, its header off, more lines than a branch's page holds.
    return { text: t('it.assets.import.error.unreadable', { rows: limits.maxRows }), detail };
  }
  return { text: errorMessage(error, locale), detail: null };
};

// ── The result ──────────────────────────────────────────────────────────────────────────────────

export const IMPORT_RESULT_COUNTS = ['created', 'filled', 'moved', 'unchanged'] as const;
export type ImportResultCount = (typeof IMPORT_RESULT_COUNTS)[number];

/** What the apply did, in a fixed order, without the zeros. */
export const resultEntries = (
  result: Pick<ItAssetImportResultDto, ImportResultCount>,
): { key: ImportResultCount; count: number }[] =>
  IMPORT_RESULT_COUNTS.flatMap((key) => (result[key] > 0 ? [{ key, count: result[key] }] : []));

// ── The template: the header row and nothing else ───────────────────────────────────────────────

/**
 * The sheet's name, as the branches' custody sheets are named — «عهدة فرع X» — so a template taken
 * with a branch chosen comes back with that branch suggested. Not prose: it is the convention the
 * server reads the branch from, so it is the same in either language.
 */
const SHEET_PREFIX = 'عهدة فرع';

export const templateSheetName = (branchName: string | null): string =>
  branchName === null || branchName.trim() === ''
    ? SHEET_PREFIX
    : `${SHEET_PREFIX} ${branchName.trim()}`;

/**
 * «تحميل النموذج»: one sheet whose row 1 is `IT_ASSET_IMPORT_COLUMNS` in A..L, word for word — the
 * header the server compares — and M left empty (the accessories' second column, unlabelled in the
 * branches' sheets). No «م» column, which the register exports put first: the reader compares A1.
 */
export const assetImportTemplate = (sheet: string): XlsxGridSheet => ({
  kind: 'grid',
  name: sheet,
  rightToLeft: true,
  font: 'tahoma10',
  columns: Array.from({ length: IT_ASSET_IMPORT_COLUMNS.length + 1 }, (_, i) => ({
    index: i + 1,
    width: i === 1 ? 30 : 22,
  })),
  merges: [],
  cells: IT_ASSET_IMPORT_COLUMNS.map((label, i) => ({
    row: 1,
    col: i + 1,
    value: label,
    style: 'head' as const,
  })),
});

/** The template's file name: what it is, without a date — it is a form, not a register taken. */
export const templateFileName = (stem: string): string => `${stem}.xlsx`;
