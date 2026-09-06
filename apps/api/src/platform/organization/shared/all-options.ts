// Read a whole unit catalog as dropdown options, a page at a time.
//
// WHY IT IS A LOOP. `BaseRepository.list` clamps `pageSize` to `MAX_PAGE_SIZE` (100), so the single
// `pageSize: 500` read this replaces returned a hundred units and silently dropped the rest — no
// error, and nothing in the response to say the list had been cut. The job-title picker was already
// offering 100 of this deployment's 142 titles. A dropdown that omits a unit is worse than a slow
// one, because the reader cannot tell it is incomplete. Org catalogs are small; reading all of one
// is cheap.
//
// WHY IT IS ITS OWN FILE. `org-unit.ts` cannot be imported by a test: it runs at schema-definition
// time and sits inside the audit → users → department-repository cycle documented at the top of it.
// This file imports the contracts package and nothing else, so the paging can be checked directly —
// and both callers (`OrgUnitService` and the flat job-title catalog) share one implementation.
import { MAX_PAGE_SIZE, type LocalizedString, type OrgUnitOptionDto } from '@ecms/contracts';

/** The shape a page reader must return — `BaseRepository.list`'s, narrowed to what is read here. */
export interface OptionPage<T> {
  items: T[];
  meta: { totalPages: number };
}

/** The fields an option is built from. Anything with an id, a code and a bilingual name qualifies. */
export interface OptionSource {
  _id: unknown;
  code: string;
  name: LocalizedString;
}

/**
 * Every option the reader returns, in the order it returns them.
 *
 * `parentIdOf` gives the unit this one hangs under — a Department's Branch, a Section's Department —
 * so a caller can cascade one dropdown off another from a single fetch. Units that hang under
 * nothing (Branches, Job Titles) return null.
 */
export const collectOptions = async <T extends OptionSource>(
  readPage: (page: number, pageSize: number) => Promise<OptionPage<T>>,
  parentIdOf: (doc: T) => string | null,
): Promise<OrgUnitOptionDto[]> => {
  const out: OrgUnitOptionDto[] = [];
  for (let page = 1; ; page += 1) {
    const res = await readPage(page, MAX_PAGE_SIZE);
    for (const doc of res.items) {
      out.push({ id: String(doc._id), code: doc.code, name: doc.name, parentId: parentIdOf(doc) });
    }
    // Bounded by the reader's own count, so an empty catalog reads one page and a full one reads
    // exactly as many as it has. Never by "the page came back short" — a reader that returns a
    // partial page for any other reason would end the walk early and drop the tail.
    if (page >= res.meta.totalPages) return out;
  }
};
