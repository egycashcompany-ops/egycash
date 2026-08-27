// The candidate's own calls. Three of them, and NOT ONE takes an applicant id.
//
// That is not an omission to be tidied up later — it is D-APP-9 as it appears on this side. The
// server resolves the candidate from the session, so there is no id for a client to send and none
// for anybody to tamper with. If a fourth call here ever grows an `applicantId` parameter, that is
// the moment the portal stopped being confined.
import {
  type ApplicantDocumentSetDto,
  type ApplicantPortalStatusDto,
} from '@ecms/contracts';
import { get, upload } from '../../../../../shared/lib/api-client';

const BASE = '/hr/applicant-portal';

export const fetchMyStatus = (): Promise<ApplicantPortalStatusDto> => get(`${BASE}/status`);

export const fetchMyDocuments = (): Promise<ApplicantDocumentSetDto> => get(`${BASE}/documents`);

/**
 * Hand a document in, or hand a better one in — ONE call for both.
 *
 * From where the candidate stands they are the same act: putting a file in a slot. Which of the
 * two writes runs is the slot's business, decided on the server against the state it is actually
 * in rather than against whatever this screen last saw.
 */
export const submitMyDocument = (input: {
  typeId: string;
  file: File;
  licenseClass?: string;
}): Promise<ApplicantDocumentSetDto> => {
  const form = new FormData();
  form.append('typeId', input.typeId);
  if (input.licenseClass !== undefined) form.append('licenseClass', input.licenseClass);
  form.append('file', input.file);
  return upload(`${BASE}/documents`, form);
};
