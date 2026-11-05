import { Component } from '@angular/core';
import { StatsBarComponent } from './stats-bar.component';
import { UsersTableComponent } from './users/users-table.component';
import { InviteFormComponent } from './invite/invite-form.component';

@Component({
  selector: 'app-root',
  imports: [StatsBarComponent, UsersTableComponent, InviteFormComponent],
  template: `
    <div class="page">
      <h1>Team members</h1>
      <app-stats-bar />
      <div class="layout">
        <app-users-table />
        <app-invite-form />
      </div>
    </div>
  `,
  styles: `
    .layout {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 24px;
      align-items: start;
    }
  `,
})
export class AppComponent {}
