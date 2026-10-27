// Duplicate seals and bag QRs — WARN, never block (S-7, DS-15; docs/12-planning/
// atm-settlements-phase1.md §6.8 "Duplicate rule").
//
// Every key is looked up company-wide, over all time, in BOTH fields — bag QRs and cassette seals —
// because the scanning field moves focus on by itself and a second scan of a bag QR can land in a
// seal field; a QR that matches a seal (or a seal a QR) is `crossKind`. Two bounded aggregations, one
// per field, return at most six newest occurrences per key and only five fields of each; the matched
// lines' serial, code and status are then read with a projection. A match whose branch is outside
// the calling page's read reach is reported as `{ outsideReach: true }` only — a duplicate must not
// reveal another branch's lines. Cancelled lines' values count, labelled by their status (GS-7).
import {
  type AtmBankCode,
  type AtmPlanLineStatus,
  type AtmSealDuplicateDto,
} from '@ecms/contracts';
import { type Types } from 'mongoose';
import { scopeSelector, type AuthContext } from '../../../../shared/types';
import { branchScopeBranches } from '../../shared/branch-scope';
import { AtmPlanLineModel, type AtmPlanLineDoc } from '../plans/plan-line.model';
import { AtmLinePreparationModel } from './line-preparation.model';

/** One captured field of a line whose duplicates are wanted. */
export interface SealField {
  lineId: string;
  field: 'bag' | 'seal';
  bag?: 1 | 2;
  slot?: number;
  key: string;
}

interface Occurrence {
  lineId: Types.ObjectId;
  branchId: Types.ObjectId;
  bankCode: AtmBankCode;
  replenishDate: string;
  createdAt: Date;
  field: 'bag' | 'seal';
  bag?: 1 | 2;
  slot?: number;
}

/** At most this many occurrences per key and field leave the database (§6.8). */
const TOP_N = 6;
/** At most this many matches per value are returned. */
const MATCHES_MAX = 5;

export const fieldKey = (f: Pick<SealField, 'lineId' | 'field' | 'bag' | 'slot'>): string =>
  f.field === 'bag' ? `${f.lineId}|bag:${String(f.bag)}` : `${f.lineId}|seal:${String(f.slot)}`;

const topOccurrences = async (
  field: 'bag' | 'seal',
  keys: readonly string[],
): Promise<Map<string, Occurrence[]>> => {
  const path = field === 'seal' ? 'seals.key' : 'bags.qrKey';
  const array = field === 'seal' ? '$seals' : '$bags';
  const position = field === 'seal' ? { slot: '$seals.slot' } : { bag: '$bags.bag' };
  const groups = await AtmLinePreparationModel.aggregate<{
    _id: string;
    top: Omit<Occurrence, 'field'>[];
  }>([
    { $match: { isDeleted: false, [path]: { $in: keys } } },
    { $unwind: array },
    { $match: { [path]: { $in: keys } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: `$${path}`,
        top: {
          $topN: {
            n: TOP_N,
            sortBy: { createdAt: -1 },
            output: {
              lineId: '$lineId',
              planId: '$planId',
              branchId: '$branchId',
              bankCode: '$bankCode',
              replenishDate: '$replenishDate',
              createdAt: '$createdAt',
              ...position,
            },
          },
        },
      },
    },
  ]).exec();
  return new Map(groups.map((g) => [g._id, g.top.map((o) => ({ ...o, field }))]));
};

/**
 * The duplicates of the given fields, by `fieldKey`. A field with no match is absent. `viewKey` is
 * the calling page's (`atmPreparation.view` or `atmControl.view`).
 */
export const findSealDuplicates = async (
  fields: readonly SealField[],
  ctx: AuthContext,
  viewKey: string,
): Promise<Map<string, AtmSealDuplicateDto>> => {
  const result = new Map<string, AtmSealDuplicateDto>();
  const keys = [...new Set(fields.map((f) => f.key))];
  if (keys.length === 0) return result;

  const [seals, bags] = await Promise.all([
    topOccurrences('seal', keys),
    topOccurrences('bag', keys),
  ]);
  const occurrencesOf = (key: string): Occurrence[] =>
    [...(seals.get(key) ?? []), ...(bags.get(key) ?? [])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  const lineIds = [
    ...new Set(keys.flatMap((key) => occurrencesOf(key).map((o) => String(o.lineId)))),
  ];
  const lines = await AtmPlanLineModel.find(
    { _id: { $in: lineIds } },
    { serial: 1, machineCode: 1, spareCode: 1, status: 1 },
  )
    .lean<Pick<AtmPlanLineDoc, '_id' | 'serial' | 'machineCode' | 'spareCode' | 'status'>[]>()
    .exec();
  const lineOf = new Map(lines.map((l) => [String(l._id), l]));
  const reach = branchScopeBranches(scopeSelector(ctx, viewKey));
  const inReach = (branchId: Types.ObjectId): boolean =>
    reach === 'all' || reach.includes(String(branchId));

  for (const f of fields) {
    const matches: AtmSealDuplicateDto['matches'] = [];
    let crossKind = false;
    // Inside the line: the same key on another field of this preparation, across kinds too.
    for (const other of fields) {
      if (other.lineId !== f.lineId || other.key !== f.key || fieldKey(other) === fieldKey(f)) {
        continue;
      }
      if (other.field !== f.field) crossKind = true;
      matches.push({
        sameLine: true,
        otherField:
          other.field === 'bag'
            ? { field: 'bag', ...(other.bag === undefined ? {} : { bag: other.bag }) }
            : { field: 'seal', ...(other.slot === undefined ? {} : { slot: other.slot }) },
      });
    }
    // Other lines, newest first.
    for (const o of occurrencesOf(f.key)) {
      if (String(o.lineId) === f.lineId) continue;
      if (o.field !== f.field) crossKind = true;
      if (!inReach(o.branchId)) {
        matches.push({ outsideReach: true });
        continue;
      }
      const line = lineOf.get(String(o.lineId));
      matches.push({
        replenishDate: o.replenishDate,
        bankCode: o.bankCode,
        serial: line?.serial ?? null,
        machineCode: line?.machineCode ?? null,
        spareCode: line?.spareCode ?? null,
        lineStatus: (line?.status ?? 'cancelled') as AtmPlanLineStatus,
        matchedField: o.field,
      });
    }
    if (matches.length === 0) continue;
    result.set(fieldKey(f), {
      field: f.field,
      ...(f.bag === undefined ? {} : { bag: f.bag }),
      ...(f.slot === undefined ? {} : { slot: f.slot }),
      matches: matches.slice(0, MATCHES_MAX),
      crossKind,
    });
  }
  return result;
};
