# Redline privacy policy

_Last updated: 5 November 2026_

Redline is a browser extension for describing changes to web pages. This policy explains what
it handles, where it goes, and what stays on your device.

## What Redline collects, and when

Only when you capture a step (circle an area or pick an element), Redline collects from that
page:

- a screenshot of the visible part of the page and crops of the circled areas;
- the address and title of the page;
- the markup, text, layout and styles of the circled elements and their surroundings;
- the names and source locations of framework components, where the page exposes them;
- JavaScript errors and failed network requests seen on the page.

Before anything is stored, Redline:

- never reads the values of form fields;
- blanks out password and payment card fields on screenshots;
- removes access tokens, keys, e-mail addresses and similar secrets from collected text and
  addresses.

## Where it goes

Captured steps stay in your browser (IndexedDB) until you send the task. When you send it,
the task goes **only** to the receiver whose address you entered in the settings, over HTTPS
(or HTTP on `localhost`). Redline has no servers of its own and sends nothing to its authors.

Your receiver's access token is kept in the browser's local extension storage and is sent only
to that receiver.

## Diagnostics

Redline keeps a local journal of recent captures: which collectors ran, how long they took and
how they ended, with the page's address. It never leaves your browser unless you export it
yourself. There is no telemetry.

## Deleting your data

Delete a draft or task in the side panel to remove it and its captured context. Clear the
Diagnostics journal in the settings. Removing the extension deletes everything it stored.

## Contact

Questions about this policy: open an issue at https://github.com/lovchinsky/redline/issues.
