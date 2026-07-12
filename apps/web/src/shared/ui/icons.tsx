// Inline SVG icon set (dependency-free, currentColor, stroke-based). Directional icons flip
// under RTL via the `rtl:-scale-x-100` utility. Default size is 1.25rem; pass className to resize.
import { type SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const Base = ({ className, children, ...props }: IconProps): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className ?? 'h-5 w-5'}
    {...props}
  >
    {children}
  </svg>
);

export const MenuIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </Base>
);

export const CloseIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </Base>
);

export const SunIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Base>
);

export const MoonIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Base>
);

export const MonitorIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </Base>
);

export const BellIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </Base>
);

export const SearchIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </Base>
);

export const GlobeIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20" />
  </Base>
);

export const LogOutIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </Base>
);

export const UserIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Base>
);

export const ChevronIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <polyline points="6 9 12 15 18 9" />
  </Base>
);

/** Points toward the reading direction's end (flips under RTL). */
export const ChevronEndIcon = ({ className, ...p }: IconProps): JSX.Element => (
  <Base className={className ?? 'h-4 w-4 rtl:-scale-x-100'} {...p}>
    <polyline points="9 18 15 12 9 6" />
  </Base>
);

/** Points toward the reading direction's start (flips under RTL). */
export const ChevronStartIcon = ({ className, ...p }: IconProps): JSX.Element => (
  <Base className={className ?? 'h-4 w-4 rtl:-scale-x-100'} {...p}>
    <polyline points="15 18 9 12 15 6" />
  </Base>
);

export const UsersIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </Base>
);

export const ClipboardIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M9 2h6a1 1 0 0 1 1 1v1H8V3a1 1 0 0 1 1-1z" />
    <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
    <path d="m9 14 2 2 4-4" />
  </Base>
);

export const ChatIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </Base>
);

export const OfferIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M4 4h16v4H4z" />
    <path d="M4 8v12h16V8M9 12h6M9 16h6" />
  </Base>
);

export const BadgeIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5z" />
    <path d="m9 12 2 2 4-4" />
  </Base>
);

export const FolderIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Base>
);

export const FileIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M9 13h6M9 17h6" />
  </Base>
);

export const HomeIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </Base>
);

export const UploadIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M17 8l-5-5-5 5M12 3v12" />
  </Base>
);

export const AlertIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </Base>
);

export const InboxIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.5 5.5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.5A2 2 0 0 0 16.8 5H7.2a2 2 0 0 0-1.7.5z" />
  </Base>
);

export const CheckIcon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <polyline points="20 6 9 17 4 12" />
  </Base>
);
