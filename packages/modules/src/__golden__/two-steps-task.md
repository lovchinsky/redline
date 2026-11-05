# Redline task

## Step 1

> Make the three plan cards equal height

**Page:** `/pricing` — Pricing — Acme (`https://staging.acme.io/pricing?ref=nav`)  
**Viewport:** 1280×800 @2x · light · dev server · lang en

### Area 1

**Circled:** `article[data-testid=plan-card]` ×3  
**Container:** `section[data-testid=plans]`  
**Next to:** `pricing-contact.enterprise`

![Circled area](assets/step-1/area-1-crop.png)  
[Whole viewport with the circled area](assets/step-1/area-1-overview.webp)

**Anchors** (strings likely present in the source code, best first):

- `data-testid="plans"` on `section[data-testid=plans]`
- `data-testid="plan-card"` on `article[data-testid=plan-card]`
- text `Basic` on `h3`
- class `plans` on `section[data-testid=plans]`
- class `card` on `article[data-testid=plan-card]`
- class `root` on `article[data-testid=plan-card]`
- class `price` on `p.price`
- text `Choose` on `button`

**Layout of `section[data-testid=plans]`:** `display: flex; align-items: flex-start; gap: 24px`

| # | Child | Box (x, y, w×h) | Circled |
| --- | --- | --- | --- |
| 1 | `article[data-testid=plan-card]` | 0, 0, 220×200 | yes |
| 2 | `article[data-testid=plan-card]` | 244, 0, 220×200 | yes |
| 3 | `article[data-testid=plan-card]` | 488, 0, 220×200 | yes |
| 4 | `pricing-contact.enterprise` | 732, 0, 220×200 |  |

**Computed styles:**

- `article[data-testid=plan-card]`: `width: 220px; height: 200px; box-sizing: border-box; padding: 16px; border: 1px solid rgb(204, 204, 204); display: block`

**CSS rules for `article[data-testid=plan-card]`** (in source order, later rules win):

- `.card` — `<style>` in the page: `display: block; width: 220px; height: 200px; padding: 16px; border: 1px solid rgb(204, 204, 204); overflow: hidden;`

**DOM of `section[data-testid=plans]`:** [details/step-1/area-1-dom.html](details/step-1/area-1-dom.html) — circled elements carry `data-redline="selected"`.

## Step 2

> Rename "Most popular" to "Best value"

_Page: same as Step 1._

### Area 1

**Circled:** `span.badge`  
**Container:** `article[data-testid=plan-card]`  
**Next to:** `h3`, `p.price`, `button`

![Circled area](assets/step-2/area-1-crop.png)  
[Whole viewport with the circled area](assets/step-2/area-1-overview.webp)

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

**CSS rules for `span.badge`** (in source order, later rules win):

- `.badge` — `<style>` in the page: `display: block; height: 20px;`

**DOM of `article[data-testid=plan-card]`:** [details/step-2/area-1-dom.html](details/step-2/area-1-dom.html) — circled elements carry `data-redline="selected"`.
