import { mount } from './harness';

/** A pricing page with explicit sizes, so layout numbers are identical on every machine. */
export const mountPricing = (): void => {
  mount(
    `<header class="top"><nav class="menu"><a href="/">Home</a><a href="/pricing">Pricing</a></nav></header>
     <main class="page">
       <h1 class="css-1x2y3z title">Choose your plan</h1>
       <section class="plans flex gap-6" data-testid="plans">
         <article class="card Card_root__a8F3x" data-testid="plan-card">
           <h3>Basic</h3><p class="price">$9</p><button type="button">Choose</button></article>
         <article class="card Card_root__a8F3x" data-testid="plan-card">
           <h3>Pro</h3><span class="badge">Most popular</span><p class="price">$29</p>
           <button type="button">Choose</button></article>
         <article class="card Card_root__a8F3x" data-testid="plan-card">
           <h3>Team</h3><p class="price">$99</p><button type="button">Choose</button></article>
         <pricing-contact class="enterprise"><h3>Enterprise</h3><a href="/contact">Talk to sales</a></pricing-contact>
       </section>
     </main>`,
    `.top { height: 64px; padding: 16px 32px; }
     .menu a { margin-right: 16px; }
     .page { padding: 0 32px; }
     .title { height: 48px; margin: 0 0 16px; font-size: 32px; }
     .plans { display: flex; gap: 24px; align-items: flex-start; }
     .card, .enterprise { display: block; width: 220px; height: 200px; padding: 16px; border: 1px solid #ccc; overflow: hidden; }
     .card h3, .enterprise h3 { height: 28px; margin: 0 0 8px; }
     .price { height: 24px; margin: 0 0 8px; }
     .badge { display: block; height: 20px; }
     button { height: 32px; }`,
  );
};
