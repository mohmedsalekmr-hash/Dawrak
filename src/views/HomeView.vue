<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { supabase } from '../supabase'
import { useLocalStorage } from '@vueuse/core'

import { useSound } from '@vueuse/sound'
import notificationSound from '../assets/notification_sound.mp3'

/** State */
const currentNumber = ref(0)
const lastIssued = ref(0)
const queueId = ref<number | null>(null)
const myTicket = useLocalStorage<number | null>('dawrak-ticket', null)
const isLoading = ref(false)

const { play } = useSound(notificationSound)

/** Realtime */
onMounted(async () => {
  // Initial fetch or Create
  let { data } = await supabase
    .from('queues')
    // We expect only one active queue for this demo
    .select('*')
    .limit(1)
    .maybeSingle()
  
  if (!data) {
    // Create initial queue if not exists
    const res = await supabase.from('queues').insert({ name: 'Default Queue', current_number: 0, last_issued_number: 0 }).select().single()
    if (res.data) data = res.data
  }

  if (data) {
    queueId.value = data.id
    currentNumber.value = data.current_number ?? 0
    lastIssued.value = data.last_issued_number ?? 0
  }

  // Subscribe
  supabase
    .channel('queues')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'queues' }, (payload) => {
      const newRow = payload.new as any
      // Assuming we only care about this queue
      if (queueId.value && newRow.id === queueId.value) {
        if((newRow.current_number ?? 0) > currentNumber.value) {
           play()
        }
        currentNumber.value = newRow.current_number ?? 0
        lastIssued.value = newRow.last_issued_number ?? 0
      }
    })
    .subscribe()
})

/** Actions */
async function getTicket() {
  if (!queueId.value) return
  isLoading.value = true
  
  const { data, error } = await supabase.rpc('next_ticket', { queue_id: queueId.value })
  
  if (data) {
    myTicket.value = data
  } else {
    console.error('Error getting ticket:', error)
    alert('حدث خطأ أثناء حجز التذكرة. الرجاء المحاولة مرة أخرى.')
  }
  isLoading.value = false
}

function cancelTicket() {
  if (confirm('هل أنت متأكد من إلغاء التذكرة؟')) {
    myTicket.value = null
  }
}

/** Computed */
const peopleAhead = computed(() => {
  if (!myTicket.value) return 0
  // If my ticket is 10, and current is 5 (serving), then 6,7,8,9 are ahead (4 people).
  // 10 - 5 - 1 = 4.
  return Math.max(0, myTicket.value - currentNumber.value - 1)
})

const isMyTurn = computed(() => myTicket.value !== null && myTicket.value <= currentNumber.value)
const isPast = computed(() => myTicket.value !== null && myTicket.value < currentNumber.value)
</script>

<template>
  <div class="min-h-screen bg-dignified-green text-white font-sans flex items-center justify-center p-4 relative overflow-hidden" dir="rtl">
    <!-- Background Effects -->
    <div class="absolute inset-0 bg-gradient-to-br from-emerald-950 via-dignified-green to-emerald-900"></div>
    <!-- Glowing Orbs -->
    <div class="absolute -top-[20%] -right-[20%] w-[80%] pt-[80%] bg-emerald-500 rounded-full blur-[150px] opacity-20 animate-pulse-slow"></div>
    <div class="absolute -bottom-[20%] -left-[20%] w-[80%] pt-[80%] bg-white rounded-full blur-[150px] opacity-10 animate-pulse-slow delay-1000"></div>

    <!-- Main Card -->
    <div class="relative w-full max-w-sm bg-white/10 backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-8 shadow-2xl shadow-emerald-950/50 overflow-hidden flex flex-col items-center text-center ring-1 ring-white/20">
      
      <!-- Logo / Header -->
      <div class="mb-8 w-full flex flex-col items-center">
        <!-- Logo Emblem -->
        <div class="w-14 h-14 bg-gradient-to-tr from-white to-emerald-50 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-900/20 mb-4 transform hover:scale-105 transition-transform duration-500">
           <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-dignified-green"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"></path></svg>
        </div>
        <h1 class="text-xl font-bold text-white tracking-wide opacity-90">نظام دورك</h1>
      </div>

      <!-- Current Number Display -->
      <div class="mb-10 w-full relative group">
        <div class="absolute inset-0 bg-emerald-500/20 blur-2xl rounded-full opacity-0 group-hover:opacity-50 transition-opacity duration-700"></div>
        <p class="text-emerald-200/80 text-xs font-semibold mb-2 uppercase tracking-widest">الرقم الحالي</p>
        <div class="text-[7rem] leading-none font-black text-white dropshadow-glow tabular-nums tracking-tighter transition-all duration-300 transform group-hover:scale-105">
          {{ currentNumber }}
        </div>
      </div>

      <!-- Action Area -->
      <div class="w-full z-10">
        <!-- State: No Ticket -->
        <div v-if="myTicket === null" class="animate-fade-in-up space-y-4">
           <button 
             @click="getTicket" 
             :disabled="isLoading"
             class="relative w-full group overflow-hidden bg-white text-dignified-green p-4 rounded-2xl shadow-lg hover:shadow-emerald-500/20 transition-all duration-300 active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed"
           >
             <div class="absolute inset-0 bg-emerald-50 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
             <span class="relative z-10 text-xl font-bold flex items-center justify-center gap-3">
               <span v-if="isLoading" class="animate-spin inline-block h-5 w-5 border-2 border-current border-t-transparent rounded-full"></span>
               <span v-else>احصل على رقمك الآن</span>
             </span>
           </button>
           
           <div class="flex items-center justify-center gap-2 text-emerald-200/60 text-xs font-medium bg-black/10 py-2 px-4 rounded-full w-fit mx-auto backdrop-blur-sm">
             <span>المنتظرين الآن:</span>
             <span class="text-white font-bold">{{ Math.max(0, lastIssued - currentNumber) }}</span>
           </div>
        </div>

        <!-- State: Has Ticket -->
        <div v-else class="animate-fade-in-up">
          <div class="bg-gradient-to-b from-white/10 to-transparent rounded-3xl p-1 border border-white/10 mb-6">
            <div class="bg-black/20 rounded-[1.3rem] p-6 backdrop-blur-md">
              <p class="text-emerald-200/80 text-xs mb-1 font-medium">رقم تذكرتك</p>
              <div class="text-5xl font-black text-white mb-5 tracking-tight">{{ myTicket }}</div>
              
              <!-- Status Box -->
              <div v-if="isMyTurn" class="bg-gradient-to-r from-emerald-500 to-emerald-400 text-white py-3 px-4 rounded-xl font-bold animate-pulse shadow-lg shadow-emerald-500/20 border border-white/20">
                 ✨ <span>حان دورك الآن!</span>
                 <p class="text-xs font-normal opacity-90 mt-1">تفضل بالدخول</p>
              </div>
              <div v-else-if="isPast" class="bg-red-500/20 text-red-100 py-3 px-4 rounded-xl font-bold border border-red-500/30">
                 ⚠️ <span>فات دورك</span>
                 <p class="text-xs font-normal opacity-80 mt-1 cursor-pointer hover:underline" @click="myTicket = null">اضغط هنا لأخذ رقم جديد</p>
              </div>
              <div v-else class="flex items-center justify-between bg-white/5 rounded-xl p-3 border border-white/5">
                 <div class="text-right">
                   <p class="text-[0.65rem] text-emerald-200/70">أمامك</p>
                   <p class="text-xl font-bold text-white leading-none mt-1">{{ peopleAhead }}</p>
                 </div>
                 <div class="h-8 w-[1px] bg-white/10"></div>
                 <div class="text-left">
                   <p class="text-[0.65rem] text-emerald-200/70">زمن الانتظار</p>
                   <p class="text-sm font-bold text-white leading-none mt-1 dir-ltr">~{{ peopleAhead * 5 }} د</p>
                 </div>
              </div>
            </div>
          </div>
          
          <button @click="cancelTicket" class="text-emerald-400/80 text-xs hover:text-white transition-colors hover:underline decoration-emerald-400/30 font-medium py-2">
            إلغاء وحذف الحجز
          </button>
        </div>
      </div>
    </div>
    
    <!-- Footer Credits -->
    <div class="absolute bottom-6 flex flex-col items-center gap-1 opacity-30 text-[10px] tracking-[0.2em] font-light text-emerald-100 uppercase pointer-events-none">
      <span>Powered by</span>
      <span class="font-bold">Dawrak</span>
    </div>

  </div>
</template>

<style scoped>
.dropshadow-glow {
  text-shadow: 0 4px 20px rgba(0,0,0,0.2);
}
.animate-pulse-slow {
  animation: pulse 8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.2; transform: scale(1); }
  50% { opacity: 0.15; transform: scale(1.1); }
}
.animate-fade-in-up {
  animation: fadeInUp 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
}
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
