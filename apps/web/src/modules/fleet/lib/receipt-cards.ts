// What the receipt modal knows about the picked car's fuel cards — «لما اختار العربيه يشيل رسالة
// اختر سيارة ويجيب بقى هل فى كارت واحد على العربيه او اتنين او مفيش».
//
// Four honest answers, and the modal says each one: no car yet, still loading, could not load,
// and the car's cards (none, one or two). «Still loading» is its own answer because the cards
// query keeps the PREVIOUS car's list on screen while the new one arrives — read as an answer, that
// list filters to nothing and the modal would claim a car with two cards has none.
//
// «لما اختار عربيه اعملى ان هل تريد تسجيل كارت اخر حتى لو العربيه عليها كروت»: beside the car's own
// cards, ANY other card in the system may pay — another car's, or one on no car («سفر 1»,
// «اسبير»). The helpers below search those, keep that pick, and name where such a card sits.
import {
  type FleetFuelCardCompany,
  type FleetFuelCardDto,
  type FleetReceiptDto,
} from '@ecms/contracts';
import { fold } from '../../../shared/lib/fold';

export type ReceiptCardsState =
  | { kind: 'noCar' }
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; cards: FleetFuelCardDto[] };

export const receiptCardsState = (input: {
  vehicleId: string;
  /** The picked car's code — '' until the registry has resolved it. */
  code: string;
  items: readonly FleetFuelCardDto[] | undefined;
  /** The query is still showing an earlier key's list. */
  placeholder: boolean;
  failed: boolean;
}): ReceiptCardsState => {
  if (input.vehicleId === '') return { kind: 'noCar' };
  if (input.failed) return { kind: 'failed' };
  if (input.code === '' || input.items === undefined || input.placeholder) {
    return { kind: 'loading' };
  }
  return { kind: 'ready', cards: input.items.filter((card) => card.vehicleId === input.vehicleId) };
};

/**
 * The card the receipt points at once the car's cards are known: the ONLY card when there is one,
 * the clerk's pick while it is still one of this car's, and nothing otherwise. Until the cards are
 * known the current pick is kept — an edit opens with its card already chosen.
 */
export const settleReceiptCardId = (state: ReceiptCardsState, current: string): string => {
  if (state.kind !== 'ready') return current;
  const [only] = state.cards;
  if (state.cards.length === 1 && only !== undefined) return only.id;
  return state.cards.some((card) => card.id === current) ? current : '';
};

/** What pays: one of the car's own cards, or «كارت آخر» — any other card in the system. */
export interface ReceiptCardPick {
  other: boolean;
  cardId: string;
}

/**
 * The pick once the car's cards are known. The car's own are settled as above. Another card is
 * NEVER dropped for not being this car's — that is the point of it — unless the car picked since
 * turns out to carry it: then it is simply one of the car's own.
 */
export const settleReceiptCard = (
  state: ReceiptCardsState,
  pick: ReceiptCardPick,
): ReceiptCardPick => {
  if (!pick.other) return { other: false, cardId: settleReceiptCardId(state, pick.cardId) };
  const own = state.kind === 'ready' && state.cards.some((card) => card.id === pick.cardId);
  return own ? { other: false, cardId: pick.cardId } : pick;
};

/** Whether a saved receipt was paid by a card that is not on its car — it opens on «كارت آخر». */
export const paidByOtherCard = (
  row: Pick<FleetReceiptDto, 'source' | 'cardId' | 'vehicleId' | 'cardVehicleId'>,
): boolean => row.source === 'card' && row.cardId !== null && row.cardVehicleId !== row.vehicleId;

/** Where a card sits, as the fuel screens name it: its car's code, or its label on no car. */
export const cardPlace = (card: Pick<FleetFuelCardDto, 'vehicleCode' | 'label'>): string =>
  card.vehicleCode ?? card.label ?? '—';

/**
 * «كارت آخر»: every card that is not on the receipt's car, narrowed by what is typed — the car's
 * code, the card's name or label, its number (with or without its spaces) or the company, in
 * either language. Every word typed must match, folded as every search box in the app folds
 * (`fold`): «وطنيه» finds «وطنية», «شل اوت» finds «شل أوت», «اسبير» finds «إسبير», and
 * Arabic-Indic digits read as Latin ones.
 */
export const otherReceiptCards = (
  cards: readonly FleetFuelCardDto[],
  vehicleId: string,
  query: string,
  companyName: (company: FleetFuelCardCompany) => string,
): FleetFuelCardDto[] => {
  const words = query
    .split(/\s+/u)
    .map(fold)
    .filter((word) => word !== '');
  return cards
    .filter((card) => card.vehicleId !== vehicleId)
    .filter((card) => {
      const text = [
        card.vehicleCode ?? '',
        card.label ?? '',
        card.name,
        card.number,
        card.number.replace(/\s+/gu, ''),
        card.company,
        companyName(card.company),
      ]
        .map(fold)
        .join(' ');
      return words.every((word) => text.includes(word));
    });
};

/**
 * The card's place on a receipt row when it is NOT the receipt's own car's — «كارت 160» for
 * another car's card (`cardOf`), the name of a card on no car («سفر 1») — and `null` for the car's
 * own card, the fund, or a card no longer known.
 */
export const receiptCardOwner = (
  row: Pick<
    FleetReceiptDto,
    'source' | 'vehicleId' | 'cardCompany' | 'cardVehicleId' | 'cardVehicleCode' | 'cardLabel'
  >,
  cardOf: (code: string) => string,
): string | null => {
  if (row.source !== 'card' || row.cardCompany === null) return null;
  if (row.cardVehicleId === row.vehicleId) return null;
  if (row.cardVehicleId !== null) return cardOf(row.cardVehicleCode ?? '—');
  return row.cardLabel ?? '—';
};
