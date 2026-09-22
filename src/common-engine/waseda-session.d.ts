export interface PlanOptions<T> {
  pool: T[]; size: number; unlimitedSize: number; mode: string; year: string;
  getId(item: T): string;
  isSpecialMode(mode: string): boolean;
  buildSpecialPlan(year: string, size: number): { baseQueueIds: string[]; actualSessionSize: number };
  isRandomMode(mode: string): boolean;
  shuffle(pool: T[]): T[];
  weightedWithoutReplacement(pool: T[], n: number, score: (item: T) => number): T[];
  score(item: T, mode: string): number;
  isSpecialEntity(item: T): boolean;
}
export const VOCABULARY_SESSION_ENGINE: {
  buildPlan<T>(options: PlanOptions<T>): { baseQueueIds: string[]; actualSessionSize: number; unlimited: boolean };
  dueRetry<T extends { dueAfterTotal: number; wordId: string }>(queue: T[], totalAnswered: number, isBlocked: (id: string) => boolean): T | null;
};
