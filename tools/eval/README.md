# tools/eval: anchor quality

The metric behind every change to anchor sources and rules: **the share of cases where one of
the top 5 anchors, searched verbatim (`grep -F`), finds only the file where the change
belongs.** The target is 80%; CI fails below it.

```bash
pnpm eval                 # every app, development and production builds
pnpm eval -- --app react-tailwind
```

The report (`.output/report.md`, also the CI job summary) breaks the metric down by framework,
styling, i18n and build mode, and lists every case with its anchors and the files they find.

## How a case is measured

1. The app in `corpus/<app>` is built with its framework's real toolchain (Vite with the React,
   Vue or Svelte plugin; Angular in JIT mode), once in development and once in production mode.
2. Chromium opens the build. A harness bundle (`src/harness`) circles the case's element with a
   rounded lasso, resolves the region with the same `EnclosureResolver` as the overlay, and runs
   the shipped anchors collector with the shipped profile's options.
3. Each of the top 5 anchors is searched in the app's sources. It solves the case when it
   matches at least one file and only files listed in the case's `expect`.

## The corpus

| App                     | Framework | Styling           | i18n |
| ----------------------- | --------- | ----------------- | ---- |
| `react-tailwind`        | React     | Tailwind          | no   |
| `react-cssmodules-i18n` | React     | CSS Modules       | yes  |
| `react-styled`          | React     | styled-components | no   |
| `vue-settings-i18n`     | Vue       | scoped CSS        | yes  |
| `svelte-kanban`         | Svelte    | scoped CSS        | no   |
| `angular-admin`         | Angular   | component styles  | no   |

Each app is written the way a team would write it, with no regard for Redline: some elements
have test ids, most do not; texts come from props, data arrays and locale files. `app.json`
lists the cases: a Playwright selector for what a person circles, and the files where that
change belongs (a reused component's file and the place its content is written both count).

Add a case or an app whenever a real page produced weak anchors; the metric only means
something while the corpus looks like real projects.
