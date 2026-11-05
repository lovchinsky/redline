import { startComposer } from '../../composition/composer.container';
import '../../ui/overlay/composer.css';

const root = document.getElementById('app');
if (root === null) throw new Error('Composer root element #app is missing');
startComposer(root);
