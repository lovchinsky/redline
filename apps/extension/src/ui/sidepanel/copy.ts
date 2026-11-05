import { STEP_FORMS, plural } from '../shared/copy';

/** All user-facing side panel text in one place, ready to move to chrome.i18n. */
export const PANEL_TEXT = {
  draftsLabel: 'Чернетка',
  newDraft: 'Нова чернетка',
  untitled: 'Без назви',
  emptyDraft: 'Порожня чернетка',
  titleLabel: 'Назва',
  titlePlaceholder: 'Назва задачі (необов’язково)',
  deleteDraft: 'Видалити чернетку',
  confirmDelete: 'Так, видалити',
  cancel: 'Скасувати',
  noActiveDraft: 'Нова чернетка з’явиться з першим кроком.',
  howToCapture: 'Відкрийте сторінку і натисніть Alt+Shift+A, щоб обвести область.',
  stepTitle: (index: number, intent: string) => `Крок ${String(index)} · ${intent}`,
  stepCount: (count: number) => `${String(count)} ${plural(count, STEP_FORMS)}`,
  moveUp: 'Вище',
  moveDown: 'Нижче',
  edit: 'Змінити',
  save: 'Зберегти',
  removeStep: 'Видалити крок',
  commentLabel: 'Коментар',
  preview: 'Переглянути пакет',
  previewing: 'Складаю пакет…',
  previewTitle: 'Що піде агенту',
  previewStale: 'Чернетка змінилась — складіть пакет ще раз.',
  files: 'Файли',
  loading: 'Завантажую…',
} as const;

export const formatBytes = (bytes: number): string =>
  bytes < 1024
    ? `${String(bytes)} Б`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} КБ`
      : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
