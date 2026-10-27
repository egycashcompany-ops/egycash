// «بواسطة» — who did something, by name, for the fleet screens that show it.
//
// One helper so every fleet record names its actor the same way: the user's Arabic first and last
// name as the account reads TODAY (the accidents' transfer «بواسطة» is built the same way). A
// record keeps the user's id; the name is resolved when read, or snapshotted where a paper needs
// it frozen.
import { userService } from '../../platform/users';

type UserName = { profile: { firstName: { ar: string }; lastName: { ar: string } } };

const fullNameOf = (user: UserName): string | null => {
  const name = [user.profile.firstName.ar, user.profile.lastName.ar]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' ');
  return name === '' ? null : name;
};

const idOf = (by: string | null | undefined): string | null => {
  const id = by?.trim() ?? '';
  return id === '' ? null : id;
};

/** The user's Arabic first and last name; `null` when the id is blank, unknown or nameless. */
export const actorNameOf = async (by: string | null | undefined): Promise<string | null> => {
  const id = idOf(by);
  if (id === null) return null;
  const user = await userService.findByIdSystem(id);
  return user === null ? null : fullNameOf(user);
};

/**
 * Several users' names at once — one lookup per distinct id, in parallel. Only the ids that resolve
 * to a name are in the map; read a missing one as `null`.
 */
export const actorNamesOf = async (
  ids: Iterable<string | null | undefined>,
): Promise<Map<string, string>> => {
  const distinct = [...new Set([...ids].map(idOf).filter((id): id is string => id !== null))];
  const names = await Promise.all(distinct.map((id) => actorNameOf(id)));
  const out = new Map<string, string>();
  distinct.forEach((id, i) => {
    const name = names[i];
    if (name != null) out.set(id, name);
  });
  return out;
};
