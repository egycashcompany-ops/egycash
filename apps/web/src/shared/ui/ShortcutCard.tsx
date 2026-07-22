// Navigation shortcut card for module home pages: an icon tile, a title with a reveal-on-hover
// chevron, and a short description. RTL-safe and keyboard-focusable. Extracted so every module
// home renders identical shortcuts.
import { type ComponentType, type SVGProps } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardBody } from './Card';
import { ChevronEndIcon } from './icons';

export const ShortcutCard = ({
  to,
  title,
  description,
  icon: Icon,
}: {
  to: string;
  title: string;
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}): JSX.Element => (
  <Link to={to} className="group focus:outline-none">
    <Card className="h-full transition-shadow group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-brand-500">
      <CardBody className="flex items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
          <Icon className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 font-medium text-slate-800 dark:text-slate-100">
            {title}
            <ChevronEndIcon className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100 rtl:-scale-x-100" />
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        </div>
      </CardBody>
    </Card>
  </Link>
);
