export function v75WeightedWithoutReplacement<T extends { id: string }>(pool: T[], count: number, score: (item: T) => number): T[];
