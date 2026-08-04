// A user's name from an id alone — for the streams that recorded WHO but not what they were called.
//
// Reads the shared cache first, so a page that batch-resolved its ids up front (see
// `useDirectoryProfile` + `useResolveDirectory`) renders every row without a single extra request.
// Falls back to the id's own cached query when a caller forgot to batch, and to nothing at all
// when the account is gone — a row must never turn into an error because its author left.
import { type ActorSnapshotDto } from '@ecms/contracts';
import { useDirectoryProfile } from './directory-queries';
import { ActorLink } from './ActorLink';

export const ActorById = ({ userId }: { userId: string | null }): JSX.Element | null => {
  const { data } = useDirectoryProfile(userId);
  // `null` is the deleted-account answer, `undefined` the not-yet-loaded one. Neither is an error:
  // a row must never break because its author left or because the name has not arrived yet.
  if (userId === null || data === undefined || data === null) return null;
  const actor: ActorSnapshotDto = {
    userId: data.userId,
    displayName: data.displayName,
    jobTitle: data.jobTitle,
    avatarFileId: data.avatarFileId,
    deletedAt: null,
  };
  return <ActorLink actor={actor} />;
};
