// Which topic rooms one authenticated socket may join (ADR-029). The SERVER decides this from
// the caller's permissions at connect time — the client never asks for rooms, so a client
// cannot subscribe its way past its grants.
import {
  ACTIVITY_STREAM_TOPIC,
  AUDIT_STREAM_TOPIC,
  branchTopicRoom,
  topicRoom,
} from '@ecms/contracts';
import { env } from '../../infrastructure/config/env';
import { scopeOf, type AuthContext } from '../../shared/types';
import { REALTIME_TOPICS } from './realtime-registry';

/**
 * Fail-closed by construction:
 *  - no permission for a topic → no room, so not even "something changed" leaks;
 *  - an `organization` grant joins the org-wide room;
 *  - a `branch`/`department`/`section` grant joins only the caller's own branch room — signals
 *    that name no branch go to the org room only, so a branch viewer can never receive another
 *    branch's activity;
 *  - an `own` grant joins nothing: own-scope screens are about the caller's records, and a
 *    branch-wide feed would tell them about everyone else's.
 *
 * The raw grant (`scopeOf`) decides, not the command bar's narrowing: an organization-wide
 * administrator peeking at one branch still holds the org grant, and an org-room signal at most
 * triggers a refetch that their normal, scoped API answers.
 */
const roomsForTopic = (ctx: AuthContext, topic: string, permission: string): string[] => {
  const scope = scopeOf(ctx, permission);
  if (scope === undefined || scope === 'own') return [];
  if (scope === 'organization') return [topicRoom(topic)];
  return ctx.branchId === null ? [] : [branchTopicRoom(topic, ctx.branchId)];
};

export const roomsForContext = (ctx: AuthContext): string[] => {
  if (!env.REALTIME_ENABLED) return [];
  const rooms: string[] = [];
  for (const [topic, def] of Object.entries(REALTIME_TOPICS)) {
    // The two stream topics are handled below — organization-wide or nothing, because the
    // audit/activity screens are organization surfaces and their rows carry no branch.
    if (topic === AUDIT_STREAM_TOPIC || topic === ACTIVITY_STREAM_TOPIC) continue;
    rooms.push(...roomsForTopic(ctx, topic, def.permission));
  }
  if (scopeOf(ctx, 'auditLog.view') === 'organization') {
    rooms.push(topicRoom(AUDIT_STREAM_TOPIC));
  }
  if (scopeOf(ctx, 'activityLog.view') === 'organization') {
    rooms.push(topicRoom(ACTIVITY_STREAM_TOPIC));
  }
  return rooms;
};
