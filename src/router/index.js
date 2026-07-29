import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  {
    path: '/',
    component: () => import('@/layouts/main/MainLayout.vue'),
    name: 'workspace',
    children: [
      {
        path: '',
        component: () => import('@/views/home/HomeView.vue'),
        name: 'home',
      },
    ],
  },
];
const router = createRouter({
  history: createWebHistory(process.env.BASE_URL),
  routes,
});

export default router;
