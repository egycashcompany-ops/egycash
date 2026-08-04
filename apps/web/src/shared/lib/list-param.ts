// A multi-valued filter in the address bar.
//
// Same comma-separated shape the API takes (`listQuery` in the contracts), so what a recruiter sees
// in the URL is what the server receives, and a link with one value still means one value. Shared
// so every queue page encodes its filters identically — a page that invented its own separator
// would produce links the others cannot read.

/** Read a list filter out of the query string. Absent or empty means no filter. */
export const readList = (sp: URLSearchParams, key: string): string[] =>
  (sp.get(key) ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');

/** Write a list filter back, or `null` to drop the parameter entirely when nothing is selected. */
export const writeList = (values: readonly string[]): string | null =>
  values.length === 0 ? null : values.join(',');
