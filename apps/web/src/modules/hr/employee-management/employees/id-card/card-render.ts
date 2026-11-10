// The company ID card (كارنيه الشركة), drawn exactly as the current system prints it.
//
// Everything here is read off that system's own PDF: the page is 252 x 158.4 pt (88.9 x 55.88 mm),
// the artwork behind the text is its own embedded picture (`/id-card/card-front-template.png`: logo,
// purple corner, watermark, photo frame and the executive's signature), the text is Times New
// Roman Bold, and every position and size below is the PDF's, in points from its bottom-left
// corner. Only the photo and the words change from card to card.
//
// Pure canvas drawing — no React — so the preview, the print sheet and a test all draw the same card.
import {
  MARK_BAND_PATH,
  MARK_HEIGHT,
  MARK_RIBBON_PATH,
  MARK_WIDTH,
} from '../../../../../shared/ui/brand-mark-paths';
import {
  WORDMARK_HEIGHT,
  WORDMARK_PATH,
  WORDMARK_WIDTH,
} from '../../../../../shared/ui/egycash-wordmark-paths';

export const PAGE_W_PT = 252;
export const PAGE_H_PT = 158.4;
/** Pixels per point: 8 makes a 2016 x 1267 picture, about 576 dpi on the printed card. */
const K = 8;
export const CARD_W = PAGE_W_PT * K;
export const CARD_H = Math.round(PAGE_H_PT * K);
/** The card's photo frame, width over height (55.65 x 70.56 pt): the photo is cropped to it, centred. */
export const PHOTO_ASPECT = 55.65 / 70.56;
const INK = '#000000';
const HINT = '#9a9aa6';
const FONT = '"Times New Roman", "Noto Naskh Arabic", serif';
const PURPLE = '#3e3f98';
const PURPLE_LIGHT = '#5d5faa';
const TEMPLATE_URL = '/id-card/card-front-template.png';

/** What the card says. Empty fields draw as grey stand-ins in the preview. */
export interface IdCardFace {
  name: string;
  job: string;
  /** The Global Employee Number, top left (e.g. 2815). */
  number: string;
  /** The Employee Code (e.g. 0102815). */
  code: string;
  nationalId: string;
  signerName: string;
  signerTitle: string;
}

/** The signer the current cards carry, under the signature printed in the artwork. */
export const DEFAULT_SIGNER = { name: 'لــواء أح / جمــال أبوإسماعيل', title: 'المدير التنفيذى' };
export const BACK_TAGLINE = 'TECHNOLOGICAL CASH TRANSFER';

const x = (pt: number): number => pt * K;
/** The PDF measures up from the bottom; a canvas measures down from the top. */
const y = (pt: number): number => (PAGE_H_PT - pt) * K;
const font = (pt: number): string => `700 ${String(pt * K)}px ${FONT}`;

export const toArabicDigits = (text: string): string =>
  text.replace(/[0-9]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)] ?? digit);

let template: Promise<HTMLImageElement> | null = null;
/** The card's own artwork, loaded once and shared by every card drawn. */
export const loadCardArt = (): Promise<HTMLImageElement> => {
  template ??= new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      template = null;
      reject(new Error('the ID card artwork could not be loaded'));
    };
    image.src = TEMPLATE_URL;
  });
  return template;
};

/** A picture from a URL (the employee's photo arrives as an object URL). */
export const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('the photo could not be loaded'));
    image.src = url;
  });

const context = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('canvas 2D is not available');
  return ctx;
};

/** Text on one line, made smaller only if it would not fit the PDF's own box for it. */
const fitText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  sizePt: number,
  maxWidthPt: number,
): void => {
  let size = sizePt;
  ctx.font = font(size);
  while (ctx.measureText(text).width > x(maxWidthPt) && size > sizePt * 0.6) {
    size -= 0.25;
    ctx.font = font(size);
  }
};

/** A run of words whose left edge is where the PDF puts it. */
const atLeft = (
  ctx: CanvasRenderingContext2D,
  text: string,
  leftPt: number,
  baselinePt: number,
  sizePt: number,
): void => {
  ctx.font = font(sizePt);
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.fillText(text, x(leftPt), y(baselinePt));
};

/** A photo filling the frame edge to edge, centred. */
const drawPhotoInFrame = (
  ctx: CanvasRenderingContext2D,
  photo: HTMLImageElement,
  left: number,
  top: number,
  w: number,
  h: number,
): void => {
  const scale = Math.max(w / photo.width, h / photo.height);
  ctx.drawImage(
    photo,
    left + (w - photo.width * scale) / 2,
    top + (h - photo.height * scale) / 2,
    photo.width * scale,
    photo.height * scale,
  );
};

/** The front: the original artwork, the photo in its frame, and the employee's details. */
export const drawFront = (
  canvas: HTMLCanvasElement,
  art: HTMLImageElement | null,
  data: IdCardFace,
  photo: HTMLImageElement | null,
): void => {
  const ctx = context(canvas);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  if (art !== null) ctx.drawImage(art, 0, 0, CARD_W, CARD_H);
  ctx.textBaseline = 'alphabetic';

  // The photo: the PDF's own box, 55.65 x 70.56 pt at (13.425, 49.727), filled edge to edge.
  if (photo !== null) {
    const left = x(13.425);
    const top = y(49.727 + 70.56);
    const w = x(55.65);
    const h = x(70.56);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, w, h);
    ctx.clip();
    drawPhotoInFrame(ctx, photo, left, top, w, h);
    ctx.restore();
  }

  // The employee number, top left, in Arabic digits.
  ctx.fillStyle = data.number === '' ? HINT : INK;
  atLeft(ctx, toArabicDigits(data.number || '0000'), 14.688, 140.904, 11);

  // Name and job: centred in the PDF's 163 pt wide box.
  const centre = 79.825 + 163.139 / 2;
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.fillStyle = data.name === '' ? HINT : INK;
  fitText(ctx, data.name || 'اسم الموظف', 13, 163);
  ctx.fillText(data.name || 'اسم الموظف', x(centre), y(76.824));
  ctx.fillStyle = data.job === '' ? HINT : INK;
  fitText(ctx, data.job || 'الوظيفة', 13, 163);
  ctx.fillText(data.job || 'الوظيفة', x(centre), y(55.44));

  // The labels, where the PDF writes them: the colon, then the Arabic words to its right.
  ctx.fillStyle = INK;
  atLeft(ctx, ':', 193.824, 28.944, 11);
  atLeft(ctx, 'كود الموظف', 200.232, 28.944, 11);
  atLeft(ctx, ':', 193.824, 14.184, 11);
  atLeft(ctx, 'الرقم القومى', 200.232, 14.184, 11);
  atLeft(ctx, ':', 65.016, 31.608, 9);
  atLeft(ctx, 'التوقيع', 70.272, 31.608, 9);

  // The code and the national ID end where the PDF's do, so a shorter number stays by its label.
  ctx.font = font(11);
  const digit = ctx.measureText('٠').width;
  ctx.direction = 'ltr';
  ctx.textAlign = 'right';
  ctx.fillStyle = data.code === '' ? HINT : INK;
  ctx.fillText(toArabicDigits(data.code || '0000000'), x(148.968) + digit * 7, y(27.0));
  ctx.fillStyle = data.nationalId === '' ? HINT : INK;
  ctx.fillText(
    toArabicDigits(data.nationalId || '00000000000000'),
    x(105.768) + digit * 14,
    y(12.168),
  );

  // The signer, centred under the signature in the PDF's boxes.
  ctx.fillStyle = INK;
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  fitText(ctx, data.signerName, 9, 90);
  ctx.fillText(data.signerName, x(45.3), y(17.496));
  fitText(ctx, data.signerTitle, 9, 60);
  ctx.fillText(data.signerTitle, x(46.3), y(5.328));
};

/** The mark and the lettering in the logo's own proportions. `height` is the mark's height. */
const drawLogo = (
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  height: number,
  tagline: string,
): void => {
  const markScale = height / MARK_HEIGHT;
  ctx.save();
  ctx.translate(left, top);
  ctx.scale(markScale, markScale);
  ctx.fillStyle = PURPLE;
  ctx.fill(new Path2D(MARK_RIBBON_PATH));
  ctx.fillStyle = PURPLE_LIGHT;
  ctx.fill(new Path2D(MARK_BAND_PATH));
  ctx.restore();
  const wordHeight = height * 0.39;
  const wordWidth = height * 2.2;
  const wordX = left + MARK_WIDTH * markScale + height * 0.15;
  const wordY = top + height * 0.18;
  ctx.save();
  ctx.translate(wordX, wordY);
  ctx.scale(wordWidth / WORDMARK_WIDTH, wordHeight / WORDMARK_HEIGHT);
  ctx.fillStyle = PURPLE;
  ctx.fill(new Path2D(WORDMARK_PATH));
  ctx.restore();
  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = PURPLE;
  ctx.font = `700 ${String(height * 0.066)}px "Cairo", sans-serif`;
  const plain = ctx.measureText(tagline).width;
  // Spread to the wordmark's width, as on the printed card.
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
    `${String((wordWidth - plain) / Math.max(1, tagline.length - 1))}px`;
  ctx.fillText(tagline, wordX, wordY + wordHeight + height * 0.06);
  ctx.restore();
};

/** The back: the logo alone, as on the printed card. */
export const drawBack = (canvas: HTMLCanvasElement, tagline: string = BACK_TAGLINE): void => {
  const ctx = context(canvas);
  ctx.fillStyle = '#f7f7f9';
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const height = CARD_H * 0.3;
  const width = height * (MARK_WIDTH / MARK_HEIGHT + 0.15 + 2.2);
  drawLogo(ctx, (CARD_W - width) / 2, (CARD_H - height) / 2, height, tagline);
};
