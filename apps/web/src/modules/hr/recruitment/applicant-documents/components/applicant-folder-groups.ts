// Which sub-folder each of an applicant's files belongs in.
//
// A folder used to open onto one long list: the three card tiles, then everything else under
// «ملفات أخرى». That is readable while a candidate has four files and unreadable by the time they
// have fourteen, because the list mixes three unrelated things — identity evidence, what the
// candidate handed in through the portal, and what HR attached on their page. So the folder now
// opens onto sub-folders, one per origin.
//
// THE RULE IS A TOTAL FUNCTION OVER `kind`, AND THAT IS THE POINT. Every value of
// `APPLICANT_FOLDER_FILE_KINDS` is named in `SUB_FOLDER_OF` below, so a seventh kind added to the
// contract cannot compile until somebody says which sub-folder it opens in. The alternative — a
// `card`/`document` check with an `else` that sweeps up the rest — would file a future kind under
// «HR attachments» silently, and a file in the wrong drawer is worse than a file in a long list.
//
// It is a plain function in its own module rather than logic inside the dialog because it is the
// part worth testing: a render test can only say that something appeared, while this says that
// THIS file appears under THAT name.
import {
  APPLICANT_FOLDER_FILE_KINDS,
  type ApplicantFolderFileDto,
  type ApplicantFolderFileKind,
} from '@ecms/contracts';

/** The sub-folders, in the order they are shown. */
export const APPLICANT_SUB_FOLDERS = ['card', 'documents', 'attachments'] as const;
export type ApplicantSubFolderId = (typeof APPLICANT_SUB_FOLDERS)[number];

/**
 * Where each kind of file opens.
 *
 * `card` — a side filed before the sides were named — belongs with the card and not in a drawer of
 * its own: it IS the card, just from before the scanner could say which face it was looking at.
 */
const SUB_FOLDER_OF: Record<ApplicantFolderFileKind, ApplicantSubFolderId> = {
  cardFront: 'card',
  cardBack: 'card',
  portrait: 'card',
  card: 'card',
  document: 'documents',
  attachment: 'attachments',
};

export const subFolderOf = (kind: ApplicantFolderFileKind): ApplicantSubFolderId =>
  SUB_FOLDER_OF[kind];

/** Every kind that opens in one sub-folder — what a test asserts the partition against. */
export const kindsIn = (id: ApplicantSubFolderId): ApplicantFolderFileKind[] =>
  APPLICANT_FOLDER_FILE_KINDS.filter((kind) => SUB_FOLDER_OF[kind] === id);

export interface ApplicantSubFolder {
  id: ApplicantSubFolderId;
  files: ApplicantFolderFileDto[];
}

/**
 * The folder's files split into the sub-folders, every sub-folder present.
 *
 * An EMPTY sub-folder is returned rather than dropped, because the three drawers are what the
 * folder is: a candidate with no portal documents has an empty «مستندات المتقدم», and a folder
 * that silently showed two drawers on Monday and three on Tuesday would teach HR to wonder which
 * one is missing instead of reading what is there.
 */
export const splitIntoSubFolders = (
  files: readonly ApplicantFolderFileDto[],
): ApplicantSubFolder[] =>
  APPLICANT_SUB_FOLDERS.map((id) => ({
    id,
    files: files.filter((item) => SUB_FOLDER_OF[item.kind] === id),
  }));

/** The card's three faces, in the order the tiles are laid out. */
export const CARD_TILE_KINDS = ['cardFront', 'cardBack', 'portrait'] as const;
export type CardTileKind = (typeof CARD_TILE_KINDS)[number];

/**
 * The file that fills one card tile.
 *
 * A card filed before the sides were named carries no tag, so its first two images stand in for
 * the front and the back — the same stand-in the single-list folder did, kept because the cards
 * registered before the OCR named sides are still on file and still want showing in the right
 * place.
 */
export const cardTileFile = (
  files: readonly ApplicantFolderFileDto[],
  kind: CardTileKind,
): ApplicantFolderFileDto | undefined => {
  const tagged = files.find((item) => item.kind === kind);
  if (tagged !== undefined) return tagged;
  if (kind === 'portrait') return undefined;
  const untagged = files.filter((item) => item.kind === 'card');
  return untagged[kind === 'cardFront' ? 0 : 1];
};

/**
 * What is inside the card sub-folder that the three tiles do NOT show.
 *
 * A third untagged scan, or a fourth: it is on file, so it is listed under the tiles. Nothing an
 * applicant has may be reachable only by downloading everything.
 */
export const cardExtras = (files: readonly ApplicantFolderFileDto[]): ApplicantFolderFileDto[] => {
  const onTiles = new Set(
    CARD_TILE_KINDS.map((kind) => cardTileFile(files, kind)?.file.id).filter(
      (id): id is string => id !== undefined,
    ),
  );
  return files.filter((item) => !onTiles.has(item.file.id));
};
