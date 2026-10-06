import { createRouter, createWebHashHistory } from 'vue-router'
import { installNavigationMotion, pageScrollBehavior } from './navigation-motion'

export const router = createRouter({
  history: createWebHashHistory(),
  scrollBehavior: pageScrollBehavior,
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/server/:id',
      name: 'server-detail',
      component: () => import('@/views/ServerDetailView.vue'),
    },
    {
      path: '/settings',
      name: 'theme-settings',
      component: () => import('@/views/ThemeSettingsView.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

installNavigationMotion(router)
