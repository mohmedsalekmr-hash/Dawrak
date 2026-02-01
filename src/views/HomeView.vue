<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { supabase } from '../supabase'
import { useLocalStorage } from '@vueuse/core'
import { useSound } from '@vueuse/sound'

/** State Management - Preserving backend logic */
const currentNumber = ref(0)
const lastIssued = ref(0)
const queueId = ref<number | null>(null)
const myTicket = useLocalStorage<number | null>('dawrak-ticket', null)
const isLoading = ref(false)
const showCelebration = ref(false)

// Audio cue
const notificationSound = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'
const { play } = useSound(notificationSound)

/** Core Logic */
onMounted(async () => {
  let { data } = await supabase.from('queues').select('*').limit(1).maybeSingle()
  
  if (!data) {
    const res = await supabase.from('queues').insert({ name: 'Default Queue', current_number: 0, last_issued_number: 0 }).select().single()
    if (res.data) data = res.data
  }

  if (data) {
    queueId.value = data.id
    currentNumber.value = data.current_number ?? 0
    lastIssued.value = data.last_issued_number ?? 0
  }

  // Realtime updates
  supabase
    .channel('queues')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'queues' }, (payload) => {
      const newRow = payload.new as any
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

/** Computed */
const peopleAhead = computed(() => {
  if (!myTicket.value) return 0
  return Math.max(0, myTicket.value - currentNumber.value - 1)
})

const isMyTurn = computed(() => myTicket.value !== null && myTicket.value <= currentNumber.value)
const isFinished = computed(() => myTicket.value !== null && myTicket.value < currentNumber.value)

// Progress calculation for the ring
const progressOffset = computed(() => {
  if (!myTicket.value || isMyTurn.value) return 0
  const ahead = peopleAhead.value
  return (ahead / 10) * 100 // Visual representation
})
</script>

<template>
  <div class="min-h-screen bg-white flex flex-col items-center justify-between px-8 py-14 font-['Inter',sans-serif] selection:bg-emerald-100 overflow-hidden relative" dir="rtl">
    
    <!-- Top Nav / Label -->
    <header class="w-full flex justify-between items-center animate-in fade-in duration-700">
      <div class="flex items-center gap-1.5 opacity-60">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" class="text-slate-900"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"></path></svg>
        <span class="text-[0.7rem] font-bold text-slate-900 tracking-tight">نافذة الانتظار</span>
      </div>
      <div class="text-[0.7rem] font-black text-slate-400 tracking-[0.2em] uppercase">Dawrak</div>
    </header>

    <!-- Center Stage: The Interactive Ring (Reference Image Implementation) -->
    <main class="flex-1 flex flex-col items-center justify-center w-full max-w-lg">
      <div class="relative w-full aspect-square max-w-[340px] flex items-center justify-center translate-y-[-2vh]">
        
        <!-- Background Blur Blobs -->
        <div class="absolute inset-0 bg-emerald-500/5 blur-[100px] rounded-full"></div>
        
        <!-- The Main Circular Visual -->
        <div class="relative w-full h-full rounded-full bg-white shadow-[0_40px_80px_-20px_rgba(0,0,0,0.08)] flex flex-col items-center justify-center p-10 text-center border border-slate-50 overflow-hidden">
          
          <!-- Outer Progress Ring (SVG) -->
          <svg class="absolute inset-0 w-full h-full -rotate-90 transform p-4" viewBox="0 0 100 100">
            <!-- Full Ring -->
            <circle cx="50" cy="50" r="46" fill="none" class="stroke-slate-50" stroke-width="4"></circle>
            <!-- Dynamic Progress -->
            <circle 
              cx="50" cy="50" r="46" fill="none" 
              class="transition-all duration-1000 ease-out"
              :class="isMyTurn ? 'stroke-emerald-500' : 'stroke-emerald-600'"
              stroke-width="8"
              stroke-linecap="round"
              :stroke-dasharray="289"
              :stroke-dashoffset="isMyTurn ? 0 : 289 * (progressOffset / 100)"
            ></circle>
          </svg>

          <!-- Interior Content (Reference Text Patterns) -->
          <Transition name="fade-scale" mode="out-in">
            <!-- State: Idle (Serving) -->
            <div v-if="myTicket === null" key="idle" class="flex flex-col items-center">
              <p class="text-slate-400 text-sm font-medium mb-4">الرقم الحالي</p>
              <div class="text-9xl font-black text-slate-900 leading-none tabular-nums drop-shadow-sm">{{ currentNumber }}</div>
              <p class="text-emerald-600 text-[0.65rem] font-black uppercase tracking-[0.3em] mt-6">— يرجى الانتظار</p>
            </div>

            <!-- State: Your Turn (Image 3) -->
            <div v-else-if="isMyTurn" key="turn" class="flex flex-col items-center animate-gentle-pulse">
              <p class="text-slate-400 text-[0.7rem] font-medium mb-3">رقم تذكرتكم #{{ myTicket }}</p>
              <h2 class="text-4xl md:text-5xl font-black text-slate-900 leading-[1.15] mb-6">لقد حان<br>دوركم الآن!</h2>
              <p class="text-emerald-600 text-[0.7rem] font-black uppercase tracking-widest">— تفضلوا بالدخول</p>
            </div>

            <!-- State: Waiting (Image 1 & 2) -->
            <div v-else key="waiting" class="flex flex-col items-center text-center">
              <p class="text-slate-400 text-[0.7rem] font-medium mb-4">رقم تذكرتكم هو <span class="text-slate-900 font-bold">#{{ myTicket }}</span></p>
              <h2 class="text-4xl md:text-5xl font-black text-slate-900 leading-tight mb-4">ترتيبكم {{ peopleAhead + 1 }}<br>في القائمة</h2>
              <div class="flex flex-col gap-1 mt-2">
                <p class="text-slate-400 text-[0.7rem] font-medium tracking-tight">وقت الانتظار التقريبي</p>
                <p class="text-slate-900 text-lg font-black tracking-tight">≈ {{ peopleAhead * 5 }} دقيقة</p>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </main>

    <!-- Bottom Actions (Reference Buttons Style) -->
    <div class="w-full max-w-sm flex flex-col items-center gap-4 animate-in slide-in-from-bottom duration-1000">
      
      <!-- Notification-style Message (Image 1 Popup Feel) -->
      <Transition name="slide-up">
        <div v-if="isMyTurn" class="w-full bg-emerald-50 border border-emerald-100 p-5 rounded-3xl flex items-center gap-4 mb-2 shadow-sm">
          <div class="bg-emerald-600 p-2 rounded-xl text-white">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
          </div>
          <div class="flex-1">
            <p class="text-[0.65rem] font-black text-emerald-800/40 uppercase tracking-widest leading-none mb-1">تـنبيه الآن</p>
            <p class="text-sm font-bold text-emerald-900">لقد حان دوركم في نافذة الخدمة!</p>
          </div>
        </div>
      </Transition>

      <Transition name="action-swap" mode="out-in">
        <!-- Action: Get Ticket -->
        <div v-if="myTicket === null" class="w-full">
          <button 
            @click="getTicket" 
            :disabled="isLoading"
            class="w-full py-6 rounded-[1.8rem] bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xl transition-all shadow-xl shadow-emerald-200 active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3"
          >
            <span v-if="isLoading" class="w-6 h-6 border-4 border-white/20 border-t-white rounded-full animate-spin"></span>
            <span v-else>احصل على رقمك</span>
          </button>
        </div>

        <!-- Action: Manage Ticket -->
        <div v-else class="w-full flex flex-col gap-3">
          <!-- Notification Mock-button (Image 1) -->
          <button class="w-full py-4 rounded-[1.4rem] bg-emerald-600 text-white font-bold text-sm tracking-tight transition-all active:scale-[0.98] shadow-lg shadow-emerald-200 opacity-90">
             تفعيل الإشعارات
          </button>
          
          <button 
            @click="cancelTicket" 
            class="w-full py-4 rounded-[1.4rem] bg-slate-100 hover:bg-slate-200 text-slate-400 font-bold text-sm tracking-tight transition-all active:scale-[0.98]"
          >
            {{ isFinished ? 'بدء حجز جديد' : 'إلغاء حجز الدور' }}
          </button>
        </div>
      </Transition>

      <!-- Status Subtext -->
      <div v-if="myTicket === null" class="text-[0.6rem] font-black text-slate-300 uppercase tracking-[0.4em] mt-2 group hover:text-slate-400 cursor-default transition-colors">
        عدد المنتظرين في القائمة: {{ Math.max(0, lastIssued - currentNumber) }}
      </div>
    </div>

    <!-- Celebration Asset Overlay -->
    <Transition name="pop">
      <div v-if="showCelebration" class="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
        <div class="absolute inset-0 bg-white/40 backdrop-blur-sm"></div>
        <div class="text-9xl animate-ticket-pop drop-shadow-2xl">🎫</div>
      </div>
    </Transition>

  </div>
</template>

<style scoped>
/* Reference Image Animations */
@keyframes ticketPop {
  0% { transform: scale(0.5) rotate(-15deg); opacity: 0; }
  100% { transform: scale(1) rotate(0); opacity: 1; }
}
.animate-ticket-pop {
  animation: ticketPop 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes gentlePulse {
  0%, 100% { transform: scale(1); filter: brightness(1); }
  50% { transform: scale(1.02); filter: brightness(1.1); }
}
.animate-gentle-pulse {
  animation: gentlePulse 2s infinite ease-in-out;
}

/* Vue Transitions */
.fade-scale-enter-active, .fade-scale-leave-active {
  transition: all 0.6s cubic-bezier(0.19, 1, 0.22, 1);
}
.fade-scale-enter-from { opacity: 0; transform: scale(0.95); }
.fade-scale-leave-to { opacity: 0; transform: scale(1.05); }

.action-swap-enter-active, .action-swap-leave-active {
  transition: all 0.5s ease-out;
}
.action-swap-enter-from { opacity: 0; transform: translateY(10px); }
.action-swap-leave-to { opacity: 0; transform: translateY(-10px); }

.slide-up-enter-active, .slide-up-leave-active {
  transition: all 0.8s cubic-bezier(0.19, 1, 0.22, 1);
}
.slide-up-enter-from { opacity: 0; transform: translateY(30px); }
.slide-up-leave-to { opacity: 0; transform: translateY(-30px); }

.pop-enter-active, .pop-leave-active {
  transition: opacity 0.5s ease;
}
.pop-enter-from, .pop-leave-to { opacity: 0; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.5s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* Responsive adjustments */
@media (max-width: 480px) {
  main { scale: 0.9; }
  .text-9xl { font-size: 8rem; }
}
</style>
