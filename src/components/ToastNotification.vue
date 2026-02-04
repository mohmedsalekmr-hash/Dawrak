<script setup lang="ts">
import { useToast } from '../composables/useToast'
const { isVisible, message, type } = useToast()
</script>

<template>
  <Transition name="toast">
    <div v-if="isVisible" class="fixed top-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-4 px-6 py-4 rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.12)] backdrop-blur-xl border border-white/50 min-w-[320px] max-w-[90vw] pointer-events-none"
      :class="{
        'bg-emerald-50/95 text-emerald-900 border-emerald-100': type === 'success',
        'bg-rose-50/95 text-rose-900 border-rose-100': type === 'error',
        'bg-slate-50/95 text-slate-900 border-slate-100': type === 'info'
      }"
    >
      <div class="shrink-0">
        <svg v-if="type === 'success'" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-emerald-500"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <svg v-else-if="type === 'error'" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-rose-500"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-slate-500 animate-pulse"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      </div>
      <span class="font-bold text-sm tracking-tight">{{ message }}</span>
    </div>
  </Transition>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, -40px) scale(0.9); }
</style>
