/**
 * Vendored school-neutral orchestration API.
 * Policy, scoring, identity and persistence remain adapter-owned.
 */
export const VOCABULARY_SESSION_ENGINE = Object.freeze({
  take<T>(items: readonly T[], limit: number): T[] {
    return items.slice(0, Math.max(0, limit));
  },
  dueRetry<T extends { dueAfterTotal: number; wordId: string }>(
    queue: readonly T[], totalAnswered: number, isBlocked: (id: string) => boolean,
  ): T | null {
    return [...queue]
      .filter((item) => item.dueAfterTotal <= totalAnswered && !isBlocked(item.wordId))
      .sort((a, b) => a.dueAfterTotal - b.dueAfterTotal)[0] ?? null;
  },
  excludeRecent<T>(items: readonly T[], getId: (item: T) => string, recentIds: readonly string[], window: number): T[] {
    const recent = new Set(recentIds.slice(-window));
    const candidates = items.filter((item) => !recent.has(getId(item)));
    return candidates.length ? candidates : [...items];
  },
});
