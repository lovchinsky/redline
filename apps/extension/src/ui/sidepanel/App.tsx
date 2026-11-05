import type { UiServices } from '../services';
import { ConnectionStatus } from './ConnectionStatus';
import { DraftsPanel } from './DraftsPanel';

export const App = ({ services }: { services: UiServices }) => (
  <main>
    <header>
      <h1>Redline</h1>
    </header>
    <DraftsPanel services={services} />
    <ConnectionStatus services={services} />
  </main>
);
