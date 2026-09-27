import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Smart Splitter — split any bill fairly',
    loadComponent: () => import('./pages/landing').then((m) => m.LandingPage),
  },
  {
    path: 'b/:code/review',
    title: 'Check the bill · Smart Splitter',
    loadComponent: () => import('./pages/review').then((m) => m.ReviewPage),
  },
  {
    path: 'b/:code',
    title: 'Bill room · Smart Splitter',
    loadComponent: () => import('./pages/bill-room').then((m) => m.BillRoomPage),
  },
  {
    path: 'j/:code',
    title: 'Join a split · Smart Splitter',
    loadComponent: () => import('./pages/join').then((m) => m.JoinPage),
  },
  {
    path: '**',
    title: 'Not found · Smart Splitter',
    loadComponent: () => import('./pages/not-found').then((m) => m.NotFoundPage),
  },
];
