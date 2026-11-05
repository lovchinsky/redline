import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  // Explicit imports only: dependencies stay visible to the boundary linter.
  imports: false,
  manifest: {
    name: 'Redline',
    description: 'Обведи область на сайті, опиши правку — і відправ задачу агенту.',
    permissions: ['sidePanel'],
    action: { default_title: 'Redline' },
  },
  vite: () => ({
    plugins: [preact()],
  }),
});
