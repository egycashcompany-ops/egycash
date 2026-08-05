// A user's name, anywhere in the system, as something you can click. Pairs with UserProfileDrawer
// and primes the cache from what it already knows, so opening the card costs no request when the
// name is already on screen.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type ActorSnapshotDto } from '@ecms/contracts';
import { useAppSelector } from '../../store';
import { useT } from '../localization/useT';
import { primeFromSnapshot } from './directory-queries';
import { UserProfileDrawer } from './UserProfileDrawer';

export const ActorLink = ({ actor }: { actor: ActorSnapshotDto | null }): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  if (actor === null) return null;

  const name = actor.displayName[locale];
  // An account that no longer exists still shows its historical name — it is simply not a link.
  if (actor.userId === null) {
    return <span className="text-xs text-slate-500 dark:text-slate-400">{name}</span>;
  }

  return (
    <>
      <button
        type="button"
        title={t('directory.open')}
        onClick={() => {
          primeFromSnapshot(qc, actor);
          setOpen(true);
        }}
        className="rounded text-xs font-medium text-slate-600 underline decoration-dotted underline-offset-2 hover:text-brand-600 dark:text-slate-300 dark:hover:text-brand-400"
      >
        {name}
      </button>
      {open && <UserProfileDrawer actor={actor} open={open} onClose={() => setOpen(false)} />}
    </>
  );
};
