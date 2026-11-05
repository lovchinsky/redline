# Redline

Розширення для Chrome: обводиш область на сайті, пишеш коментар — задача з компактним
контекстом іде отримувачу, який перетворює її на зміну в коді.

Повна специфікація: [Redline — технічна специфікація розширення](https://claude.ai/artifact/CMBqno6diCwyvCitJiBD24).

## Структура

| Шлях                             | Роль                                                                    |
| -------------------------------- | ----------------------------------------------------------------------- |
| `packages/core`                  | Result, AppError, ids, схеми, порти. Без браузерних API                 |
| `packages/contract`              | Контракт з отримувачем: `bundle.v1`, `receiver-api.v1`                  |
| `packages/rpc`                   | Типізований RPC і події між контекстами розширення, протокол застосунку |
| `apps/extension/src/adapters`    | Єдине місце, де живуть `wxt/browser`, IndexedDB, console                |
| `apps/extension/src/application` | Обробники сценаріїв; залежать лише від портів                           |
| `apps/extension/src/composition` | Composition roots: збирають систему з адаптерів                         |
| `apps/extension/src/ui`          | Preact UI; отримує сервіси від composition root                         |
| `apps/extension/src/entrypoints` | Точки входу WXT: лише запускають composition root                       |

Межі між шарами перевіряють ESLint (`eslint-plugin-boundaries`) і dependency-cruiser.
`pnpm lint:boundaries:selftest` доводить, що правила справді спрацьовують на порушеннях.

## Команди

```bash
pnpm install
pnpm dev          # розширення з hot reload
pnpm build        # збірка в apps/extension/.output/chrome-mv3
pnpm check        # формат, lint, межі, типи, unit-тести
pnpm test:e2e     # збірка + Playwright з завантаженим розширенням
```

## Правила

- Нова залежність між шарами — спершу правило в `eslint.config.js`, потім код.
- Міграції IndexedDB лише додаються (`apps/extension/src/adapters/idb/schema.ts`).
- Нове RPC-повідомлення описується в `packages/rpc/src/protocol.ts`; обробник обов'язковий на рівні типів.
