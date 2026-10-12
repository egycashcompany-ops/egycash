// A form that saves a record and then uploads its photo — the photo can only go up once the
// record exists, so the two are separate calls, and the second can fail after the first landed.
//
// A receipt is money: saving it takes the amount off the card. If a refused photo let the error
// escape, the form would stay open as if nothing were saved, and a second Save would record the
// receipt — and take the money — twice. So a failed upload is reported, not thrown: the caller
// says the record is saved without its photo and closes; the table's image column still uploads.

/** What became of the photo once the record was saved. */
export type PhotoOutcome = 'none' | 'uploaded' | 'failed';

export const saveThenAttachPhoto = async <T extends { id: string }>(
  save: () => Promise<T>,
  file: File | null,
  upload: (id: string, file: File) => Promise<unknown>,
): Promise<{ saved: T; photo: PhotoOutcome }> => {
  // A failed SAVE still throws: nothing was written, and the form stays open to try again.
  const saved = await save();
  if (file === null) return { saved, photo: 'none' };
  try {
    await upload(saved.id, file);
    return { saved, photo: 'uploaded' };
  } catch {
    // The upload's own error was already toasted by the mutation.
    return { saved, photo: 'failed' };
  }
};
