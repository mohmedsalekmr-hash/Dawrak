<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { supabase } from '../supabase'

const currentNumber = ref(0)
const lastIssued = ref(0)
const queueId = ref<number | null>(null)

async function loadInitialData() {
  const { data } = await supabase.from('queues').select('*').limit(1).maybeSingle()
  if (data) {
    queueId.value = data.id
    currentNumber.value = data.current_number ?? 0
    lastIssued.value = data.last_issued_number ?? 0
  }
}

onMounted(async () => {
  await loadInitialData()
  supabase.channel('display-realtime')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'queues' }, (payload) => {
      const row = payload.new as any
      currentNumber.value = row.current_number ?? 0
      lastIssued.value = row.last_issued_number ?? 0
    })
    .subscribe()
})
</script>

<template>
  <div class="fixed inset-0 bg-slate-900 flex flex-col items-center justify-center text-white overflow-hidden select-none font-['Poppins',sans-serif]">
    
    <!-- Large Background Accents -->
    <div class="absolute inset-0 pointer-events-none opacity-20">
      <div class="absolute top-[-20%] left-[-20%] w-[80%] h-[80%] bg-emerald-600 rounded-full blur-[200px] animate-pulse"></div>
      <div class="absolute bottom-[-20%] right-[-20%] w-[80%] h-[80%] bg-teal-600 rounded-full blur-[200px] animate-pulse" style="animation-delay: 1s"></div>
    </div>

    <!-- Main Content -->
    <div class="relative z-10 text-center scale-[1.5] md:scale-[2.5] lg:scale-[3.5]">
      <div class="text-[0.6rem] font-bold text-emerald-400 uppercase tracking-[0.5em] mb-4">Now Serving</div>
      <div class="text-[12rem] font-black leading-none tabular-nums tracking-tighter drop-shadow-2xl">
        {{ currentNumber }}
      </div>
      <div class="mt-8 flex items-center justify-center gap-12 text-slate-400 font-bold">
        <div class="flex flex-col items-center">
          <span class="text-[0.4rem] uppercase tracking-widest text-slate-500">Waitlist</span>
          <span class="text-2xl">{{ lastIssued - currentNumber }}</span>
        </div>
        <div class="w-px h-8 bg-slate-700"></div>
        <div class="flex flex-col items-center">
          <span class="text-[0.4rem] uppercase tracking-widest text-slate-500">Total Issued</span>
          <span class="text-2xl">{{ lastIssued }}</span>
        </div>
      </div>
    </div>

    <!-- Bottom Indicator -->
    <div class="absolute bottom-12 w-full flex justify-center px-12">
       <div class="w-full max-w-2xl h-1 bg-slate-800 rounded-full overflow-hidden">
          <div 
            class="h-full bg-emerald-500 transition-all duration-1000 ease-out"
            :style="`width: ${(currentNumber / Math.max(1, lastIssued)) * 100}%`"
          ></div>
       </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes pulse {
  0%, 100% { opacity: 0.2; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(1.1); }
}
.animate-pulse { animation: pulse 10s ease-in-out infinite; }
</style>
