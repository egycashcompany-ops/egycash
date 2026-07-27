// Nav-children provider registry (RW16/OQ-2). A module may register a provider for one of its app
// routes; the provider returns the DYNAMIC children of that app — recruitment stages, for example
// — with their live counts.
//
// This is deliberately client-side. Stages are business data whose shape changes as an
// administrator adds an interview round or an evaluation phase; the Applications catalog stays
// the administrator's control over WHICH apps a user sees, which is a different question.
import { type LocalizedString } from '@ecms/contracts';

export interface NavChild {
  key: string;
  label: LocalizedString;
  route: string;
  count: number;
}

/** What a provider gives the sidebar: the parent's own badge plus its children. */
export interface NavChildren {
  /** Badge on the parent row itself; null renders no badge. */
  count: number | null;
  children: NavChild[];
}

/** A React hook — providers use the module's own queries, so counts share one cache. */
export type NavChildrenProvider = () => NavChildren;

const providers = new Map<string, NavChildrenProvider>();

/** Register (or replace) the provider for an app route, e.g. `/interviews`. */
export const registerNavChildrenProvider = (route: string, provider: NavChildrenProvider): void => {
  providers.set(route, provider);
};

export const navChildrenProviderFor = (route: string): NavChildrenProvider | undefined =>
  providers.get(route);

/** Test seam. */
export const resetNavChildrenProviders = (): void => providers.clear();
