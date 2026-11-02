// Which file lands in which sub-folder — the part of the folder worth asserting.
//
// A render test cannot settle these questions. The web suite has no DOM, so nothing opens a
// drawer; and markup assertions answer «did this name appear» rather than «is this file filed
// under that name», which is the actual claim. The grouping is therefore a plain function, and
// this is its spec.
import { describe, expect, it } from 'vitest';
import {
  APPLICANT_FOLDER_FILE_KINDS,
  type ApplicantFolderFileDto,
  type ApplicantFolderFileKind,
  type FileDto,
} from '@ecms/contracts';
import {
  APPLICANT_SUB_FOLDERS,
  CARD_TILE_KINDS,
  cardExtras,
  cardTileFile,
  kindsIn,
  splitIntoSubFolders,
  subFolderOf,
} from './components/applicant-folder-groups';

const file = (id: string): FileDto =>
  ({
    id,
    originalName: `${id}.jpg`,
    displayName: id,
    mime: 'image/jpeg',
    extension: '.jpg',
    size: 2048,
  }) as unknown as FileDto;

const item = (kind: ApplicantFolderFileKind, id: string): ApplicantFolderFileDto => ({
  kind,
  file: file(id),
  documentType: null,
});

const ids = (rows: readonly ApplicantFolderFileDto[]): string[] => rows.map((row) => row.file.id);

describe('every kind of file the contract allows opens in exactly one sub-folder', () => {
  it('covers all of APPLICANT_FOLDER_FILE_KINDS, with nothing swept into a default', () => {
    // Guard over nothing: if the contract's list were empty this suite would prove nothing.
    expect(APPLICANT_FOLDER_FILE_KINDS.length).toBeGreaterThan(5);
    for (const kind of APPLICANT_FOLDER_FILE_KINDS) {
      expect(APPLICANT_SUB_FOLDERS, kind).toContain(subFolderOf(kind));
    }
  });

  it('partitions them — each sub-folder names its own kinds and no kind is named twice', () => {
    const named = APPLICANT_SUB_FOLDERS.flatMap((id) => kindsIn(id));
    expect([...named].sort()).toEqual([...APPLICANT_FOLDER_FILE_KINDS].sort());
    expect(new Set(named).size).toBe(named.length);
  });

  it('files the card, both named sides and the face together', () => {
    expect(kindsIn('card').sort()).toEqual(['card', 'cardBack', 'cardFront', 'portrait']);
  });

  it('keeps what the candidate handed in apart from what HR attached', () => {
    expect(kindsIn('documents')).toEqual(['document']);
    expect(kindsIn('attachments')).toEqual(['attachment']);
  });
});

describe('splitting one folder', () => {
  const files = [
    item('cardFront', 'front'),
    item('cardBack', 'back'),
    item('portrait', 'face'),
    item('document', 'birth-certificate'),
    item('document', 'graduation'),
    item('attachment', 'cv'),
  ];

  it('puts each file under the drawer it belongs to', () => {
    const drawers = splitIntoSubFolders(files);
    expect(drawers.map((d) => d.id)).toEqual(['card', 'documents', 'attachments']);
    expect(ids(drawers[0]?.files ?? [])).toEqual(['front', 'back', 'face']);
    expect(ids(drawers[1]?.files ?? [])).toEqual(['birth-certificate', 'graduation']);
    expect(ids(drawers[2]?.files ?? [])).toEqual(['cv']);
  });

  it('loses nothing: every file is in exactly one drawer', () => {
    const drawers = splitIntoSubFolders(files);
    const landed = drawers.flatMap((d) => ids(d.files));
    expect(landed.sort()).toEqual(ids(files).sort());
  });

  it('returns an EMPTY drawer rather than dropping it', () => {
    const drawers = splitIntoSubFolders([item('attachment', 'cv')]);
    expect(drawers).toHaveLength(3);
    expect(drawers.find((d) => d.id === 'card')?.files).toEqual([]);
    expect(drawers.find((d) => d.id === 'documents')?.files).toEqual([]);
  });

  it('returns all three drawers for a folder holding nothing at all', () => {
    expect(splitIntoSubFolders([]).map((d) => d.id)).toEqual([...APPLICANT_SUB_FOLDERS]);
    expect(splitIntoSubFolders([]).every((d) => d.files.length === 0)).toBe(true);
  });
});

describe('the card drawer’s three tiles', () => {
  it('fills each tile from the side the scanner named', () => {
    const files = [item('cardFront', 'front'), item('cardBack', 'back'), item('portrait', 'face')];
    expect(CARD_TILE_KINDS.map((kind) => cardTileFile(files, kind)?.file.id)).toEqual([
      'front',
      'back',
      'face',
    ]);
    expect(cardExtras(files)).toEqual([]);
  });

  it('leaves a tile empty when that side is not on file', () => {
    const files = [item('cardFront', 'front')];
    expect(cardTileFile(files, 'cardBack')).toBeUndefined();
    expect(cardTileFile(files, 'portrait')).toBeUndefined();
  });

  /** Cards registered before the OCR named sides carry no tag; their first two images stand in. */
  it('stands an untagged card’s first two images in for the front and the back', () => {
    const files = [item('card', 'scan-1'), item('card', 'scan-2')];
    expect(cardTileFile(files, 'cardFront')?.file.id).toBe('scan-1');
    expect(cardTileFile(files, 'cardBack')?.file.id).toBe('scan-2');
    // There is no third face to guess at: the portrait is only ever the tagged one.
    expect(cardTileFile(files, 'portrait')).toBeUndefined();
    expect(cardExtras(files)).toEqual([]);
  });

  /**
   * A tagged side wins, and an untagged scan is NOT promoted into the side that is missing.
   *
   * That restraint is deliberate and it is the behaviour the single-list folder already had: an
   * untagged image is one the scanner could not name, so calling it «الوجه الخلفي» would be the
   * screen inventing a fact. It is listed under the tiles instead, where it is still one click
   * from being opened — invisible is the only outcome that would be wrong.
   */
  it('prefers a tagged side, and leaves an unnamed scan unnamed', () => {
    const files = [item('card', 'scan-1'), item('cardFront', 'front')];
    expect(cardTileFile(files, 'cardFront')?.file.id).toBe('front');
    expect(cardTileFile(files, 'cardBack')).toBeUndefined();
    expect(ids(cardExtras(files))).toEqual(['scan-1']);
  });

  /** Nothing an applicant has may be reachable only by downloading everything. */
  it('lists a third untagged scan under the tiles instead of hiding it', () => {
    const files = [item('card', 'scan-1'), item('card', 'scan-2'), item('card', 'scan-3')];
    expect(ids(cardExtras(files))).toEqual(['scan-3']);
  });
});
