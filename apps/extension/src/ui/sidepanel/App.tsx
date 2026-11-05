import type { UiServices } from '../services';
import { ConnectionStatus } from './ConnectionStatus';

export const App = ({ services }: { services: UiServices }) => (
  <main>
    <header>
      <h1>Redline</h1>
    </header>
    <ConnectionStatus services={services} />
  </main>
);
