import { Component, computed, signal } from '@angular/core';
import template from './users-table.component.html?raw';
import { RoleBadgeComponent } from './role-badge.component';
import { USERS } from './user';

@Component({
  selector: 'app-users-table',
  imports: [RoleBadgeComponent],
  template,
  styles: `
    .card {
      border-radius: 8px;
      background: #fff;
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px;
    }
    .search {
      width: 240px;
      padding: 6px 10px;
    }
    .users {
      width: 100%;
      border-collapse: collapse;
    }
    .users td,
    .users th {
      padding: 10px 16px;
      border-top: 1px solid #eceef1;
      text-align: left;
    }
    .email {
      color: #6a737d;
      font-size: 13px;
    }
    .pagination {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: flex-end;
      padding: 12px 16px;
    }
  `,
})
export class UsersTableComponent {
  readonly users = USERS;
  readonly query = signal('');
  readonly visible = computed(() => {
    const query = this.query().toLowerCase();
    return this.users.filter(
      (user) => user.name.toLowerCase().includes(query) || user.email.includes(query),
    );
  });
}
