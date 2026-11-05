import { render } from 'preact';
import { createUiContainer } from '../../composition/ui.container';
import { App } from '../../ui/sidepanel/App';
import '../../ui/shared/styles.css';

const root = document.getElementById('app');
if (root === null) throw new Error('Side panel root element #app is missing');
render(<App services={createUiContainer('sidepanel')} />, root);
