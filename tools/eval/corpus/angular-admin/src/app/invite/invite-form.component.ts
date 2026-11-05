import { Component } from '@angular/core';
import template from './invite-form.component.html?raw';

@Component({
  selector: 'app-invite-form',
  template,
  styles: `
    .invite {
      display: grid;
      gap: 12px;
      padding: 16px;
      border-radius: 8px;
      background: #fff;
    }
    label {
      display: grid;
      gap: 4px;
    }
    .hint {
      margin: 0;
      color: #6a737d;
    }
  `,
})
export class InviteFormComponent {}
