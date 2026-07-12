// Navigation model. Modules contribute NavSections to their shell (e.g. RecruitmentLayout);
// the Sidebar renders them and hides any item whose `permission` the user lacks (UX only —
// the server still enforces, Software Architecture §6).
import { type ComponentType, type SVGProps } from 'react';

export interface NavItem {
  /** Absolute route path. */
  to: string;
  /** i18n key for the label. */
  labelKey: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** Permission required to see the item; omit for always-visible. */
  permission?: string;
  /** Exact-match active state (for index routes). */
  end?: boolean;
}

export interface NavSection {
  /** Optional i18n key for a section heading. */
  titleKey?: string;
  items: NavItem[];
}
