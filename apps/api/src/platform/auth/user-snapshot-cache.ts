// The cache key for the authenticated caller's snapshot — one definition, ten call sites.
//
// The snapshot is what `authenticate` reads on every request instead of going back to Mongo, and
// it is invalidated from five different services. Inlining the key in each of them was survivable
// while the shape never changed; it stops being survivable the moment a NEW field on the snapshot
// feeds a security decision, because a deployment that rolls out with warm pre-upgrade entries
// would answer `undefined` for that field until the TTL expires.
//
// Hence the version in the key. Bump it whenever the snapshot gains or loses a field: the old
// entries are then unreachable rather than wrong, and they age out on their own.
export const userSnapshotKey = (userId: string): string => `auth:user:v2:${userId}`;
