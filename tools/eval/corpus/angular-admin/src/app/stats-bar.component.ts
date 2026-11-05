import { Component } from '@angular/core';

interface Stat {
  label: string;
  value: number;
}

@Component({
  selector: 'app-stats-bar',
  template: `
    <dl class="stats">
      @for (stat of stats; track stat.label) {
        <div class="stat">
          <dt>{{ stat.label }}</dt>
          <dd>{{ stat.value }}</dd>
        </div>
      }
    </dl>
  `,
  styles: `
    .stats {
      display: flex;
      gap: 16px;
      margin: 0 0 24px;
    }
    .stat {
      flex: 1;
      padding: 12px 16px;
      border-radius: 8px;
      background: #fff;
    }
    dd {
      margin: 4px 0 0;
      font-size: 24px;
      font-weight: 600;
    }
  `,
})
export class StatsBarComponent {
  readonly stats: Stat[] = [
    { label: 'Seats used', value: 18 },
    { label: 'Pending invites', value: 3 },
    { label: 'Admins', value: 2 },
  ];
}
