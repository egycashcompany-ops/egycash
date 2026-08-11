// Best-effort mapping from an Application/Category `icon` string to a shared glyph. The icon is a
// free-form field on the catalog entity, so unknown or empty names fall back to a neutral default —
// icons are presentation-only, the navigation content itself always comes from the API.
import { type ComponentType, type SVGProps } from 'react';
import {
  AlertIcon,
  BadgeIcon,
  BellIcon,
  BriefcaseIcon,
  BuildingIcon,
  CalendarIcon,
  ChatIcon,
  ClipboardIcon,
  CogIcon,
  FileIcon,
  FolderIcon,
  GaugeIcon,
  HomeIcon,
  InboxIcon,
  LayersIcon,
  LinkIcon,
  MonitorIcon,
  OfferIcon,
  QrIcon,
  ShieldIcon,
  SitemapIcon,
  TagIcon,
  TruckIcon,
  UsersIcon,
  WrenchIcon,
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
  // Fleet (FW-1) — plus names the seed already used that previously fell back.
  truck: TruckIcon,
  vehicle: TruckIcon,
  gauge: GaugeIcon,
  wrench: WrenchIcon,
  calendar: CalendarIcon,
  cog: CogIcon,
  settings: CogIcon,
  alert: AlertIcon,
  shield: ShieldIcon,
  // Department (category) tiles — categories resolve through this same registry.
  briefcase: BriefcaseIcon,
  monitor: MonitorIcon,
  // IT (ITW-1) — the scan surface; `monitor` and `folder` above already cover its other rows.
  qr: QrIcon,
  // P10 — the notification-templates row. Registered with the row that uses it: an unregistered
  // name falls back silently, which looks like a design choice rather than a missing entry.
  bell: BellIcon,
};

export const resolveNavIcon = (name: string | null | undefined, fallback: NavIcon): NavIcon => {
  if (name === null || name === undefined) return fallback;
  return REGISTRY[name.trim().toLowerCase()] ?? fallback;
};
