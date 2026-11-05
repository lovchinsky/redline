import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { startPageRuntimeInPage } from '../composition/page-runtime.container';

/** Built as /page-runtime.js; executed in the MAIN world, never declared in the manifest. */
export default defineUnlistedScript(() => {
  startPageRuntimeInPage();
});
