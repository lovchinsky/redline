export type ColumnId = 'todo' | 'doing' | 'done';

export interface Task {
  id: number;
  title: string;
  assignee: string;
  points: number;
  column: ColumnId;
  label?: 'bug' | 'feature' | 'chore';
}

export const initialTasks: Task[] = [
  {
    id: 1,
    title: 'Migrate billing webhooks to v2',
    assignee: 'RK',
    points: 5,
    column: 'todo',
    label: 'chore',
  },
  {
    id: 2,
    title: 'Search results flicker on slow networks',
    assignee: 'AM',
    points: 3,
    column: 'todo',
    label: 'bug',
  },
  {
    id: 3,
    title: 'Saved filters for the reports page',
    assignee: 'JS',
    points: 8,
    column: 'doing',
    label: 'feature',
  },
  { id: 4, title: 'Upgrade the date picker', assignee: 'RK', points: 2, column: 'done' },
];
