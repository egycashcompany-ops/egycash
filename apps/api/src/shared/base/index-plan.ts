// What a declared index is, as it will be sent to `createIndex` — shared by every index builder.
//
// `schema.indexes()` carries driver-side hints too — `background` above all, which modern mongo
// ignores and which would otherwise be stored as part of the definition a later rebuild is compared
// against. Forwarding a fixed, known set keeps a rebuild byte-identical to the first build, which is
// what makes building idempotent rather than conflict-prone. The set is every option a schema in
// this codebase declares; `sync-indexes.models.spec.ts` fails the day a schema declares one outside
// it, so an option can never be dropped silently.

export const FORWARDED_INDEX_OPTIONS = [
  'name',
  'unique',
  'partialFilterExpression',
  'sparse',
  'expireAfterSeconds',
] as const;

/** Options mongoose adds that are hints to the driver, not part of the index on the server. */
export const DRIVER_SIDE_INDEX_HINTS = ['background'] as const;

export interface IndexPlanEntry {
  keys: Record<string, unknown>;
  options: Record<string, unknown>;
  /** A unique index needs a duplicate check before it can be built. */
  unique: boolean;
}

/** Pure: what will actually be sent to `createIndex`, for one schema's declarations. */
export const indexBuildPlan = (
  declared: readonly (readonly [Record<string, unknown>, Record<string, unknown> | undefined])[],
): IndexPlanEntry[] =>
  declared.map(([keys, raw]) => {
    const options: Record<string, unknown> = {};
    for (const key of FORWARDED_INDEX_OPTIONS) {
      if (raw !== undefined && raw[key] !== undefined) options[key] = raw[key];
    }
    return { keys, options, unique: options['unique'] === true };
  });

/**
 * The name MongoDB gives an index nobody named: each key and its direction or type, joined by `_`
 * — `{ a: 1, b: -1 }` is `a_1_b_-1`, `{ code: 'text' }` is `code_text`. An unnamed declaration is
 * found on the server under exactly this name.
 */
export const defaultIndexName = (keys: Record<string, unknown>): string =>
  Object.entries(keys)
    .map(([field, kind]) => `${field}_${String(kind)}`)
    .join('_');

/** The name a declaration is built under and found by. */
export const indexNameOf = (entry: IndexPlanEntry): string =>
  typeof entry.options['name'] === 'string' ? entry.options['name'] : defaultIndexName(entry.keys);

/**
 * The key pattern as `listIndexes` returns it. A text index stores `_fts: 'text', _ftsx: 1` where
 * its text fields were and keeps the fields themselves in `weights`, so `{ title: 'text' }` reads
 * back as `{ _fts: 'text', _ftsx: 1 }`. Every other kind of key is stored as declared, in order.
 */
export const storedKeyPattern = (keys: Record<string, unknown>): Record<string, unknown> => {
  const stored: Record<string, unknown> = {};
  for (const [field, kind] of Object.entries(keys)) {
    if (kind === 'text') {
      stored['_fts'] = 'text';
      stored['_ftsx'] = 1;
    } else {
      stored[field] = kind;
    }
  }
  return stored;
};

/** The fields of a text index, sorted — what the server keeps as the keys of `weights`. */
export const textFieldsOf = (keys: Record<string, unknown>): string[] =>
  Object.entries(keys)
    .filter(([, kind]) => kind === 'text')
    .map(([field]) => field)
    .sort();
