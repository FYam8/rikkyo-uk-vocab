import { createEmptyCard, fsrs, generatorParameters, Rating, type Card } from "ts-fsrs";
import { SCHEDULER_CONFIG } from "./config";

export const scheduler = fsrs(generatorParameters({
  request_retention: SCHEDULER_CONFIG.desiredRetention,
  enable_fuzz: SCHEDULER_CONFIG.enableFuzz,
  enable_short_term: SCHEDULER_CONFIG.enableShortTerm,
}));

export function newCard(now = new Date()): Card {
  return createEmptyCard(now);
}

export type FsrsCard = Card;
export type SchedulableRating = Rating.Again | Rating.Hard | Rating.Good | Rating.Easy;

export function schedule(card: Card, rating: SchedulableRating, now = new Date()): Card {
  return scheduler.repeat(card, now)[rating].card;
}

export function hydrateCard(value: Card | null): Card | null {
  if (!value) return null;
  const card = { ...value } as Card & { due: Date | string; last_review?: Date | string };
  if (!(card.due instanceof Date)) card.due = new Date(card.due);
  if (card.last_review != null && !(card.last_review instanceof Date)) card.last_review = new Date(card.last_review);
  if (Number.isNaN(card.due.getTime())) throw new Error("FSRS_CARD_DATE_INVALID");
  if (card.last_review instanceof Date && Number.isNaN(card.last_review.getTime())) throw new Error("FSRS_CARD_LAST_REVIEW_INVALID");
  return card;
}

export { Rating };
