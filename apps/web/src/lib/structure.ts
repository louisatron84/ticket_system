// How a ticket's parts and blockers are put into words and shapes on screen.

import type { Progress } from '@forge/shared';

export type ProgressBucket = keyof Progress;

/** In the order the bar draws them: finished work first, then what is moving, stuck, waiting. */
const BUCKETS: { bucket: ProgressBucket; label: string }[] = [
  { bucket: 'completed', label: 'Quenched' },
  { bucket: 'inProgress', label: 'In progress' },
  { bucket: 'jammed', label: 'Jammed' },
  { bucket: 'notStarted', label: 'Not started' },
];

export const totalOf = (progress: Progress) =>
  progress.completed + progress.inProgress + progress.jammed + progress.notStarted;

/** The non-empty parts of a progress bar, each with its share of the whole. */
export function progressSegments(
  progress: Progress,
): { bucket: ProgressBucket; label: string; count: number; percent: number }[] {
  const total = totalOf(progress);
  return BUCKETS.flatMap(({ bucket, label }) =>
    progress[bucket] > 0
      ? [{ bucket, label, count: progress[bucket], percent: (progress[bucket] / total) * 100 }]
      : [],
  );
}

/** "3 of 7 quenched". */
export const progressSummary = (progress: Progress) =>
  `${progress.completed} of ${totalOf(progress)} quenched`;

/** "Blocked by A", "Blocked by A and B", "Blocked by A, B and C"; empty when nothing blocks it. */
export function blockedLine(keys: string[]): string {
  if (keys.length === 0) return '';
  const list = keys.length === 1 ? keys[0] : `${keys.slice(0, -1).join(', ')} and ${keys.at(-1)}`;
  return `Blocked by ${list}`;
}
