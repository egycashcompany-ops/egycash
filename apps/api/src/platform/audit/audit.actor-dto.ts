// The stored actor snapshot, as a DTO — one mapping for all three readers.
//
// It existed twice before P11: privately in `audit.timeline` and inline in `toActivityDto`. G-2
// needs a third caller (`toAuditDto`), and a third copy of a five-field mapping is how the three
// start disagreeing about `deletedAt` or a missing `jobTitle`.
//
// **The snapshot is the point.** History states who someone was AT THE TIME; resolving the User at
// read time would let a rename, a transfer or a deletion silently rewrite the past. `null` here
// means the row predates actor snapshots — not that nobody did it.
import { type ActorSnapshotDto } from '@ecms/contracts';
import { type ActorSnapshotDoc } from './audit.model';

export const toActorSnapshotDto = (
  userId: unknown,
  snap: ActorSnapshotDoc | null | undefined,
): ActorSnapshotDto | null =>
  snap == null
    ? null
    : {
        userId: userId === null || userId === undefined ? null : String(userId),
        displayName: snap.displayName,
        jobTitle: snap.jobTitle ?? null,
        avatarFileId: snap.avatarFileId ?? null,
        deletedAt:
          snap.deletedAt === null || snap.deletedAt === undefined
            ? null
            : snap.deletedAt.toISOString(),
      };
