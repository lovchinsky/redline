# Redline task

## Step 1

> Rename "Most popular" to "Best value"

**Page:** `/pricing` — Pricing — Acme (`https://staging.acme.io/pricing?ref=nav`)  
**Viewport:** 1280×800 @2x · light · dev server · lang en

### Area 1

**Circled:** `span.badge`  
**Container:** `article[data-testid=plan-card]`  
**Next to:** `h3`, `p.price`, `button`

![Circled area](assets/step-1/area-1-crop.png)  
[Whole viewport with the circled area](assets/step-1/area-1-overview.webp)

**Anchors** (strings likely present in the source code, best first):

- `data-testid="plan-card"` on `article[data-testid=plan-card]`
- text `Most popular` on `span.badge`
- class `badge` on `span.badge`
- class `card` on `article[data-testid=plan-card]`
- class `root` on `article[data-testid=plan-card]`

**Layout of `article[data-testid=plan-card]`:** `display: block; overflow: hidden`

| # | Child | Box (x, y, w×h) | Circled |
| --- | --- | --- | --- |
| 1 | `h3` | 17, 17, 186×28 |  |
| 2 | `span.badge` | 17, 53, 186×20 | yes |
| 3 | `p.price` | 17, 73, 186×24 |  |
| 4 | `button` | 17, 105, 62×32 |  |

**Computed styles:**

- `span.badge`: `width: 186px; height: 20px; box-sizing: border-box; display: block`

**CSS rules for `span.badge`** (weakest first, by specificity and then order; `@layer` and `!important` not weighed):

- `.badge` — `<style>` in the page: `display: block; height: 20px;`

**DOM of `article[data-testid=plan-card]`:** [details/step-1/area-1-dom.html](details/step-1/area-1-dom.html) — circled elements carry `data-redline="selected"`.
