// Users named the way the Operations screens name a person who acted: the Arabic display name, the
// English one when there is none, null when the user is unknown. One directory read for the whole
// list — a handful of desk and vault users act, however many rows they acted on.
//
// Shared by the deleted shipments («حذفها …», `deletedByName`) and, since Round 18, the vault's
// receipts: «انا مش عاوز اى اسماء» took the treasurers' names off the receive form, so who received a
// محصنة is the signed-in user, named by the same rule. «السجل» names its actors the same way, from the
// audit row's snapshot (shipment-log.ts `actorNameOf`).
import { directoryProfileService } from '../../platform/directory';

export const userDisplayNames = async (
  userIds: readonly string[],
): Promise<Map<string, string | null>> => {
  const unique = [...new Set(userIds)];
  const profiles = await directoryProfileService.resolve(unique);
  return new Map(
    unique.map((userId) => {
      const name = profiles.get(userId)?.displayName;
      if (name === undefined) return [userId, null];
      return [userId, name.ar !== '' ? name.ar : name.en !== '' ? name.en : null];
    }),
  );
};
