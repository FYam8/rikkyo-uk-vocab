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

export type SchedulableRating = Rating.Again | Rating.Hard | Rating.Good | Rating.Easy;

export function schedule(card: Card, rating: SchedulableRating, now = new Date()): Card {
  return scheduler.repeat(card, now)[rating].card;
}

export { Rating };
