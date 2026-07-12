// Recruitment navigation — the sidebar contribution for the recruitment module. Each item is
// gated by the same permission its backend endpoints require; the Sidebar hides items the user
// cannot access (UX only). Order mirrors the seven-stage pipeline (BD-008).
import { type NavSection } from '../../../platform/navigation/nav';
import {
  BadgeIcon,
  ChatIcon,
  ClipboardIcon,
  FileIcon,
  FolderIcon,
  HomeIcon,
  OfferIcon,
  UsersIcon,
} from '../../../shared/ui/icons';

export const recruitmentNav: NavSection[] = [
  {
    items: [{ to: '/', labelKey: 'recruitment.nav.overview', icon: HomeIcon, end: true }],
  },
  {
    titleKey: 'recruitment.nav.pipeline',
    items: [
      { to: '/applicants', labelKey: 'recruitment.nav.applicants', icon: UsersIcon, permission: 'applicant.view' },
      { to: '/screening', labelKey: 'recruitment.nav.screening', icon: ClipboardIcon, permission: 'screening.view' },
      { to: '/interviews', labelKey: 'recruitment.nav.interviews', icon: ChatIcon, permission: 'interview.view' },
      { to: '/job-offers', labelKey: 'recruitment.nav.offers', icon: OfferIcon, permission: 'jobOffer.view' },
    ],
  },
  {
    titleKey: 'recruitment.nav.hiring',
    items: [
      { to: '/employees', labelKey: 'recruitment.nav.employees', icon: BadgeIcon, permission: 'employee.view' },
      {
        to: '/hiring-documents',
        labelKey: 'recruitment.nav.hiringDocuments',
        icon: FileIcon,
        permission: 'hiringDocuments.view',
      },
      {
        to: '/employee-files',
        labelKey: 'recruitment.nav.employeeFiles',
        icon: FolderIcon,
        permission: 'employeeFile.view',
      },
    ],
  },
];
