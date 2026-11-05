# Chrome Web Store listing

Texts and answers for the store's dashboard. The name and the short description come from
`apps/extension/public/_locales/*/messages.json` (`extName`, `extDescription`); keep them in
sync when editing either.

## Package

Build and check the upload:

```bash
pnpm package
```

It produces `apps/extension/.output/redline-<version>-chrome.zip` and verifies it with
`scripts/verify-store-package.mjs`: manifest, localized texts and their length limits, icons,
permissions, and the absence of remote code.

## Store listing

**Category:** Developer Tools · **Languages:** English (default), Ukrainian

### Detailed description (English)

Redline turns "this looks wrong" into a task a coding agent can act on.

Circle an area on any page of your web app — or pick an element with the keyboard — and
describe the change in your own words. Redline collects what an agent needs to find the code
behind it: a screenshot of the area, searchable anchors (test ids, labels, texts, classes),
framework components, layout and styles, the relevant markup, and the errors and failed
requests on the page. Steps on several pages make one draft; you see exactly what will be sent
before sending it.

Tasks go to a receiver you set up (a service that hands them to your agent and opens the
change). Redline shows the task's status and the agent's questions, and you answer right in
the side panel.

- Works on existing sites: nothing to install or change in your project.
- Private by default: field values are never read, password and card fields are blanked out on
  screenshots, and collected text is scrubbed of tokens and e-mail addresses.
- Access to a site is asked for only when you bind it to a project.

### Detailed description (Ukrainian)

Redline перетворює «тут щось не так» на задачу, з якою може працювати агент.

Обведіть область на будь-якій сторінці свого вебзастосунку або оберіть елемент з клавіатури й
опишіть правку своїми словами. Redline збирає те, що агенту потрібно, щоб знайти відповідний
код: знімок області, якорі для пошуку (test id, підписи, тексти, класи), компоненти фреймворку,
розкладку і стилі, потрібну розмітку, а також помилки й невдалі запити на сторінці. Кроки на
кількох сторінках складаються в одну чернетку; перед надсиланням видно, що саме піде агенту.

Задачі надходять до отримувача, якого ви налаштували (сервіс, що передає їх агенту й готує
зміни). Redline показує статус задачі та запитання агента, на які можна відповісти просто в
бічній панелі.

## Privacy practices

**Single purpose:** describe changes to a web page by circling them, and send the description
with page context to a receiver the user configured.

### Permission justifications

| Permission                                        | Why                                                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `activeTab`                                       | Capture runs only on the tab where the user invoked it (shortcut, toolbar, menu).                               |
| `scripting`                                       | Injects the capture overlay into that tab, and the page probe that reads framework components and errors.       |
| `sidePanel`                                       | Drafts, preview and task status live in the side panel.                                                         |
| `contextMenus`                                    | "Circle an area" in the page's context menu.                                                                    |
| `storage`                                         | Receiver settings, site bindings and the local Diagnostics journal.                                             |
| `alarms`                                          | Retries a delivery and checks a task's status when it is due, also after the browser restarts.                  |
| `notifications`                                   | Tells the user when the agent asks a question or the result is ready.                                           |
| Optional host access (`https://*/*`, `localhost`) | Asked per site when the user binds it to a project, and for the receiver's address. Never requested at install. |

### Remote code

No. All code is in the package; the receiver only gets data.

### Data usage

Redline handles **website content** (screenshots, markup and text of the circled areas) and
**web history** (URLs of the pages where steps were captured), only when the user captures a
step, and sends them only to the receiver the user configured. See
[privacy-policy.md](privacy-policy.md).

- Not sold to third parties.
- Not used or transferred for purposes unrelated to the single purpose.
- Not used or transferred to determine creditworthiness or for lending.
