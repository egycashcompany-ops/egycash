// Best-effort mapping from an Application/Category `icon` string to a shared glyph. The icon is a
// free-form field on the catalog entity, so unknown or empty names fall back to a neutral default —
// icons are presentation-only, the navigation content itself always comes from the API.
import { type ComponentType, type SVGProps } from 'react';
import {
  BadgeIcon,
  BuildingIcon,
  ChatIcon,
  ClipboardIcon,
  FileIcon,
  FolderIcon,
  HomeIcon,
  InboxIcon,
  LayersIcon,
  LinkIcon,
  OfferIcon,
  SitemapIcon,
  TagIcon,
  UsersIcon,
} from '../../shared/ui/icons';

export type NavIcon = ComponentType<SVGProps<SVGSVGElement>>;

const REGISTRY: Record<string, NavIcon> = {
  users: UsersIcon,
  building: BuildingIcon,
  branch: BuildingIcon,
  company: BuildingIcon,
  department: SitemapIcon,
  sitemap: SitemapIcon,
  section: LayersIcon,
  layers: LayersIcon,
  badge: BadgeIcon,
  position: BadgeIcon,
  tag: TagIcon,
  folder: FolderIcon,
  file: FileIcon,
  home: HomeIcon,
  clipboard: ClipboardIcon,
  chat: ChatIcon,
  offer: OfferIcon,
  inbox: InboxIcon,
  link: LinkIcon,
};

export const resolveNavIcon = (name: string | null | undefined, fallback: NavIcon): NavIcon => {
  if (name === null || name === undefined) return fallback;
  return REGISTRY[name.trim().toLowerCase()] ?? fallback;
};
