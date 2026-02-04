import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import AdminView from '../views/AdminView.vue'
import DisplayView from '../views/DisplayView.vue'

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: [
        {
            path: '/',
            name: 'home',
            component: HomeView
        },
        {
            path: '/admin',
            name: 'admin',
            component: AdminView
        },
        {
            path: '/display',
            name: 'display',
            component: DisplayView
        }
    ]
})

export default router
