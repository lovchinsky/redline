import { render } from 'preact';
import { createUiContainer } from '../../composition/ui.container';
import { OptionsApp } from '../../ui/options/OptionsApp';
import '../../ui/shared/styles.css';

const root = document.getElementById('app');
if (root === null) throw new Error('Options root element #app is missing');
render(<OptionsApp services={createUiContainer('options')} />, root);
