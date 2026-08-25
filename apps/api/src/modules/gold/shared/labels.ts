// Display-name resolution for a whole page at once.
//
// Every gold list shows the owner, the branch, the vault code and the drawer number next to the
// row. Resolving those one row at a time is how a twelve-row page becomes fifty queries, so each
// controller builds the bag once here and hands it to the mapper (the IT-6 batch-lookup rule).
import { Types } from 'mongoose';
import { goldCompanyRepository } from '../companies/company.repository';
import { goldRepresentativeRepository } from '../representatives/representative.repository';
import { GoldRepresentativeModel } from '../representatives/representative.model';
import { GoldVaultModel } from '../vaults/vault.model';
import { GoldDrawerModel } from '../vaults/drawer.model';
import { type GoldLabels } from '../gold.mappers';
import { branchNames } from './ecms-refs';

/**
 * The distinct, USABLE ids in a column of a page.
 *
 * Two filters, and both earn their place. Null and undefined are dropped because `String(null)` is
 * the four-letter string `"null"` — every lookup below queries by `_id`, and Mongoose answers a
 * non-ObjectId `_id` with a CastError, which is an unhandled throw and a 500 for the whole page.
 * Anything else that is not an ObjectId is dropped for the same reason: a row pointing at a
 * malformed id has no name to show, and a blank cell is the right answer to that, not an error.
 */
const ids = (values: readonly (string | Types.ObjectId | null | undefined)[]): string[] => [
  ...new Set(
    values
      .filter((v): v is string | Types.ObjectId => v !== null && v !== undefined)
      .map(String)
      .filter((v) => Types.ObjectId.isValid(v)),
  ),
];

const vaultCodes = async (
  values: readonly (string | Types.ObjectId | null | undefined)[],
): Promise<Map<string, string>> => {
  const list = ids(values);
  if (list.length === 0) return new Map();
  const docs = await GoldVaultModel.find({ _id: { $in: list } })
    .select('code')
    .lean<{ _id: Types.ObjectId; code: string }[]>()
    .exec();
  return new Map(docs.map((d) => [String(d._id), d.code]));
};

const vaultLabels = async (
  values: readonly (string | Types.ObjectId | null | undefined)[],
): Promise<Map<string, string>> => {
  const list = ids(values);
  if (list.length === 0) return new Map();
  const docs = await GoldVaultModel.find({ _id: { $in: list } })
    .select('name')
    .lean<{ _id: Types.ObjectId; name: string }[]>()
    .exec();
  return new Map(docs.map((d) => [String(d._id), d.name]));
};

const drawerNumbers = async (
  values: readonly (string | Types.ObjectId | null | undefined)[],
): Promise<Map<string, number>> => {
  const list = ids(values);
  if (list.length === 0) return new Map();
  const docs = await GoldDrawerModel.find({ _id: { $in: list } })
    .select('number')
    .lean<{ _id: Types.ObjectId; number: number }[]>()
    .exec();
  return new Map(docs.map((d) => [String(d._id), d.number]));
};

/**
 * Drawer number AND label for a page of rows, in one query.
 *
 * The keys register prints the drawer's label on the handover slip, which `drawerNumbers` does not
 * select — resolving it per row is what turns a page into 2N lookups.
 */
export const drawerCells = async (
  values: readonly (string | Types.ObjectId | null | undefined)[],
): Promise<Map<string, { number: number; label: string }>> => {
  const list = ids(values);
  if (list.length === 0) return new Map();
  const docs = await GoldDrawerModel.find({ _id: { $in: list } })
    .select('number label')
    .lean<{ _id: Types.ObjectId; number: number; label: string }[]>()
    .exec();
  return new Map(docs.map((d) => [String(d._id), { number: d.number, label: d.label }]));
};

/** Holder phone + national id for a page of rows, in one query — the handover slip carries both. */
export const representativeContacts = async (
  values: readonly (string | Types.ObjectId | null | undefined)[],
): Promise<Map<string, { phone: string | null; nationalId: string | null }>> => {
  const list = ids(values);
  if (list.length === 0) return new Map();
  const docs = await GoldRepresentativeModel.find({ _id: { $in: list } })
    .select('phone nationalId')
    .lean<{ _id: Types.ObjectId; phone: string | null; nationalId: string | null }[]>()
    .exec();
  return new Map(
    docs.map((d) => [String(d._id), { phone: d.phone ?? null, nationalId: d.nationalId ?? null }]),
  );
};

export interface LabelRequest {
  companyIds?: readonly (string | Types.ObjectId | null | undefined)[];
  representativeIds?: readonly (string | Types.ObjectId | null | undefined)[];
  /** Vault ids rendered as their CODE (bars, receipt lines). */
  vaultCodeIds?: readonly (string | Types.ObjectId | null | undefined)[];
  /** Vault ids rendered as their NAME (the keys register). */
  vaultNameIds?: readonly (string | Types.ObjectId | null | undefined)[];
  drawerIds?: readonly (string | Types.ObjectId | null | undefined)[];
  /** Branch names are always read as a whole small set, so this is a flag, not a list. */
  branches?: boolean;
}

export const resolveGoldLabels = async (request: LabelRequest): Promise<GoldLabels> => {
  const [companies, representatives, codes, names, numbers, branches] = await Promise.all([
    goldCompanyRepository.namesOf(ids(request.companyIds ?? [])),
    goldRepresentativeRepository.namesOf(ids(request.representativeIds ?? [])),
    vaultCodes(request.vaultCodeIds ?? []),
    vaultLabels(request.vaultNameIds ?? []),
    drawerNumbers(request.drawerIds ?? []),
    request.branches === true ? branchNames() : Promise.resolve(new Map<string, string>()),
  ]);
  // A vault rendered by code and a vault rendered by name never appear on the same screen, so one
  // `vaults` map serves both; whichever the caller asked for is what it holds.
  return {
    companies,
    representatives,
    vaults: codes.size > 0 ? codes : names,
    drawerNumbers: numbers,
    branches,
  };
};
