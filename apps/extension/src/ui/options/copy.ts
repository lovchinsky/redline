/** All user-facing options page text in one place, ready to move to chrome.i18n. */
export const OPTIONS_TEXT = {
  title: 'Налаштування Redline',
  receiverTitle: 'Отримувач',
  receiverHint:
    'Сервіс, який перетворює задачі на зміни в коді. Redline надсилає йому пакет і показує статус.',
  url: 'Адреса',
  urlPlaceholder: 'https://receiver.example.com',
  token: 'Токен доступу',
  tokenKept: 'Збережено — залиште порожнім, щоб не змінювати',
  tokenNone: 'Необов’язково',
  save: 'Зберегти',
  saved: 'Збережено',
  check: 'Перевірити',
  clear: 'Від’єднати',
  projectsFound: (count: number) => `Отримувач на зв’язку, проєктів: ${String(count)}`,
  bindingsTitle: 'Сайти і проєкти',
  bindingsHint:
    'Задачі з цих сайтів ідуть у вказаний проєкт. Шаблон: https://app.acme.io, https://*.acme.io або http://localhost:3000/admin.',
  noBindings: 'Поки немає. Сайт запам’ятовується, коли ви вперше надсилаєте з нього задачу.',
  pattern: 'Сайт',
  project: 'Проєкт',
  chooseProject: 'Оберіть проєкт',
  add: 'Додати',
  remove: 'Прибрати',
  permissionDenied: 'Доступ до сайту не надано — без нього Redline не зможе надсилати запити.',
} as const;
