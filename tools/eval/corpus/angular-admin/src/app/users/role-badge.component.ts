import { Component, Input } from '@angular/core';
import type { Role } from './user';

@Component({
  selector: 'app-role-badge',
  template: `<span class="badge" [class.badge-owner]="role === 'Owner'">{{ role }}</span>`,
  styles: `
    .badge {
      padding: 2px 8px;
      border-radius: 999px;
      background: #eef1f6;
      font-size: 12px;
    }
    .badge-owner {
      background: #fff4d6;
    }
  `,
})
export class RoleBadgeComponent {
  @Input({ required: true }) role!: Role;
}
