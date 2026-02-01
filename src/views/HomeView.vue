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
  <div class="min-h-screen bg-[#FFFFFF] flex flex-col items-center justify-start px-6 pt-12 pb-32 font-['Inter',sans-serif] selection:bg-emerald-100 overflow-x-hidden" dir="rtl">
    
    <!-- 1. Minimalist Header -->
    <header class="w-full max-w-lg mb-16 flex flex-col items-center animate-in fade-in slide-in-from-top duration-1000">
      <div class="p-3 bg-white rounded-2xl shadow-sm border border-emerald-50 mb-4 transition-all hover:scale-105 hover:shadow-md">
        <img :src="logoUrl" alt="Logo" class="h-10 w-auto object-contain" />
      </div>
      <h1 class="text-lg font-black text-emerald-600 tracking-tight text-center">خدمة العملاء الذكية</h1>
      <p class="text-[0.6rem] font-bold text-slate-400 uppercase tracking-[0.4em] mt-2">D A W R A K</p>
    </header>

    <!-- 2. Main Current Number Display -->
    <main class="w-full max-w-lg mb-12 animate-in fade-in zoom-in duration-700">
      <div class="bg-white rounded-[3.5rem] p-16 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.06)] border border-gray-50 flex flex-col items-center relative overflow-hidden group">
        <!-- Subtle Accents -->
        <div class="absolute top-0 left-0 w-full h-1.5 bg-emerald-600"></div>
        
        <div class="flex items-center gap-2 mb-10 bg-emerald-50 px-5 py-2 rounded-full border border-emerald-100/50">
          <span class="flex h-2 w-2 relative">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span class="text-[0.65rem] font-black text-emerald-800 uppercase tracking-widest text-center">قيد الانتظار</span>
        </div>

        <div class="text-[14rem] font-black leading-none text-slate-900 tracking-tighter tabular-nums mb-8 select-none transition-transform duration-1000 group-hover:scale-[1.03] drop-shadow-sm">
          {{ currentNumber }}
        </div>
        <p class="text-[0.7rem] font-bold text-slate-400 uppercase tracking-[0.3em] text-center">الرقم الذي يتم خدمته حالياً</p>
      </div>
    </main>

    <!-- 3. Dynamic Ticket / Action Section -->
    <div class="w-full max-w-lg relative z-20">
      <Transition name="ticket-flow" mode="out-in">
        
        <!-- State: No Ticket (Floating Wide Button) -->
        <div v-if="myTicket === null" class="flex flex-col items-center w-full px-2">
          <button 
            @click="getTicket" 
            :disabled="isLoading"
            class="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-8 rounded-[2.5rem] text-2xl font-black transition-all shadow-[0_25px_50px_-12px_rgba(5,150,105,0.3)] active:scale-95 disabled:opacity-50 flex items-center justify-center gap-5 group relative overflow-hidden"
          >
            <!-- Animated Background Pulse -->
            <div class="absolute inset-0 bg-white/10 scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-500"></div>
            
            <span v-if="isLoading" class="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin relative z-10"></span>
            <span v-else class="flex items-center gap-4 relative z-10">
              احصـل على تذكرتك
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="transition-transform group-hover:-translate-x-3"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </span>
          </button>
          
          <div class="mt-8 flex items-center gap-3 px-6 py-2 bg-slate-50 rounded-full border border-slate-100">
             <span class="text-[0.6rem] font-black text-slate-400 uppercase tracking-widest">إجمالي المنتظرين:</span>
             <span class="text-emerald-900 font-black text-sm">{{ Math.max(0, lastIssued - currentNumber) }}</span>
          </div>
        </div>

        <!-- State: Personal Ticket (Digital Receipt Card) -->
        <div v-else class="w-full">
          <div 
            class="bg-white rounded-[3rem] p-12 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.1)] border-2 transition-all duration-700 flex flex-col items-center relative overflow-hidden"
            :class="isMyTurn ? 'border-emerald-500 ring-[15px] ring-emerald-500/10 animate-gentle-pulse' : 'border-gray-50 bg-[#fafdfc]'"
          >
            <!-- Digital Receipt Notch Style -->
            <div class="absolute top-0 right-1/2 translate-x-1/2 w-16 h-8 bg-[#FFFFFF] rounded-b-3xl border-b border-gray-100"></div>
            
            <div class="mb-10 text-center">
               <p class="text-[0.7rem] font-black text-slate-400 uppercase tracking-[0.4em] mb-3">رقم تذكرتك الشخصي</p>
               <div class="text-[7rem] font-black text-emerald-950 leading-none tabular-nums drop-shadow-sm">{{ myTicket }}</div>
            </div>

            <!-- Turn Status / Action -->
            <div v-if="isMyTurn && !isFinished" class="w-full bg-emerald-600 text-white py-7 px-10 rounded-[2rem] font-black text-2xl text-center shadow-xl shadow-emerald-200 animate-bounce-custom">
               تفضـل! حان دورك الآن ✨
            </div>
            
            <div v-else-if="isFinished" class="text-center w-full">
               <div class="bg-gray-100 text-slate-400 py-6 px-10 rounded-[2rem] font-black text-lg">
                  لقد انتهت خدمتك بنجاح
               </div>
               <button @click="myTicket = null" class="mt-6 text-emerald-600 text-sm font-black underline underline-offset-8 transition-opacity hover:opacity-70">
                  طلب رقم جديد
               </button>
            </div>
            
            <!-- Waiting Progress -->
            <div v-else class="grid grid-cols-2 gap-6 w-full mt-2">
              <div class="bg-white p-8 rounded-[2.2rem] border border-gray-100 shadow-sm text-center transition-all hover:bg-emerald-50 group/item">
                <p class="text-[0.65rem] text-slate-400 font-bold mb-2 uppercase tracking-widest group-hover/item:text-emerald-600">أمامك</p>
                <div class="flex items-center justify-center gap-1">
                   <p class="text-4xl font-black text-slate-900 group-hover/item:text-emerald-900">{{ peopleAhead }}</p>
                   <span class="text-[0.6rem] font-black text-slate-400">أشخاص</span>
                </div>
              </div>
              <div class="bg-white p-8 rounded-[2.2rem] border border-gray-100 shadow-sm text-center transition-all hover:bg-emerald-50 group/item">
                <p class="text-[0.65rem] text-slate-400 font-bold mb-2 uppercase tracking-widest group-hover/item:text-emerald-600">الوقت المتوقع</p>
                <p class="text-2xl font-black text-slate-900 mt-1 leading-none group-hover/item:text-emerald-900">~{{ peopleAhead * 5 }} دقيقة</p>
              </div>
            </div>
          </div>

          <!-- Cancellation Sub-action -->
          <button @click="cancelTicket" class="w-full mt-10 text-slate-300 hover:text-rose-500 text-[0.6rem] font-black uppercase tracking-[0.4em] transition-all flex items-center justify-center gap-3">
             <div class="h-[1px] w-8 bg-current"></div>
             إلغاء الموعد المسبق
             <div class="h-[1px] w-8 bg-current"></div>
          </button>
        </div>
      </Transition>
    </div>

    <!-- 4. Elite Subtle Footer -->
    <footer class="mt-auto pt-20 pb-4 opacity-20 text-[0.65rem] font-black uppercase tracking-[0.6em] text-center pointer-events-none transition-opacity hover:opacity-100">
       DAWRAK ELITE • WHITE & GREEN EDITION
    </footer>

    <!-- Full-screen Celebration Effect -->
    <Transition name="celebrate">
      <div v-if="showCelebration" class="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
        <div class="absolute inset-0 bg-emerald-600/5 backdrop-blur-[2px]"></div>
        <div class="text-9xl animate-ticket-pop drop-shadow-2xl">🎫</div>
      </div>
    </Transition>

  </div>
</template>

<style scoped>
/* Custom "Nano" Style Animations */
.animate-gentle-pulse {
  animation: gentlePulse 2s infinite ease-in-out;
}

@keyframes gentlePulse {
  0%, 100% { transform: scale(1); box-shadow: 0 40px 80px -15px rgba(16, 185, 129, 0.1); }
  50% { transform: scale(1.01); box-shadow: 0 45px 90px -15px rgba(16, 185, 129, 0.2); }
}

.animate-bounce-custom {
  animation: bounceCustom 2.5s infinite;
}

@keyframes bounceCustom {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-12px); }
}

.animate-ticket-pop {
  animation: ticketPop 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes ticketPop {
  0% { transform: scale(0.5) rotate(-20deg); opacity: 0; }
  100% { transform: scale(1) rotate(0); opacity: 1; }
}

/* Page Transitions */
.ticket-flow-enter-active, .ticket-flow-leave-active {
  transition: all 0.7s cubic-bezier(0.19, 1, 0.22, 1);
}
.ticket-flow-enter-from { opacity: 0; transform: translateY(40px) scale(0.96); }
.ticket-flow-leave-to { opacity: 0; transform: translateY(-40px) scale(1.04); }

.celebrate-enter-active, .celebrate-leave-active {
  transition: opacity 0.5s ease;
}
.celebrate-enter-from, .celebrate-leave-to { opacity: 0; }

/* Responsive adjustments */
@media (max-width: 480px) {
  .text-\[14rem\] { font-size: 10rem; }
  .text-\[7rem\] { font-size: 5rem; }
  .p-16 { padding: 4rem 2rem; }
}
</style>
