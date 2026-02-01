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
  <div class="min-h-screen bg-white flex flex-col items-center justify-center p-6 font-['Inter',sans-serif] selection:bg-emerald-100 overflow-hidden relative" dir="rtl">
    
    <!-- Poetic Background Decoration -->
    <div class="absolute inset-0 pointer-events-none overflow-hidden">
      <div class="absolute -top-24 -right-24 w-96 h-96 bg-emerald-50 rounded-full blur-3xl opacity-50"></div>
      <div class="absolute -bottom-24 -left-24 w-96 h-96 bg-emerald-50 rounded-full blur-3xl opacity-50"></div>
    </div>

    <!-- Header / Branding -->
    <header class="absolute top-12 flex flex-col items-center animate-in fade-in slide-in-from-top duration-1000">
      <div class="flex items-center gap-2 px-6 py-2 bg-emerald-50 rounded-full border border-emerald-100 shadow-sm">
        <div class="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></div>
        <span class="text-xs font-black text-emerald-800 tracking-widest uppercase">نظام دورك الذكي</span>
      </div>
    </header>

    <!-- Main Content: Vertical Center Hero -->
    <main class="w-full max-w-lg flex flex-col items-center justify-center relative z-10">
      <Transition name="hero-transition" mode="out-in">
        
        <!-- Large Card for Current Number -->
        <div 
          v-if="myTicket === null" 
          key="serving"
          class="w-full bg-white rounded-[3rem] p-16 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.08)] border border-gray-50 flex flex-col items-center group transition-transform hover:scale-105 duration-700"
        >
          <p class="text-[0.7rem] font-bold text-slate-400 uppercase tracking-[0.3em] mb-12">الرقم قيد الخدمة حالياً</p>
          <div class="text-[12rem] md:text-[14rem] font-black leading-none text-slate-900 tracking-tighter tabular-nums mb-12 drop-shadow-sm group-hover:text-emerald-950 transition-colors">
            {{ currentNumber }}
          </div>
          <div class="flex items-center gap-2 px-5 py-2 bg-emerald-50 rounded-full border border-emerald-100">
            <span class="text-[0.65rem] font-black text-emerald-700 uppercase tracking-widest">مباشر الآن</span>
          </div>
        </div>

        <!-- Personal Ticket Display Card -->
        <div 
          v-else 
          key="ticket"
          class="w-full bg-white rounded-[3rem] p-12 shadow-[0_50px_100px_-20px_rgba(0,0,0,0.1)] border transition-all duration-700 flex flex-col items-center relative"
          :class="isMyTurn ? 'border-emerald-500 ring-[20px] ring-emerald-500/5 shadow-[0_0_100px_rgba(16,185,129,0.2)]' : 'border-gray-50'"
        >
          <div class="absolute top-0 right-1/2 translate-x-1/2 w-16 h-8 bg-white border-b border-gray-50 rounded-b-3xl"></div>
          
          <div class="mb-8 text-center">
            <p class="text-[0.7rem] font-black text-slate-400 uppercase tracking-[0.4em] mb-6">رقم تذكرتك الخاصة</p>
            <div class="text-[8rem] font-black text-slate-900 leading-none tabular-nums animate-in zoom-in duration-500">{{ myTicket }}</div>
          </div>

          <!-- Turn Awareness Messaging -->
          <div v-if="isMyTurn && !isFinished" class="w-full bg-emerald-600 text-white p-8 rounded-[2rem] shadow-2xl shadow-emerald-200/50 flex flex-col items-center animate-bounce-gentle">
            <h2 class="text-3xl font-black mb-1">حان دوركم الآن!</h2>
            <p class="text-emerald-50 text-sm font-medium opacity-80">يرجى من فضلكم التوجه لخدمة العملاء</p>
          </div>

          <div v-else-if="isFinished" class="w-full opacity-40 flex flex-col items-center">
            <div class="h-[2px] w-20 bg-slate-200 mb-6"></div>
            <h2 class="text-3xl font-black text-slate-900 mb-2">انتهى موعد دوركم</h2>
            <p class="text-slate-500 text-sm font-medium">نأمل أن تكون خدمتكم قد تمت بنجاح</p>
          </div>

          <div v-else class="w-full grid grid-cols-2 gap-6 mt-6">
            <div class="bg-emerald-50 p-8 rounded-[2.5rem] flex flex-col items-center border border-emerald-100/50 group hover:bg-emerald-100/50 transition-colors">
              <span class="text-[0.65rem] text-emerald-800 font-black mb-1 uppercase tracking-widest">أمامك</span>
              <p class="text-5xl font-black text-emerald-950">{{ peopleAhead }}</p>
            </div>
            <div class="bg-emerald-50 p-8 rounded-[2.5rem] flex flex-col items-center border border-emerald-100/50 group hover:bg-emerald-100/50 transition-colors text-center">
              <span class="text-[0.65rem] text-emerald-800 font-black mb-1 uppercase tracking-widest leading-relaxed">الوقت المتوقع</span>
              <p class="text-3xl font-black text-emerald-950">~{{ peopleAhead * 5 }} د</p>
            </div>
          </div>
        </div>
      </Transition>
    </main>

    <!-- Bottom Actions Section (Vertical Alignment Support) -->
    <footer class="absolute bottom-12 w-full max-w-sm flex flex-col items-center gap-6 animate-in slide-in-from-bottom duration-1000">
      <Transition name="action-fade" mode="out-in">
        
        <!-- Get Ticket Action -->
        <div v-if="myTicket === null" class="w-full">
          <button 
            @click="getTicket" 
            :disabled="isLoading"
            class="w-full py-7 rounded-[2.5rem] bg-emerald-600 hover:bg-emerald-700 text-white font-black text-2xl transition-all shadow-[0_30px_60px_-15px_rgba(5,150,105,0.4)] active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-4 relative overflow-hidden group"
          >
            <!-- Shimmer effect -->
            <div class="absolute inset-0 bg-white/20 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 skew-x-12"></div>
            
            <span v-if="isLoading" class="w-8 h-8 border-4 border-white/20 border-t-white rounded-full animate-spin"></span>
            <span v-else class="flex items-center gap-4">
              احصل على دورك
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="transition-transform group-hover:-translate-x-2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </span>
          </button>
        </div>

        <!-- Management Action -->
        <div v-else class="w-full flex flex-col items-center gap-4 px-8">
           <button 
              @click="cancelTicket" 
              class="w-full py-5 rounded-[2rem] bg-slate-100 hover:bg-slate-200 text-slate-500 font-black text-sm uppercase tracking-[0.3em] transition-all active:scale-[0.98] border border-slate-200/50"
            >
              {{ isFinished ? 'بدء حجز جديد' : 'إلغاء حجز الدور' }}
            </button>
        </div>
      </Transition>

      <!-- Status Indicator -->
      <div v-if="myTicket === null" class="flex items-center gap-3 py-1 px-4 opacity-40">
        <span class="text-[0.65rem] font-bold text-slate-400 uppercase tracking-widest">عدد المنتظرين: {{ Math.max(0, lastIssued - currentNumber) }}</span>
      </div>
    </footer>

    <!-- Celebration / Ticket Generated Effect -->
    <Transition name="pop-up">
      <div v-if="showCelebration" class="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div class="absolute inset-0 bg-white/60 backdrop-blur-md"></div>
        <div class="text-[15rem] drop-shadow-[0_20px_100px_rgba(16,185,129,0.3)] animate-pop-in">🎫</div>
      </div>
    </Transition>

  </div>
</template>

<style scoped>
/* Poetic Transitions */
.hero-transition-enter-active, .hero-transition-leave-active {
  transition: all 0.8s cubic-bezier(0.19, 1, 0.22, 1);
}
.hero-transition-enter-from { opacity: 0; transform: scale(0.95) translateY(20px); }
.hero-transition-leave-to { opacity: 0; transform: scale(1.05) translateY(-20px); }

.action-fade-enter-active, .action-fade-leave-active {
  transition: all 0.6s ease;
}
.action-fade-enter-from { opacity: 0; transform: translateY(10px); }
.action-fade-leave-to { opacity: 0; transform: translateY(-10px); }

/* Animation Keyframes */
@keyframes bounceGentle {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}
.animate-bounce-gentle {
  animation: bounceGentle 2s infinite ease-in-out;
}

@keyframes popIn {
  0% { transform: scale(0) rotate(-20deg); opacity: 0; }
  60% { transform: scale(1.1) rotate(5deg); opacity: 1; }
  100% { transform: scale(1) rotate(0); opacity: 1; }
}
.animate-pop-in {
  animation: popIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.pop-up-enter-active, .pop-up-leave-active {
  transition: opacity 0.5s ease;
}
.pop-up-enter-from, .pop-up-leave-to {
  opacity: 0;
}

/* Typography Enhancements */
.tabular-nums {
  font-variant-numeric: tabular-nums;
}

@media (max-width: 480px) {
  .text-\[12rem\] { font-size: 8rem; }
  .p-16 { padding: 4rem 1.5rem; }
  .p-12 { padding: 3rem 1.5rem; }
}
</style>
