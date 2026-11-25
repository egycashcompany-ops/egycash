// WHO A FOLDER MAY BE SHARED WITH (design §4.3): «مين من الشركة» — the company's people who sign
// in. A folder is shown to user ACCOUNTS, because showing is something that happens to a person
// signed in; an employee with no login has nobody to show it to.
//
// Read through the platform's user service, never through HR, and published as exactly the four
// facts of `CompliancePersonDto`. Nothing about a person is stored here but their account id.
//
//   • the PICKER — active employee accounts, for the text typed: a new share never names a
//     suspended account, a customer's portal login, or a system account;
//   • the NAMES — the people a page of folders lists, in one read, whatever their status now: a
//     person on a list whose account was suspended since still shows, marked as such.
import {
  ListUsersQuerySchema,
  type CompliancePersonDto,
  type ListCompliancePeopleQuery,
  type Paginated,
} from '@ecms/contracts';
import { userService, type UserDoc } from '../../../platform/users';
import { type ScopeSelector } from '../../../shared/types';

/** The people reads are company-wide: sharing is not limited to the responsible person's branch. */
const everywhere = (userId: string): ScopeSelector => ({
  scope: 'organization',
  userId,
  branchId: null,
  departmentId: null,
  sectionId: null,
});

const fullName = (first: string, last: string): string => `${first} ${last}`.trim();

export const toCompliancePerson = (user: UserDoc): CompliancePersonDto => ({
  userId: String(user._id),
  name: {
    ar: fullName(user.profile.firstName.ar, user.profile.lastName.ar),
    en: fullName(user.profile.firstName.en, user.profile.lastName.en),
  },
  username: user.username,
  isActive: user.status === 'active',
});

/** The user list takes at most this many ids a page; longer lists are read in pieces. */
const CHUNK = 100;

class CompliancePeopleService {
  /** The picker: one page of active employee accounts matching the text typed. */
  async picker(
    query: ListCompliancePeopleQuery,
    callerId: string,
  ): Promise<Paginated<CompliancePersonDto>> {
    const page = await userService.list(
      ListUsersQuerySchema.parse({
        page: query.page,
        pageSize: query.pageSize,
        status: 'active',
        kind: 'employee',
        ...(query.search === undefined || query.search === '' ? {} : { search: query.search }),
      }),
      everywhere(callerId),
    );
    return { items: page.items.map(toCompliancePerson), meta: page.meta };
  }

  /**
   * The people `userIds` name, by id, whatever their status. An id that names no account (one
   * deleted since) is absent, and the folder simply does not list it.
   */
  async byIds(
    userIds: readonly string[],
    callerId: string,
    filters: { activeEmployeesOnly?: boolean } = {},
  ): Promise<Map<string, CompliancePersonDto>> {
    const wanted = [...new Set(userIds)];
    const found = new Map<string, CompliancePersonDto>();
    for (let start = 0; start < wanted.length; start += CHUNK) {
      const slice = wanted.slice(start, start + CHUNK);
      const page = await userService.list(
        ListUsersQuerySchema.parse({
          page: 1,
          pageSize: CHUNK,
          ...(filters.activeEmployeesOnly === true ? { status: 'active', kind: 'employee' } : {}),
        }),
        everywhere(callerId),
        slice,
      );
      for (const user of page.items) found.set(String(user._id), toCompliancePerson(user));
    }
    return found;
  }
}

export const compliancePeopleService = new CompliancePeopleService();
