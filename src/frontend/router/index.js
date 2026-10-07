import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    // 根路徑直接跳去 /admin，Dashboard 由外層 glassmorphism 主頁提供，
    // 避免 /admin#/ 出現多餘的內嵌 dashboard。
    path: '/',
    redirect: '/admin'
  },
  {
    path: '/admin',
    name: 'Admin',
    component: () => import('../views/admin/index.vue')
  },
  {
    path: '/server/:id',
    name: 'Server',
    component: () => import('../views/ServerDetail.vue')
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
