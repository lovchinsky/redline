export type Role = 'Owner' | 'Admin' | 'Member';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  lastActive: string;
}

export const USERS: User[] = [
  {
    id: 1,
    name: 'Priya Raman',
    email: 'priya@acme.io',
    role: 'Owner',
    lastActive: '2 minutes ago',
  },
  { id: 2, name: 'Tomás Herrera', email: 'tomas@acme.io', role: 'Admin', lastActive: 'yesterday' },
  { id: 3, name: 'Mei Lin', email: 'mei@acme.io', role: 'Member', lastActive: '3 days ago' },
  { id: 4, name: 'Jonas Becker', email: 'jonas@acme.io', role: 'Member', lastActive: 'last week' },
];
