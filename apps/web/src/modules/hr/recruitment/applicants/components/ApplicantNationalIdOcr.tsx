// Applicants' binding of the reusable National-ID OCR flow. It supplies the module-specific
// extractor (upload the two images, then call the HR OCR endpoint) and forwards the reviewed,
// confirmed fields to the caller. All the capture + review UI lives in the shared `NationalIdOcr`
// component, so Employees / KYC / etc. reuse it with their own binding.
//
// THE UPLOAD GOES THROUGH HR'S OWN ENDPOINT, and that is the fix for a bug an HR user hit on the
// live site: «لا توجد فئة ملفات للصور مُهيّأة» on every attempt, while the admin account worked.
// Nothing was misconfigured. This screen used to find the National-ID category by listing
// `/platform/file-categories` and then upload through `POST /platform/files` — routes behind
// `file.view` and `file.create`. No HR role holds either, and `file.view` should not be granted to
// get a card read: it lists files across the whole system, ID cards included. So the category list
// came back empty and the screen blamed the category.
//
// `POST /hr/applicants/national-id-card/upload` needs `applicant.create` — the same key
// registering an applicant needs, which is the act this is a step inside — and resolves the
// category server-side, so the browser never asks what categories exist.
//
// THE UPLOADS ARE STILL FILED BY KIND. The server files them in the National-ID category, which is
// what the security-check package reads when it prints one card per page, and it ensures that
// category as it reads it — so a database seeded before the category existed gets it created on
// first use rather than failing.
//
// The scan runs BEFORE the applicant exists, so these uploads still land on a scratch reference:
// `onScanned` hands their ids up so the register call can name them and the server can copy them
// onto the applicant it creates.
import { type NationalIdCardSide } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import {
  NationalIdOcr,
  type NationalIdExtractor,
  type NationalIdReviewData,
} from '../../../../../shared/national-id';
import { useOcrExtract } from '../api/applicant-queries';
import { uploadNationalIdCardScan } from '../api/applicant-api';
import { ocrErrorKey } from './ocr-error';

/** One scanned image and what it shows. */
export interface ScannedCardFile {
  id: string;
  side: NationalIdCardSide;
}

/** A `data:image/jpeg;base64,…` URL as a File to upload. */
const dataUrlToFile = (dataUrl: string, name: string): File => {
  const [, body = ''] = dataUrl.split(',', 2);
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return new File([bytes], name, { type: 'image/jpeg' });
};

export const ApplicantNationalIdOcr = ({
  onConfirm,
  onScanned,
}: {
  onConfirm: (data: NationalIdReviewData) => void;
  /** The images just uploaded — each side and the holder's photo — so a caller that is about to
   *  create the applicant can have them filed against it. Omitted by callers that do not create one. */
  onScanned?: (files: ScannedCardFile[]) => void;
}): JSX.Element => {
  const t = useT();
  const ocr = useOcrExtract();

  const uploadOne = async (file: File): Promise<string> => {
    const form = new FormData();
    form.append('file', file);
    const uploaded = await uploadNationalIdCardScan(form);
    return uploaded.fileId;
  };

  const extract: NationalIdExtractor = async ({ frontFile, backFile }) => {
    try {
      const [frontFileId, backFileId] = await Promise.all([
        frontFile === null ? Promise.resolve(undefined) : uploadOne(frontFile),
        backFile === null ? Promise.resolve(undefined) : uploadOne(backFile),
      ]);
      const scanned: ScannedCardFile[] = [];
      if (frontFileId !== undefined) scanned.push({ id: frontFileId, side: 'front' });
      if (backFileId !== undefined) scanned.push({ id: backFileId, side: 'back' });
      onScanned?.(scanned);
      const result = await ocr.mutateAsync({
        ...(frontFileId === undefined ? {} : { frontFileId }),
        ...(backFileId === undefined ? {} : { backFileId }),
      });
      // The holder's photograph, cut from the front by the reader, is kept with the card so the
      // applicant's documents folder shows the face as well as both sides. A failure here never
      // fails the read: the card itself is already filed.
      const portrait = result.images?.portrait;
      if (portrait !== undefined && onScanned !== undefined) {
        try {
          const id = await uploadOne(dataUrlToFile(portrait, 'national-id-photo.jpg'));
          onScanned([...scanned, { id, side: 'portrait' }]);
        } catch {
          // the card is enough to register
        }
      }
      return result;
    } catch (error) {
      // One place for every way this can fail — the upload, the read, a timeout — because the
      // reader only ever needs one of two answers out of it: «your account may not do this, ask
      // an administrator» or «that did not work, try again». Rethrown so the shared component
      // still returns to the capture step rather than sitting on a spinner.
      toast.error(t(ocrErrorKey(error)));
      throw error;
    }
  };

  return <NationalIdOcr extract={extract} onConfirm={onConfirm} />;
};
