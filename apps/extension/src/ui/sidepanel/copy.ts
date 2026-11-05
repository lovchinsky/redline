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
  downloadZip: 'Завантажити .zip',
  tabDraft: 'Чернетка',
  tabActive: 'В роботі',
  tabHistory: 'Історія',
  sendTitle: 'Надіслати агенту',
  project: 'Проєкт',
  chooseProject: 'Оберіть проєкт',
  sendTo: (project: string) => `Надіслати в «${project}»`,
  sending: 'Надсилаю…',
  bindHint: (sites: string) => `Сайт ${sites} запам’ятається для цього проєкту.`,
  conflict: 'Кроки належать до різних проєктів. Розділіть їх на окремі чернетки.',
  noReceiver: 'Отримувача не налаштовано.',
  openSettings: 'Налаштування',
  noTasks: 'Тут з’являться надіслані задачі.',
  noHistory: 'Тут з’являться завершені задачі.',
  retry: 'Спробувати зараз',
  retrySend: 'Надіслати ще раз',
  reopen: 'Повернути в чернетки',
  refresh: 'Оновити статус',
  deleteTask: 'Видалити',
  openResult: 'Відкрити результат',
  answerLabel: 'Ваша відповідь',
  answer: 'Відповісти',
} as const;

export const STATE_TEXT = {
  queued: 'У черзі на відправку',
  retryAt: (time: string, reason: string) => `Не вдалося: ${reason}. Повтор о ${time}`,
  failed: (reason: string) => `Отримувач не прийняв задачу: ${reason}`,
  remote: {
    queued: 'Отримувач прийняв задачу',
    working: 'Агент працює',
    'needs-input': 'Агент чекає на відповідь',
    'result-ready': 'Готово',
    failed: 'Агент не впорався',
    closed: 'Закрито',
  },
} as const;

export const formatTime = (time: number): string =>
  new Date(time).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' });

export const formatBytes = (bytes: number): string =>
  bytes < 1024
    ? `${String(bytes)} Б`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} КБ`
      : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
