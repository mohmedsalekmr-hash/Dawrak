<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { supabase } from '../supabase'
import { useLocalStorage } from '@vueuse/core'
import { useSound } from '@vueuse/sound'
import logoUrl from '../assets/logo.png'

/** State Management - Keeping existing project logic intact */
const currentNumber = ref(0)
const lastIssued = ref(0)
const queueId = ref<number | null>(null)
const myTicket = useLocalStorage<number | null>('dawrak-ticket', null)
const isLoading = ref(false)
const showCelebration = ref(false)

// Sound triggers (Banking notification style)
const notificationSound = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'
const { play } = useSound(notificationSound)

/** Realtime & Initialization */
onMounted(async () => {
  let { data } = await supabase
    .from('queues')
    .select('*')
    .limit(1)
    .maybeSingle()
  
  if (!data) {
    const res = await supabase.from('queues').insert({ name: 'Default Queue', current_number: 0, last_issued_number: 0 }).select().single()
    if (res.data) data = res.data
  }

  if (data) {
    queueId.value = data.id
    currentNumber.value = data.current_number ?? 0
    lastIssued.value = data.last_issued_number ?? 0
  }

  supabase
    .channel('queues')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'queues' }, (payload) => {
      const newRow = payload.new as any
      if (queueId.value && newRow.id === queueId.value) {
        // Trigger sound only if serving number actually increases
        if((newRow.current_number ?? 0) > currentNumber.value) {
           play()
        }
        currentNumber.value = newRow.current_number ?? 0
        lastIssued.value = newRow.last_issued_number ?? 0
      }
    })
    .subscribe()
})

/** Core Actions */
async function getTicket() {
  if (!queueId.value) return
  isLoading.value = true
  
  const { data, error } = await supabase.rpc('next_ticket', { queue_id: queueId.value })
  
  if (data) {
    myTicket.value = data
    showCelebration.value = true
    setTimeout(() => showCelebration.value = false, 3000)
  } else {
    console.error('Error getting ticket:', error)
  }
  isLoading.value = false
}

function cancelTicket() {
  if (confirm('هل أنت متأكد من إلغاء تذكرتك؟')) {
    myTicket.value = null
  }
}

/** Computed Properties */
const peopleAhead = computed(() => {
  if (!myTicket.value) return 0
  return Math.max(0, myTicket.value - currentNumber.value - 1)
})

const isMyTurn = computed(() => myTicket.value !== null && myTicket.value <= currentNumber.value)
const isFinished = computed(() => myTicket.value !== null && myTicket.value < currentNumber.value)
</script>

<template>
  <div class="min-h-screen bg-[#fcfdfd] flex flex-col items-center justify-start px-6 pt-12 pb-32 font-sans selection:bg-emerald-100" dir="rtl">
    
    <!-- Header Branding -->
    <header class="w-full max-w-lg mb-12 flex flex-col items-center animate-in slide-in-from-top duration-700">
      <div class="p-4 bg-white rounded-3xl shadow-sm border border-emerald-50 mb-4 transition-transform hover:scale-105">
        <img :src="logoUrl" alt="Logo" class="h-12 w-auto object-contain" />
      </div>
      <h1 class="text-xl font-black text-emerald-900 tracking-tight">نظام دورك الذكي</h1>
      <p class="text-[0.65rem] font-bold text-emerald-600/50 uppercase tracking-[0.4em] mt-2">النظام والارتقاء في الخدمة</p>
    </header>

    <!-- Main Live Queue Display -->
    <div class="w-full max-w-lg relative z-10">
      
      <!-- Current Serving Card -->
      <div class="bg-white rounded-[3rem] p-12 shadow-[0_40px_80px_-15px_rgba(6,78,59,0.08)] border border-emerald-50 flex flex-col items-center relative overflow-hidden mb-12 group">
        <div class="absolute top-0 left-0 w-full h-1.5 bg-emerald-600"></div>
        
        <div class="flex items-center gap-2.5 mb-10 bg-emerald-50 px-5 py-2 rounded-full border border-emerald-100/50">
          <span class="flex h-2 w-2 relative">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span class="text-[0.7rem] font-black text-emerald-800 uppercase tracking-widest">مبـاشر الآن</span>
        </div>

        <div class="text-[12rem] font-black leading-none text-slate-900 tracking-tighter tabular-nums mb-6 transition-transform duration-1000 group-hover:scale-105 select-none drop-shadow-sm">
          {{ currentNumber }}
        </div>
        <p class="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">الرقم جاري خدمته حالياً</p>
      </div>

      <!-- Action & Personal Status Overlay -->
      <Transition name="fade-slide" mode="out-in">
        
        <!-- State: No Ticket -->
        <div v-if="myTicket === null" class="fixed bottom-12 left-0 w-full flex justify-center px-6">
          <button 
            @click="getTicket" 
            :disabled="isLoading"
            class="w-full max-w-md bg-emerald-600 hover:bg-emerald-700 text-white py-7 rounded-[2rem] text-2xl font-black transition-all shadow-2xl shadow-emerald-200/50 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-4 group"
          >
            <span v-if="isLoading" class="w-7 h-7 border-4 border-white/30 border-t-white rounded-full animate-spin"></span>
            <span v-else class="flex items-center gap-4">
              احصل على رقمك الآن
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="transition-transform group-hover:-translate-x-3"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </span>
          </button>
        </div>

        <!-- State: Your Digital Ticket Card -->
        <div v-else class="space-y-8 animate-in slide-in-from-bottom duration-700">
          
          <div 
            class="bg-white rounded-[2.5rem] p-10 shadow-2xl transition-all duration-700 flex flex-col items-center relative overflow-hidden border-2"
            :class="isMyTurn ? 'border-emerald-500 ring-[12px] ring-emerald-500/10' : 'border-emerald-50'"
          >
            <!-- Decorative Background Element -->
            <div class="absolute -right-12 -bottom-12 text-[12rem] font-black text-emerald-500 opacity-[0.03] select-none pointer-events-none">{{ myTicket }}</div>
            
            <p class="text-[0.65rem] font-black text-emerald-600/40 uppercase tracking-[0.4em] mb-4">رقم تذكرتكم الخاص</p>
            <div class="text-8xl font-black text-emerald-950 leading-none mb-10 tabular-nums">{{ myTicket }}</div>

            <!-- Turn Status -->
            <div v-if="isMyTurn && !isFinished" class="w-full bg-emerald-600 text-white py-6 px-10 rounded-[1.8rem] font-black text-xl text-center shadow-xl shadow-emerald-200 animate-bounce-slow">
               تفضل! حان دوركم الآن ✨
            </div>
            <div v-else-if="isFinished" class="w-full bg-slate-50 text-slate-400 py-6 px-10 rounded-[1.8rem] font-black text-center border border-slate-100">
               لقد انتهى مـوعد دوركم
               <p class="text-[0.6rem] font-bold mt-2 cursor-pointer text-emerald-600 underline" @click="myTicket = null">تجديد التذكرة</p>
            </div>
            
            <!-- Waiting Progress Grid -->
            <div v-else class="grid grid-cols-2 gap-5 w-full">
              <div class="bg-emerald-50/50 p-6 rounded-3xl border border-emerald-100/30 text-center">
                <p class="text-[0.6rem] text-emerald-600/60 font-black mb-1.5 uppercase tracking-widest">أمامكم</p>
                <p class="text-3xl font-black text-emerald-900 leading-none">{{ peopleAhead }}</p>
              </div>
              <div class="bg-emerald-50/50 p-6 rounded-3xl border border-emerald-100/30 text-center">
                <p class="text-[0.6rem] text-emerald-600/60 font-black mb-1.5 uppercase tracking-widest">الوقت المتوقع</p>
                <p class="text-2xl font-black text-emerald-900 mt-1 leading-none">~{{ peopleAhead * 5 }} د</p>
              </div>
            </div>
          </div>

          <!-- Cancellation Link -->
          <button @click="cancelTicket" class="w-full py-4 text-emerald-400/50 hover:text-emerald-500 text-[0.65rem] font-black uppercase tracking-[0.3em] transition-all flex items-center justify-center gap-2 group">
             <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="opacity-30 group-hover:opacity-100 group-hover:rotate-90 transition-all duration-300"><path d="M18 6L6 18M6 6l12 12"/></svg>
             إلغاء حجز الموعد المسبق
          </button>
        </div>
      </Transition>

    </div>

    <!-- Info Banner (Counters Waiting) -->
    <div v-if="myTicket === null" class="mt-8 flex items-center gap-3 py-2 px-6 bg-emerald-50 rounded-full border border-emerald-100/30 animate-pulse">
       <span class="text-[0.6rem] font-black text-emerald-600/60 uppercase tracking-widest">إجمالي المنتظرين حالياً:</span>
       <span class="text-emerald-900 font-black text-sm">{{ Math.max(0, lastIssued - currentNumber) }}</span>
    </div>

    <!-- Elite Footer -->
    <footer class="mt-auto pt-24 pb-4 opacity-30 text-[0.6rem] font-black uppercase tracking-[0.5em] text-center pointer-events-none">
       Dawrak Elite Service System
    </footer>

    <!-- Celebration Animation Overlay -->
    <Transition name="pop">
      <div v-if="showCelebration" class="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div class="absolute inset-0 bg-emerald-600/10 backdrop-blur-[2px]"></div>
        <div class="text-9xl animate-bounce drop-shadow-2xl">🎫</div>
      </div>
    </Transition>

  </div>
</template>

<style scoped>
/* Page Layout & Animations */
.animate-bounce-slow {
  animation: bounceSlow 2s infinite ease-in-out;
}

@keyframes bounceSlow {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}

/* Transitions */
.fade-slide-enter-active, .fade-slide-leave-active {
  transition: all 0.6s cubic-bezier(0.19, 1, 0.22, 1);
}
.fade-slide-enter-from { opacity: 0; transform: translateY(20px); }
.fade-slide-leave-to { opacity: 0; transform: translateY(-20px); }

.pop-enter-active, .pop-leave-active {
  transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.pop-enter-from, .pop-leave-to { opacity: 0; transform: scale(0.5); }

@media (max-width: 480px) {
  .text-\[12rem\] { font-size: 8rem; }
  .p-12 { padding: 3rem 1.5rem; }
}
</style>
