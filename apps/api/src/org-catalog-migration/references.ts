// Everything in the database that NAMES a department, found from the schemas rather than a list.
//
// A merge repoints every reference to the losing department at the surviving one, and getting that
// set wrong is the expensive mistake: a missed collection leaves rows pointing at a soft-deleted
// department, which is a person whose file says they work somewhere that no longer exists. There
// are two dozen collections carrying `departmentId` today and the number only goes up, so this
// walks the registered schemas instead of naming them — a model added next year is swept because
// it declares the field, not because somebody remembered to come back here.
//
// WHAT IT CANNOT SEE, and why that is handled as a refusal rather than a best effort: two
// collections carry org ids inside `Schema.Types.Mixed` — an announcement's audience and a
// notification rule's audience and filters. Mixed has no declared paths, so no schema walk can find
// the ids inside it. `mixedCarrierHits` reads those rows and looks for the id in the document
// itself; anything it finds stops the migration with the row named, because silently rewriting the
// audience of a message that was already sent is not a migration, and silently NOT rewriting a live
// notification rule leaves a rule that quietly matches nobody.
import { type Schema } from 'mongoose';

export interface RefPath {
  /** Dotted path, which is what MATCHES rows at any depth. */
  path: string;
  /**
   * How the id sits there, which decides the shape of the update that rewrites it.
   *
   *   `scalar`        — `$set {path: winner}`.
   *   `idArray`       — an array of ids: `$set {'path.$[e]': winner}` with a filter on the element.
   *   `documentArray` — an id inside an array of SUB-DOCUMENTS (an applicant's placement history,
   *                     a job offer's revisions). A dotted path matches these but cannot set one,
   *                     so the update goes through the positional form built from `arrayPath` and
   *                     `tailPath` below.
   */
  kind: 'scalar' | 'idArray' | 'documentArray';
  /** documentArray only: the array segment, e.g. `placementHistory`. */
  arrayPath?: string;
  /** documentArray only: the path within one element, e.g. `from.departmentId`. */
  tailPath?: string;
}

export interface ModelRef extends RefPath {
  modelName: string;
  collection: string;
}

/** A unique index that includes the path being rewritten — where a merge can collide. */
export interface UniqueIndexRisk {
  name: string;
  /** The index's other key fields. Two rows agreeing on all of them would collide after the swap. */
  otherKeys: string[];
}

const isDepartmentScalar = (path: string): boolean => path.split('.').pop() === 'departmentId';

const isDepartmentArray = (path: string): boolean =>
  /DepartmentIds$/.test(path.split('.').pop() ?? '');

/**
 * Every path in one schema that holds a department id, including inside sub-schemas.
 *
 * Mongoose flattens a plain nested object into dotted paths but keeps a sub-SCHEMA (an employee's
 * `employment` block) behind its own `paths` map, so both shapes have to be walked. The employee
 * file carries the id BOTH ways — `employment.departmentId` is the placement of record and
 * `departmentId` beside it is the denormalized copy the data scope filters on — and a merge that
 * repointed one and not the other would leave the two disagreeing about where somebody works.
 */
export const collectRefPaths = (schema: Schema, prefix = ''): RefPath[] => {
  const out: RefPath[] = [];
  for (const [name, type] of Object.entries(schema.paths)) {
    const path = prefix === '' ? name : `${prefix}.${name}`;
    const instance = (type as { instance?: string }).instance;
    const nested = (type as { schema?: Schema }).schema;
    if (nested !== undefined) {
      const inner = collectRefPaths(nested, path);
      if (instance !== 'Array') {
        out.push(...inner);
        continue;
      }
      // An array OF sub-documents. Each id under it is rewritten positionally, so the array
      // segment and the remainder within one element are recorded here rather than re-derived.
      for (const ref of inner) {
        out.push({
          path: ref.path,
          kind: 'documentArray',
          arrayPath: path,
          tailPath: ref.path.slice(path.length + 1),
        });
      }
      continue;
    }
    const caster = (type as { caster?: { instance?: string } }).caster;
    if (instance === 'ObjectId' && isDepartmentScalar(path)) {
      out.push({ path, kind: 'scalar' });
      continue;
    }
    if (instance === 'Array' && caster?.instance === 'ObjectId' && isDepartmentArray(path)) {
      out.push({ path, kind: 'idArray' });
    }
  }
  return out;
};

/**
 * The `$set` and `arrayFilters` that repoint one reference from `loser` to `winner`.
 *
 * WHY A SNAPSHOT IS REPOINTED TOO, and this is the judgement the whole function rests on. An
 * applicant's placement history and a job offer's revisions are immutable records of what was true
 * at a moment, and this codebase does not rewrite those. But a merge is not a change of fact — it
 * says two rows were always the SAME department, one of them entered twice. The snapshot keeps
 * meaning exactly what it meant; it stops naming a duplicate that no longer exists. Leaving it
 * would be the falsification: a record pointing at a retired row nobody can look up.
 *
 * Returns `null` for a shape this cannot express — a department id nested inside TWO arrays, which
 * nothing declares today. The caller turns that into a refusal naming the path, so an unwritable
 * shape stops the migration rather than being skipped in silence.
 */
export const repointUpdate = <T>(
  ref: RefPath,
  loser: T,
  winner: T,
): { set: Record<string, T>; arrayFilters?: Record<string, T>[] } | null => {
  if (ref.kind === 'scalar') return { set: { [ref.path]: winner } };
  if (ref.kind === 'idArray') {
    return { set: { [`${ref.path}.$[element]`]: winner }, arrayFilters: [{ element: loser }] };
  }
  const arrayPath = ref.arrayPath ?? '';
  const tailPath = ref.tailPath ?? '';
  if (arrayPath === '' || tailPath === '') return null;
  return {
    set: { [`${arrayPath}.$[element].${tailPath}`]: winner },
    arrayFilters: [{ [`element.${tailPath}`]: loser }],
  };
};

/** The same, across every registered model, as `(model, path)` pairs the sweep can execute. */
export const collectModelRefs = (
  models: Readonly<Record<string, { schema: Schema; collection: { collectionName: string } }>>,
): ModelRef[] => {
  const out: ModelRef[] = [];
  for (const [modelName, model] of Object.entries(models)) {
    for (const ref of collectRefPaths(model.schema)) {
      out.push({ ...ref, modelName, collection: model.collection.collectionName });
    }
  }
  return out.sort(
    (a, b) => a.collection.localeCompare(b.collection) || a.path.localeCompare(b.path),
  );
};

/**
 * Unique indexes on this schema whose key includes `path` — the ones a merge can violate.
 *
 * `department_applications` is the live example: `{departmentId, applicationId}` is unique among
 * the living, so if the losing department and the surviving one were both assigned the same
 * application, repointing produces two identical rows and the write fails halfway through. Knowing
 * that BEFORE writing is the difference between a refusal and a half-applied merge.
 */
export const uniqueIndexRisks = (schema: Schema, path: string): UniqueIndexRisk[] => {
  const risks: UniqueIndexRisk[] = [];
  for (const [keys, options] of schema.indexes()) {
    const spec = keys as Record<string, unknown>;
    const opts = (options ?? {}) as { unique?: boolean; name?: string };
    if (opts.unique !== true) continue;
    const fields = Object.keys(spec);
    if (!fields.includes(path)) continue;
    risks.push({
      name: opts.name ?? fields.join('_'),
      otherKeys: fields.filter((field) => field !== path),
    });
  }
  return risks;
};

/**
 * Collections whose org references hide inside `Schema.Types.Mixed`, with what each one is.
 *
 * Kept as data rather than as code because the only honest thing to do with them is REPORT them:
 * the two are not the same kind of record and the migration is not entitled to decide either.
 */
export const MIXED_ORG_CARRIERS: readonly { collection: string; why: string }[] = [
  {
    collection: 'hr_announcements',
    why: 'an announcement records who it WAS sent to; rewriting that changes a delivered message',
  },
  {
    collection: 'hr_notification_rules',
    why: 'a rule is live configuration; leaving a stale department in it makes the rule match nobody',
  },
];

/** Ids of documents in one collection whose stored JSON mentions any of these department ids. */
export const mixedCarrierHits = (
  documents: readonly Record<string, unknown>[],
  departmentIds: readonly string[],
): string[] => {
  if (departmentIds.length === 0) return [];
  const hits: string[] = [];
  for (const doc of documents) {
    const text = JSON.stringify(doc);
    if (departmentIds.some((id) => text.includes(id))) hits.push(String(doc._id));
  }
  return hits;
};
