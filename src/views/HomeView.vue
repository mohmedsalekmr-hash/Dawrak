<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { supabase } from '../supabase'
import { useLocalStorage } from '@vueuse/core'
import { useSound } from '@vueuse/sound'


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
  <div class="min-h-screen bg-white flex flex-col items-center justify-between px-8 py-12 font-['Inter',sans-serif] selection:bg-emerald-100 overflow-hidden" dir="rtl">
    
    <!-- Top Branding / Header -->
    <header class="flex flex-col items-center animate-in fade-in slide-in-from-top duration-700">
      <div class="flex items-center gap-2 mb-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-slate-900"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
        <span class="text-base font-bold text-slate-900">نظام دورك</span>
      </div>
    </header>

    <!-- Main Hero Circle Section -->
    <main class="flex-1 flex flex-col items-center justify-center w-full max-w-lg mt-[-10vh]">
      <div class="relative w-full aspect-square max-w-[380px] flex items-center justify-center">
        
        <!-- Background Glows/Blobs (Reference Style) -->
        <div class="absolute inset-0 bg-emerald-500/5 blur-[80px] rounded-full animate-pulse"></div>
        <div class="absolute inset-4 bg-emerald-400/5 blur-[60px] rounded-full animate-pulse delay-700"></div>

        <!-- The Main Circle Ring -->
        <div 
          class="absolute inset-0 border-[14px] rounded-full transition-all duration-1000 flex flex-col items-center justify-center p-12 text-center bg-white shadow-[0_32px_64px_-16px_rgba(0,0,0,0.06)]"
          :class="isMyTurn ? 'border-emerald-500 shadow-[0_0_80px_rgba(16,185,129,0.2)]' : 'border-emerald-600'"
        >
          <Transition name="content-swap" mode="out-in">
            <!-- No Ticket State -->
            <div v-if="myTicket === null" key="no-ticket" class="flex flex-col items-center">
              <p class="text-slate-500 text-sm font-medium mb-4 uppercase tracking-widest text-center px-4 leading-relaxed">الرقم قيد الخدمة حالياً</p>
              <div class="text-[9rem] font-black leading-none text-slate-900 tracking-tighter tabular-nums mb-4">{{ currentNumber }}</div>
              <p class="text-emerald-600 text-sm font-bold opacity-80">— دورك بانتظاركم</p>
            </div>

            <!-- Has Ticket State -->
            <div v-else key="has-ticket" class="flex flex-col items-center">
              <p class="text-slate-500 text-base font-medium mb-2 uppercase tracking-tight">رقم تذكرتكم هو <span class="font-black text-slate-900">#{{ myTicket }}</span></p>
              
              <div v-if="isMyTurn" class="flex flex-col items-center animate-in zoom-in duration-500">
                <h2 class="text-5xl font-black text-slate-900 leading-[1.15] mb-4">لقد حان دوركم الآن!</h2>
                <p class="text-emerald-600 text-base font-bold">— يرجى التوجه لخدمة العملاء</p>
              </div>
              
              <div v-else-if="isFinished" class="flex flex-col items-center opacity-40">
                <h2 class="text-4xl font-black text-slate-900 leading-tight mb-4">انتهت مدة الحجز</h2>
                <p class="text-slate-400 text-sm font-medium">— شكراً لزيارتكم</p>
              </div>

              <div v-else class="flex flex-col items-center">
                <h2 class="text-5xl font-black text-slate-900 leading-[1.15] mb-4">ترتيبكم <span class="text-emerald-600">{{ peopleAhead + 1 }}</span> في القائمة</h2>
                <p class="text-slate-500 text-base font-medium opacity-80">— نقترب من خدمتكم!</p>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </main>

    <!-- Bottom Actions Section -->
    <footer class="w-full max-w-md flex flex-col items-center gap-4 animate-in slide-in-from-bottom duration-700">
      <Transition name="action-swap" mode="out-in">
        
        <!-- Get Ticket Button (Primary Emerald) -->
        <div v-if="myTicket === null" class="w-full">
          <button 
            @click="getTicket" 
            :disabled="isLoading"
            class="w-full py-6 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xl transition-all shadow-xl shadow-emerald-200 active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3"
          >
            <span v-if="isLoading" class="w-6 h-6 border-4 border-white/20 border-t-white rounded-full animate-spin"></span>
            <span v-else>احصل على رقمك</span>
          </button>
        </div>

        <!-- Quit/Reset Button (Secondary Light Gray) -->
        <div v-else class="w-full">
          <button 
            @click="cancelTicket" 
            class="w-full py-5 rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-400 font-bold text-base transition-all active:scale-[0.98] border border-slate-100/50"
          >
            {{ isFinished ? 'بدء حجز جديد' : 'إلغاء حجز الدور' }}
          </button>
        </div>
      </Transition>

      <!-- Sub-footer Info -->
      <div v-if="myTicket === null" class="flex items-center gap-2 text-[0.65rem] font-black text-slate-400 uppercase tracking-widest opacity-60">
        <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        عدد المنتظرين حالياً: {{ Math.max(0, lastIssued - currentNumber) }}
      </div>
    </footer>

    <!-- Celebration Animation Overlay -->
    <Transition name="fade">
      <div v-if="showCelebration" class="fixed inset-0 z-50 flex items-center justify-center pointer-events-none bg-white/40 backdrop-blur-sm">
        <div class="text-8xl animate-ticket-pop drop-shadow-2xl">🎫</div>
      </div>
    </Transition>

  </div>
</template>

<style scoped>
/* Modern Minimalist Animations */
.animate-ticket-pop {
  animation: ticketPop 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes ticketPop {
  0% { transform: scale(0.5) rotate(-15deg); opacity: 0; }
  100% { transform: scale(1) rotate(0); opacity: 1; }
}

/* Vue Content Transitions */
.content-swap-enter-active, .content-swap-leave-active {
  transition: all 0.6s cubic-bezier(0.19, 1, 0.22, 1);
}
.content-swap-enter-from { opacity: 0; transform: translateY(20px) scale(0.95); }
.content-swap-leave-to { opacity: 0; transform: translateY(-20px) scale(1.05); }

.action-swap-enter-active, .action-swap-leave-active {
  transition: all 0.5s ease-out;
}
.action-swap-enter-from { opacity: 0; transform: translateY(10px); }
.action-swap-leave-to { opacity: 0; transform: translateY(-10px); }

.fade-enter-active, .fade-leave-active { transition: opacity 0.5s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* Pulse for active turn */
@keyframes pulseGlow {
  0%, 100% { box-shadow: 0 0 40px rgba(16, 185, 129, 0.1); border-color: rgb(16, 185, 129); }
  50% { box-shadow: 0 0 80px rgba(16, 185, 129, 0.3); border-color: rgb(52, 211, 153); }
}

.animate-gentle-pulse {
  animation: pulseGlow 2s infinite ease-in-out;
}

/* Ensure centering on very small screens */
@media (max-height: 600px) {
  header { margin-bottom: 2rem; }
  main { margin-top: 0; }
}
</style>
