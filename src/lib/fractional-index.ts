export const POSITION_STEP = 1024;
export const MIN_GAP = 0.001;

/**
 * Midpoint ("fractional") indexing: a drop only rewrites the moved row.
 * `needsRebalance` flags when precision is running out so the column can be
 * renumbered in a single batched UPDATE (rare, amortised O(1) per move).
 */
export function computeDropPosition(
  prevPosition: number | null,
  nextPosition: number | null
): { position: number; needsRebalance: boolean } {
  if (prevPosition === null && nextPosition === null) {
    return { position: POSITION_STEP, needsRebalance: false };
  }
  if (prevPosition === null) {
    const pos = nextPosition! / 2;
    return { position: pos, needsRebalance: pos < MIN_GAP };
  }
  if (nextPosition === null) {
    return { position: prevPosition + POSITION_STEP, needsRebalance: false };
  }
  if (nextPosition <= prevPosition) {
    throw new RangeError(`Invalid neighbours: prev=${prevPosition} next=${nextPosition}`);
  }
  const mid = (prevPosition + nextPosition) / 2;
  const gap = nextPosition - prevPosition;
  return { position: mid, needsRebalance: gap < MIN_GAP };
}

/** Evenly re-spaced positions for an ordered list of ids (used by rebalancing). */
export function rebalancePositions<T extends string>(orderedIds: readonly T[]): Map<T, number> {
  return new Map(orderedIds.map((id, i) => [id, (i + 1) * POSITION_STEP]));
}

/**
 * Given a column's tasks (sorted by position) with the dragged task removed,
 * compute the position for inserting at `index`.
 */
export function positionForIndex(
  sortedPositions: readonly number[],
  index: number
): { position: number; needsRebalance: boolean } {
  const prev = index > 0 ? sortedPositions[index - 1] ?? null : null;
  const next = index < sortedPositions.length ? sortedPositions[index] ?? null : null;
  return computeDropPosition(prev, next);
}
