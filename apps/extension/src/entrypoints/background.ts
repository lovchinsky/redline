import { defineBackground } from 'wxt/utils/define-background';
import { createBackgroundContainer } from '../composition/background.container';

export default defineBackground({
  type: 'module',
  main() {
    createBackgroundContainer().start();
  },
});
