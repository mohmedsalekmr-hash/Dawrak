<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { supabase } from '../supabase'
import { useLocalStorage } from '@vueuse/core'
import { useSound } from '@vueuse/sound'
import logoUrl from '../assets/logo.png'

/** State Management */
const currentNumber = ref(0)
const lastIssued = ref(0)
const queueId = ref<number | null>(null)
const myTicket = useLocalStorage<number | null>('dawrak-ticket', null)
const bookingStage = ref<'idle' | 'loading' | 'success'>('idle')

// Sound Configuration
const notificationSound = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'
const { play } = useSound(notificationSound)

/** Logic & Realtime */
onMounted(async () => {
  // Initial Data Fetch
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

  // Realtime Subscription
  supabase
    .channel('queues')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'queues' }, (payload) => {
      const newRow = payload.new as any
      if (queueId.value && newRow.id === queueId.value) {
        // Play sound ONLY if the user has a ticket and the number actually increased
        if (myTicket.value !== null && (newRow.current_number ?? 0) > currentNumber.value) {
          play()
        }
        currentNumber.value = newRow.current_number ?? 0
        lastIssued.value = newRow.last_issued_number ?? 0
      }
    })
    .subscribe()
})

/** Actions */
async function handleGetTicket() {
  if (!queueId.value || bookingStage.value !== 'idle') return
  
  // Haptics
  if ('vibrate' in navigator) {
    navigator.vibrate(50)
  }

  bookingStage.value = 'loading'
  
  const { data, error } = await supabase.rpc('next_ticket', { queue_id: queueId.value })
  
  if (data) {
    myTicket.value = data
    bookingStage.value = 'success'
    // Small delay to show the success state before transition
    setTimeout(() => {
      bookingStage.value = 'idle'
    }, 1500)
  } else {
    console.error('Error fetching ticket:', error)
    alert('حدث خطأ أثناء حجز التذكرة. يرجى المحاولة مرة أخرى.')
    bookingStage.value = 'idle'
  }
}

function cancelBooking() {
  if (confirm('هل أنت متأكد من إلغاء الحجز؟')) {
    myTicket.value = null
  }
}

/** Computed Utilities */
const peopleAhead = computed(() => {
  if (!myTicket.value) return 0
  return Math.max(0, myTicket.value - currentNumber.value - 1)
})

const isMyTurn = computed(() => myTicket.value !== null && myTicket.value <= currentNumber.value)
const isFinished = computed(() => myTicket.value !== null && myTicket.value < currentNumber.value)
</script>

<template>
  <div class="fixed inset-0 bg-white font-sans overflow-hidden transition-all duration-500" dir="rtl">
    
    <!-- Header Branding -->
    <header class="absolute top-0 left-0 w-full p-8 flex flex-col items-center z-10">
      <img :src="logoUrl" alt="Dawrak Logo" class="h-10 w-auto mb-2 grayscale opacity-80" />
      <span class="text-[0.6rem] font-bold tracking-[0.3em] text-slate-400 uppercase">DAWRAK SYSTEM</span>
    </header>

    <!-- State A: Central Pulse Button (Before/During Booking) -->
    <main class="h-full w-full flex items-center justify-center p-6">
      <Transition name="fade-scale">
        <div v-if="myTicket === null || bookingStage !== 'idle'" class="relative flex flex-col items-center">
          
          <!-- The Glowing Pulse Circle -->
          <button 
            @click="handleGetTicket"
            :disabled="bookingStage !== 'idle'"
            class="relative z-20 w-48 h-48 rounded-full flex items-center justify-center text-white transition-all duration-500 active:scale-90"
            :class="[
              bookingStage === 'success' ? 'bg-emerald-500' : 'bg-gradient-to-tr from-blue-700 to-blue-500 shadow-2xl shadow-blue-200',
              bookingStage === 'idle' ? 'hover:scale-105' : 'cursor-default'
            ]"
          >
            <!-- Permanent Pulse Effect (only idle) -->
            <div v-if="bookingStage === 'idle'" class="absolute inset-0 rounded-full bg-blue-500 animate-ping opacity-20 z-0"></div>
            
            <div class="relative z-10 flex flex-col items-center">
              <!-- Idle: Text -->
              <span v-if="bookingStage === 'idle'" class="text-2xl font-black tracking-tight">احجز دورك</span>
              
              <!-- Loading: Spinner -->
              <div v-else-if="bookingStage === 'loading'" class="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin"></div>
              
              <!-- Success: Checkmark -->
              <div v-else-if="bookingStage === 'success'" class="text-5xl animate-bounce">✅</div>
            </div>
          </button>

          <!-- Hint Text -->
          <p v-if="bookingStage === 'idle'" class="mt-8 text-slate-400 font-bold text-xs uppercase tracking-widest animate-pulse">إضغط لحجز تذكرة</p>
        </div>
      </Transition>
    </main>

    <!-- State B: Slide-Up Bottom Sheet (Active Ticket) -->
    <Transition name="bottom-sheet">
      <div v-if="myTicket !== null && bookingStage === 'idle'" class="absolute inset-0 z-40">
        
        <!-- Backdrop Blur -->
        <div class="absolute inset-0 bg-slate-900/5 backdrop-blur-sm transition-opacity" @click="cancelBooking"></div>
        
        <!-- The Sheet -->
        <div class="absolute bottom-0 left-0 w-full bg-white rounded-t-[3rem] shadow-[0_-20px_50px_rgba(0,0,0,0.1)] p-10 flex flex-col items-center border border-slate-100 transition-all duration-700"
             :class="isMyTurn ? 'border-t-emerald-500 border-t-8' : ''">
          
          <!-- Drag Handle -->
          <div class="w-12 h-1 bg-slate-100 rounded-full mb-10"></div>

          <!-- Ticket Banner -->
          <div class="mb-4">
             <span class="bg-blue-50 text-blue-600 px-4 py-1 rounded-full text-[0.6rem] font-black uppercase tracking-widest">
                رقم تذكرتك: {{ myTicket }}
             </span>
          </div>

          <!-- Hero: Current Number -->
          <div class="flex flex-col items-center mb-10">
            <h2 class="text-slate-400 text-[0.65rem] font-bold uppercase tracking-[0.2em] mb-4">الرقم المنادى عليه الآن</h2>
            <div class="text-[9rem] font-black leading-none text-slate-900 tracking-tighter tabular-nums transition-transform duration-700 hover:scale-105">
              {{ currentNumber }}
            </div>
          </div>

          <!-- Status Messaging -->
          <div class="w-full text-center">
             <div v-if="isMyTurn && !isFinished" class="bg-emerald-500 text-white p-6 rounded-3xl shadow-xl shadow-emerald-200 animate-bounce">
                <p class="text-2xl font-black">حان دورك الآن!</p>
                <p class="text-sm font-bold opacity-90 mt-1">تفضل بالتوجه إلى نافذة الخدمة</p>
             </div>
             <div v-else-if="isFinished" class="text-slate-400 font-bold py-4">
                لقد انتهت خدمتك. طاب يومك!
                <button @click="myTicket = null" class="block mx-auto mt-2 text-blue-500 underline text-xs tracking-widest uppercase">حجز رقم جديد</button>
             </div>
             <div v-else class="space-y-6">
                <!-- Progress Message -->
                <div class="flex items-baseline justify-center gap-2">
                   <span class="text-slate-400 text-sm font-bold">أمامك</span>
                   <span class="text-4xl font-black text-slate-900">{{ peopleAhead }}</span>
                   <span class="text-slate-400 text-sm font-bold">أشخاص</span>
                </div>
                <!-- Cancel Link -->
                <button @click="cancelBooking" class="text-slate-300 text-[0.6rem] font-black uppercase tracking-widest hover:text-red-400 transition-colors">
                   إلغاء حجز الموعد
                </button>
             </div>
          </div>

        </div>
      </div>
    </Transition>

  </div>
</template>

<style scoped>
/* Page Layout Transitions */
.fade-scale-enter-active, .fade-scale-leave-active {
  transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.fade-scale-enter-from, .fade-scale-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

/* Bottom Sheet Slide Up */
.bottom-sheet-enter-active, .bottom-sheet-leave-active {
  transition: all 0.8s cubic-bezier(0.19, 1, 0.22, 1);
}
.bottom-sheet-enter-from {
  transform: translateY(100%);
}
.bottom-sheet-enter-to {
  transform: translateY(0);
}
.bottom-sheet-leave-from {
  transform: translateY(0);
}
.bottom-sheet-leave-to {
  transform: translateY(100%);
}

/* Modal/Backdrop Fade */
.bottom-sheet-enter-active .bg-slate-900\/5, 
.bottom-sheet-leave-active .bg-slate-900\/5 {
  transition: opacity 0.8s ease;
}
.bottom-sheet-enter-from .bg-slate-900\/5 {
  opacity: 0;
}

/* Animation Utilities */
.animate-ping {
  animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
}
@keyframes ping {
  75%, 100% {
    transform: scale(2);
    opacity: 0;
  }
}
</style>
