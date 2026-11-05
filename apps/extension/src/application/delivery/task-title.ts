import type { Task } from '@redline/core';

const MAX = 80;

/** How a task is named outside the side panel: its title, or the first step's comment. */
export const taskTitleOf = (task: Task): string => {
  const text = task.title ?? task.steps[0]?.comment.split('\n')[0] ?? 'Redline';
  return text.length > MAX ? `${text.slice(0, MAX - 1)}…` : text;
};
