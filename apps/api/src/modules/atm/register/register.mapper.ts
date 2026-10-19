// Entry doc → DTO (spec §3.8, §5.4). Pure: everything the DTO needs that the document does not
// hold — the caller's secret visibility, the EGYCASH code of the branch, the setting's bank label,
// the linked master's live state — arrives in `RegisterEntryView`, resolved once per page by the
// service.
//
// The secret rule, in one place: K values (keys, receipt notes, handover notes) are returned only
// when `secretsVisible`, and paired with that flag so "hidden" and "empty" never look alike on the
// wire (the employee `…Visible` precedent). The combination is NEVER mapped — not even sealed;
// `safeCombinationSet` is the only trace of column AO in any DTO.
import {
  type AtmRegisterBranchCode,
  type AtmRegisterCassettesDto,
  type AtmRegisterEntryDto,
  type AtmRegisterImportIssueCode,
  type AtmRegisterKeysDto,
  type AtmRegisterMasterState,
} from '@ecms/contracts';
import { type AtmRegisterEntryDoc } from './register.model';

/** The live state of a linked master, as the page's one `atm_machines` read found it. */
export type AtmRegisterLinkedMasterState = 'active' | 'archived' | 'deleted' | 'missing';

export interface RegisterEntryView {
  secretsVisible: boolean;
  branchCode: AtmRegisterBranchCode | null;
  /** The setting's Operations label for the entry's bank (null when the entry has no bank). */
  settingOpsLabel: string | null;
  /** Only consulted when the entry carries a `machineId`. */
  linkedMasterState: AtmRegisterLinkedMasterState;
}

const KEY_FIELDS = [
  'supervisorCode',
  'supervisorCount',
  'safeDoorCount',
  'alanki',
  'combinationKeyCode',
  'combinationKeyCount',
  'cashUnitCode',
  'cashUnitCount',
] as const satisfies readonly (keyof AtmRegisterKeysDto)[];

const CASSETTE_FIELDS = [
  'withdrawalType',
  'withdrawalCount',
  'withdrawal1',
  'withdrawal2',
  'withdrawal3',
  'withdrawal4',
  'withdrawal5',
  'depositType',
  'depositCount',
  'collectionCount',
  'recycle200',
  'recycle100',
  'recycle50',
  'spareCount',
  'spare1',
  'spare2',
  'spare3',
  'spare4',
  'spare5',
] as const satisfies readonly (keyof AtmRegisterCassettesDto)[];

export const REGISTER_KEY_FIELDS: readonly (keyof AtmRegisterKeysDto)[] = KEY_FIELDS;
export const REGISTER_CASSETTE_FIELDS: readonly (keyof AtmRegisterCassettesDto)[] = CASSETTE_FIELDS;

/** A lean read of a row written without a sub-field (a raw insert) yields undefined — the DTO says null. */
const keysDto = (keys: Partial<AtmRegisterKeysDto> | undefined): AtmRegisterKeysDto =>
  Object.fromEntries(
    KEY_FIELDS.map((field) => [field, keys?.[field] ?? null]),
  ) as unknown as AtmRegisterKeysDto;

const cassettesDto = (
  cassettes: Partial<AtmRegisterCassettesDto> | undefined,
): AtmRegisterCassettesDto =>
  Object.fromEntries(
    CASSETTE_FIELDS.map((field) => [field, cassettes?.[field] ?? null]),
  ) as unknown as AtmRegisterCassettesDto;

/** `YYYY-MM-DD` of a UTC-midnight business date. */
export const registerDateString = (d: Date | null | undefined): string | null =>
  d === null || d === undefined ? null : d.toISOString().slice(0, 10);

/** DEC-24 / DEC-30: the master's state, `unlinked` for an OPEN entry with no master, else null. */
export const registerMasterState = (
  doc: Pick<AtmRegisterEntryDoc, 'machineId' | 'status'>,
  linked: AtmRegisterLinkedMasterState,
): AtmRegisterMasterState | null => {
  if (doc.machineId !== null && doc.machineId !== undefined) return linked;
  return doc.status === 'open' ? 'unlinked' : null;
};

export const toAtmRegisterEntryDto = (
  doc: AtmRegisterEntryDoc,
  view: RegisterEntryView,
): AtmRegisterEntryDto => {
  const secrets = view.secretsVisible;
  const machineId = doc.machineId ?? null;
  return {
    id: String(doc._id),
    branchId: doc.branchId === null || doc.branchId === undefined ? null : String(doc.branchId),
    branchCode: view.branchCode,
    area: doc.area ?? null,
    bankCode: doc.bankCode ?? null,
    opsBankLabel: doc.opsBankLabel ?? null,
    effectiveOpsBankLabel: doc.opsBankLabel ?? view.settingOpsLabel,
    machineCode: doc.machineCode ?? null,
    machineId: machineId === null ? null : String(machineId),
    masterState: registerMasterState({ machineId, status: doc.status }, view.linkedMasterState),
    name: doc.name ?? null,
    operationType: doc.operationType ?? null,
    vendor: doc.vendor ?? null,
    model: doc.model ?? null,
    serial: doc.serial ?? null,
    secretsVisible: secrets,
    keys: secrets ? keysDto(doc.keys) : null,
    cassettes: cassettesDto(doc.cassettes),
    openTime: doc.openTime ?? null,
    closeTime: doc.closeTime ?? null,
    accessHoursNotes: doc.accessHoursNotes ?? null,
    receiptNotes: secrets ? (doc.receiptNotes ?? null) : null,
    safeCombinationSet: doc.safeCombination !== null && doc.safeCombination !== undefined,
    locationPlusCode: doc.locationPlusCode ?? null,
    locationUrl: doc.locationUrl ?? null,
    hub: doc.hub ?? null,
    startDate: registerDateString(doc.startDate),
    endDate: registerDateString(doc.endDate),
    receivedByName: doc.receivedByName ?? null,
    handoverName: doc.handoverName ?? null,
    handoverNotes: secrets ? (doc.handoverNotes ?? null) : null,
    status: doc.status,
    source: doc.source,
    importRow: doc.importRow ?? null,
    importIssues: (doc.importIssues ?? []).map((issue) => ({
      code: issue.code as AtmRegisterImportIssueCode,
      column: issue.column ?? null,
      detail: issue.detail ?? null,
    })),
    version: doc.__v,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
};
