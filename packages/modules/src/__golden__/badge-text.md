# Redline task

## Step 1 · Text

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
- class `Card_root` on `article[data-testid=plan-card]`
