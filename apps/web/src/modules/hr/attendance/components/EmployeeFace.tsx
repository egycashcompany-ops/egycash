// A person's face on an attendance screen: their PROFILE PHOTO when they have one, their initials
// when they do not (or while it loads). The photo is fetched with the session, cached per
// employee and file, so a page of faces costs one request per new face, once.
import { useEmployeePhotoUrl } from '../../employee-management/employees/api/employee-photo';
import { PersonAvatar } from '../views/view-parts';

export const EmployeeFace = ({
  id,
  photoFileId,
  name,
  size = 'md',
}: {
  id: string;
  photoFileId: string | null | undefined;
  name: string;
  size?: 'md' | 'lg';
}): JSX.Element => {
  const photo = useEmployeePhotoUrl(id, photoFileId ?? null);
  return <PersonAvatar name={name} photoUrl={photo.url} size={size} />;
};
