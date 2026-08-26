// Finding a driver in the pool, by whatever the reader happens to know about them.
//
// A dispatcher looking for somebody has one of several things in hand: the name as it is spoken,
// the code printed on the card, or the number from a paper list. Making them search by name alone
// means knowing which spelling the record uses before you can look it up — so the term is matched
// against EVERY identifier the driver's record already carries, and the caller does not have to
// say which kind of thing they typed.
//
// The fields come from the employee record the pool already loads to render each name; nothing
// here asks the server for anything new. When the reader lacks `employee.view` the record is
// absent and only the id is searchable — honest, and the same degradation the name itself makes.
//
// Pure on purpose: this is the half of the search that can be tested without a DOM, and the half
// that would otherwise be an untestable expression buried in a `.filter()` inside the page.

/** What the pool knows about one driver, flattened to the things worth searching. */
export interface DriverSearchRecord {
  employeeId: string;
  nameAr?: string | null;
  nameEn?: string | null;
  code?: string | null;
  employeeNumber?: string | null;
}

/**
 * Everything about a driver, as one lowercase string to search in.
 *
 * Joined with a space so a term cannot match across two fields by accident — without it,
 * `"عليHR"` would find a driver named «علي» whose code starts `HR`, which is a match nobody
 * meant. Nullish fields drop out rather than becoming the string "null".
 */
export const driverHaystack = (record: DriverSearchRecord): string =>
  [record.nameAr, record.nameEn, record.code, record.employeeNumber, record.employeeId]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join(' ')
    .toLowerCase();

/**
 * Does this driver answer to the term?
 *
 * Substring, not prefix: a code is often quoted from its tail («…125»), and a person is as often
 * found by their second name as their first. An empty term matches everyone — "no filter" and
 * "filter that excludes nobody" are the same answer, which is what lets the caller skip the
 * special case.
 */
export const matchesDriver = (record: DriverSearchRecord, term: string): boolean => {
  const needle = term.trim().toLowerCase();
  if (needle === '') return true;
  return driverHaystack(record).includes(needle);
};

/**
 * Filter a driver list by the term, using an index of what is known about each.
 *
 * The list keeps its order — the pool is the server's order, and re-sorting by relevance would
 * make the same driver sit somewhere different depending on what was typed. A driver missing
 * from the index is still searchable by id, so a record that has not loaded yet degrades to
 * "findable by id" rather than vanishing from the list mid-type.
 */
export const filterDrivers = <T extends { employeeId: string }>(
  drivers: readonly T[],
  index: ReadonlyMap<string, DriverSearchRecord>,
  term: string,
): T[] => {
  const needle = term.trim();
  if (needle === '') return [...drivers];
  return drivers.filter((driver) =>
    matchesDriver(index.get(driver.employeeId) ?? { employeeId: driver.employeeId }, needle),
  );
};
