// The layout reads the settlements services share (docs/12-planning/atm-settlements-phase1.md §4.1,
// §4.2, §6.4): a machine's live layout, many machines' at once, and a machine's history. Lean and
// keyed by machine id; scope is the caller's concern (the machine is read through the scope match
// before its layout is).
import {
  type AtmCassetteLayoutStateDto,
  type AtmCassetteLayoutVersionDto,
  type AtmCassetteSlot,
} from '@ecms/contracts';
import { Types, type ClientSession } from 'mongoose';
import { AtmCassetteLayoutModel, type AtmCassetteLayoutDoc } from './cassette-layout.model';
import {
  AtmCassetteLayoutVersionModel,
  type AtmCassetteLayoutVersionDoc,
} from './cassette-layout-version.model';

const asId = (id: Types.ObjectId | string): Types.ObjectId =>
  typeof id === 'string' ? new Types.ObjectId(id) : id;

/** Machine id → its live layout. */
export const liveLayoutsByMachine = async (
  machineIds: readonly (Types.ObjectId | string)[],
  session?: ClientSession,
): Promise<Map<string, AtmCassetteLayoutDoc>> => {
  if (machineIds.length === 0) return new Map();
  const docs = await AtmCassetteLayoutModel.find({
    machineId: { $in: machineIds.map(asId) },
    isDeleted: false,
  })
    .session(session ?? null)
    .lean<AtmCassetteLayoutDoc[]>()
    .exec();
  return new Map(docs.map((doc) => [String(doc.machineId), doc]));
};

export const liveLayoutOf = async (
  machineId: Types.ObjectId | string,
  session?: ClientSession,
): Promise<AtmCassetteLayoutDoc | null> =>
  AtmCassetteLayoutModel.findOne({ machineId: asId(machineId), isDeleted: false })
    .session(session ?? null)
    .lean<AtmCassetteLayoutDoc>()
    .exec();

/** Every version of a machine's layout, newest first. */
export const layoutVersionsOf = async (
  machineId: Types.ObjectId | string,
): Promise<AtmCassetteLayoutVersionDoc[]> =>
  AtmCassetteLayoutVersionModel.find({ machineId: asId(machineId) })
    .sort({ revision: -1 })
    .lean<AtmCassetteLayoutVersionDoc[]>()
    .exec();

const plainSlots = (slots: readonly AtmCassetteSlot[]): AtmCassetteSlot[] =>
  slots.map((s) => ({
    slot: s.slot,
    kind: s.kind,
    denomination: s.denomination ?? null,
    currency: s.currency ?? null,
  }));

export const toLayoutStateDto = (doc: AtmCassetteLayoutDoc): AtmCassetteLayoutStateDto => ({
  version: doc.__v,
  revision: doc.revision,
  slots: plainSlots(doc.slots),
  typeLabel: doc.typeLabel,
  featuresLabel: doc.featuresLabel,
  hubLabel: doc.hubLabel,
  standardLoadId: doc.standardLoadId === null ? null : String(doc.standardLoadId),
  source: doc.source,
  changedByName: doc.changedByName,
  changedAt: new Date(doc.changedAt).toISOString(),
});

export const toLayoutVersionDto = (
  doc: AtmCassetteLayoutVersionDoc,
): AtmCassetteLayoutVersionDto => ({
  revision: doc.revision,
  slots: plainSlots(doc.slots),
  typeLabel: doc.typeLabel,
  featuresLabel: doc.featuresLabel,
  hubLabel: doc.hubLabel,
  standardLoadId: doc.standardLoadId === null ? null : String(doc.standardLoadId),
  source: doc.source,
  reason: doc.reason,
  changedByName: doc.changedByName,
  changedAt: new Date(doc.changedAt).toISOString(),
});

export { plainSlots };
