<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { supabase } from '../supabase'
import { useLocalStorage } from '@vueuse/core'
import { useSound } from '@vueuse/sound'

/** State Section */
const currentNumber = ref(0)
const lastIssued = ref(0)
const queueId = ref<number | null>(null)
const myTicket = useLocalStorage<number | null>('dawrak-ticket', null)
const isLoading = ref(false)
const showCelebrationList = ref<number[]>([])
const isNotificationsEnabled = ref(false)
const showNotificationToast = ref(false)

const { play } = useSound('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3')

/** Core Actions */
async function issueTicket() {
  if (!queueId.value || isLoading.value) return
  isLoading.value = true
  try {
    const { data, error } = await supabase.rpc('next_ticket', { queue_id: queueId.value })
    if (data) {
      myTicket.value = data
      const id = Date.now()
      showCelebrationList.value.push(id)
      setTimeout(() => {
        showCelebrationList.value = showCelebrationList.value.filter(i => i !== id)
      }, 4000)
    } else if (error) {
      console.error(error)
    }
  } catch (e) {
    console.error(e)
  } finally {
    isLoading.value = false
  }
}

function resetBooking() {
  if (confirm('هل أنت متأكد؟')) {
    myTicket.value = null
  }
}

function handleNotificationToggle() {
  isNotificationsEnabled.value = true
  showNotificationToast.value = true
  setTimeout(() => { showNotificationToast.value = false }, 3000)
}

/** Computed Measurements */
const peopleAheadCount = computed(() => {
  const t = myTicket.value
  if (t === null) return 0
  return Math.max(0, t - currentNumber.value - 1)
})

const isMyTurnActive = computed(() => {
  const t = myTicket.value
  return t !== null && t <= currentNumber.value
})

const isTicketFinished = computed(() => {
  const t = myTicket.value
  return t !== null && t < currentNumber.value
})

const progressVisualOffset = computed(() => {
  if (myTicket.value === null || isMyTurnActive.value) return 0
  return Math.max(0, (peopleAheadCount.value / 12) * 289)
})

/** Initialization */
onMounted(async () => {
  // Load initial data
  const { data } = await supabase.from('queues').select('*').limit(1).maybeSingle()
  if (data) {
    queueId.value = data.id
    currentNumber.value = data.current_number ?? 0
    lastIssued.value = data.last_issued_number ?? 0
    
    // Automatic Booking if scan landed here with no ticket
    if (myTicket.value === null) {
      await issueTicket()
    }
  }

  // Realtime subscription
  supabase.channel('queue_updates')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'queues' }, (payload) => {
      const row = payload.new as any
      if (queueId.value && row.id === queueId.value) {
        if (row.current_number > currentNumber.value) play()
        currentNumber.value = row.current_number ?? 0
        lastIssued.value = row.last_issued_number ?? 0
      }
    })
    .subscribe()
})
</script>

<template>
  <div class="min-h-screen bg-white flex flex-col items-center justify-between px-8 py-14 font-['Inter',sans-serif] selection:bg-emerald-100 overflow-hidden relative" dir="rtl">
    
    <!-- Background Poetics -->
    <div class="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      <svg class="absolute -top-1/4 -right-1/4 w-[150%] h-[150%] opacity-20 filter blur-[80px] animate-morph" viewBox="0 0 1000 1000">
        <path d="M784,395Q742,490,695,571Q648,652,551,691Q454,730,344,704Q234,678,168,589Q102,500,147,404Q192,308,284,244Q376,180,488,187Q600,194,713,247Q826,300,784,395Z" fill="url(#grad1)"/>
        <defs>
          <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#10b981;stop-opacity:0.2" />
            <stop offset="100%" style="stop-color:#ecfdf5;stop-opacity:0" />
          </linearGradient>
        </defs>
      </svg>
    </div>

    <!-- Header Branding -->
    <header class="w-full flex items-center justify-between relative z-10 animate-in fade-in duration-1000 px-2 opacity-60">
      <div class="flex items-center gap-2">
        <div class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
        <span class="text-[0.65rem] font-black text-slate-900 uppercase tracking-widest">تتبع مباشر</span>
      </div>
      <div class="text-[0.65rem] font-black text-slate-400 tracking-[0.4em]">DAWRAK</div>
    </header>

    <!-- Main Visual Hub (Circle) -->
    <main class="flex-1 flex flex-col items-center justify-center w-full max-w-lg mb-[5vh]">
      <div class="relative w-full aspect-square max-w-[380px] flex items-center justify-center">
        <!-- Deep Circle Shadow -->
        <div class="absolute inset-4 shadow-[0_50px_130px_-20px_rgba(0,0,0,0.12),0_0_60px_rgba(16,185,129,0.06)] rounded-full bg-white"></div>
        
        <div 
          class="relative z-10 w-full h-full rounded-full bg-white flex flex-col items-center justify-center p-12 text-center border-2 border-slate-50 transition-all duration-1000 overflow-hidden"
          :class="isMyTurnActive ? 'border-emerald-500 bg-emerald-50/10' : ''"
        >
          <!-- Active Turn Glow -->
          <div v-if="isMyTurnActive" class="absolute inset-0 rounded-full ring-[28px] ring-emerald-500/10 animate-ping-slow"></div>
          
          <!-- Progress Ring -->
          <svg class="absolute inset-0 w-full h-full -rotate-90 transform p-4" viewBox="0 0 1000 1000">
            <circle cx="500" cy="500" r="460" fill="none" class="stroke-slate-50" stroke-width="20"></circle>
            <circle 
              cx="500" cy="500" r="460" fill="none" 
              class="transition-all duration-1000 ease-in-out"
              :class="isMyTurnActive ? 'stroke-emerald-500' : 'stroke-emerald-600'"
              stroke-width="50"
              stroke-linecap="round"
              :stroke-dasharray="2890"
              :stroke-dashoffset="isMyTurnActive ? 0 : (progressVisualOffset * 10)"
            ></circle>
          </svg>

          <!-- Status Content -->
          <Transition name="fade-scale" mode="out-in">
            <!-- No Ticket Display -->
            <div v-if="myTicket === null" key="idle" class="flex flex-col items-center">
              <p class="text-slate-400 text-[0.65rem] font-bold mb-4 uppercase tracking-[0.2em]">الرقم قيد الخدمة</p>
              <div class="text-[9.5rem] font-black text-slate-900 leading-none tabular-nums tracking-tighter">{{ currentNumber }}</div>
              <button @click="issueTicket" class="mt-8 text-emerald-600 font-black text-[0.65rem] uppercase tracking-widest hover:opacity-70 transition-opacity underline underline-offset-8">
                 طلب تذكرة يدوياً
              </button>
            </div>

            <!-- Your Turn Messaging -->
            <div v-else-if="isMyTurnActive" key="turn" class="flex flex-col items-center px-6">
              <p class="text-slate-400 text-[0.7rem] font-bold mb-3 tracking-tighter uppercase opacity-80">تذكرة العميل #{{ myTicket }}</p>
              <h2 class="text-5xl font-black text-slate-900 leading-[1.1] mb-6">تفضل!<br>حان دورك</h2>
              <div class="bg-emerald-600/10 text-emerald-600 border border-emerald-600/20 px-6 py-2 rounded-full text-[0.65rem] font-black uppercase tracking-widest shadow-sm">
                 توجه للمكتب الآن
              </div>
            </div>

            <!-- In Queue Waiting -->
            <div v-else key="waiting" class="flex flex-col items-center">
              <p class="text-slate-400 text-[0.7rem] font-bold mb-4 tracking-tighter opacity-80">رقم تذكرتك #{{ myTicket }}</p>
              <h2 class="text-5xl font-black text-slate-900 leading-[1.1] mb-6">أنت التالي<br>بعد {{ peopleAheadCount }} أشخاص</h2>
              <div class="flex flex-col items-center gap-1.5">
                 <span class="text-slate-400 text-[0.65rem] font-bold uppercase tracking-widest opacity-60">الانتظار المتوقع</span>
                 <p class="text-2xl font-black text-slate-900 tracking-tighter">≈ {{ peopleAheadCount * 4 }} دقيقة</p>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </main>

    <!-- Bottom Action Controls -->
    <div class="w-full max-w-sm flex flex-col items-center gap-4 relative z-10 animate-in slide-in-from-bottom duration-1000 px-4">
      
      <!-- Notifications Bar -->
      <Transition name="slide-up">
        <div v-if="myTicket !== null" class="w-full">
          <button 
            v-if="!isNotificationsEnabled"
            @click="handleNotificationToggle"
            class="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-5 rounded-[1.6rem] font-black text-sm tracking-tight transition-all active:scale-[0.98] shadow-xl shadow-emerald-200/50 flex items-center justify-center gap-3"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
            تفعيل تنبيهات الوصول
          </button>
          
          <div v-else-if="showNotificationToast && isNotificationsEnabled" class="w-full bg-slate-900 text-white py-4 rounded-2xl flex items-center justify-center gap-3 animate-in zoom-in duration-500 shadow-2xl">
             <span class="text-xs font-black uppercase tracking-[0.2em]">سيتم تنبيهك عند اقتراب دورك</span>
          </div>
          
          <div v-else class="w-full bg-emerald-50 text-emerald-700 py-4 rounded-2xl flex items-center justify-center gap-3 border border-emerald-100/50 text-[0.65rem] font-black uppercase tracking-widest shadow-sm">
             <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
             التنبيهات نشطة حالياً
          </div>
        </div>
      </Transition>

      <!-- Manage State Button -->
      <div v-if="myTicket !== null" class="w-full flex justify-center">
        <button 
          @click="resetBooking" 
          class="px-8 py-3 text-slate-300 hover:text-rose-400 text-[0.6rem] font-black uppercase tracking-[0.5em] transition-colors border border-transparent hover:border-rose-100 rounded-full"
        >
          {{ isTicketFinished ? 'طلب دور جديـد' : 'إلغاء حجز الدور' }}
        </button>
      </div>

      <!-- Live Counters -->
      <div v-if="myTicket === null" class="text-[0.6rem] font-black text-slate-300 uppercase tracking-[0.6em] mt-4 opacity-40">
        {{ currentNumber }} Serving / {{ lastIssued }} Issued
      </div>
    </div>

    <!-- Celebration Overlays -->
    <TransitionGroup name="celebration-pop">
      <div v-for="popId in showCelebrationList" :key="popId" class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[200] pointer-events-none">
        <div class="flex flex-col items-center scale-popup">
           <div class="text-[13rem] drop-shadow-2xl">🎫</div>
           <div class="bg-white/95 backdrop-blur-sm border border-emerald-100 px-10 py-4 rounded-full shadow-2xl animate-pop-in">
              <p class="text-emerald-950 font-black text-xl">تم حجز دورك بنجاح!</p>
           </div>
        </div>
      </div>
    </TransitionGroup>

  </div>
</template>

<style scoped>
@keyframes morph {
  0%, 100% { d: path("M784,395Q742,490,695,571Q648,652,551,691Q454,730,344,704Q234,678,168,589Q102,500,147,404Q192,308,284,244Q376,180,488,187Q600,194,713,247Q826,300,784,395Z"); }
  50% { d: path("M795,417Q774,534,713,638Q652,742,525,739Q398,736,310,652Q222,568,230,446Q238,324,314,248Q390,172,500,170Q610,168,713,234Q816,300,795,417Z"); }
}
.animate-morph { animation: morph 20s infinite ease-in-out; }

@keyframes pingSlow {
  0% { transform: scale(1); opacity: 0.3; }
  100% { transform: scale(1.6); opacity: 0; }
}
.animate-ping-slow { animation: pingSlow 3s infinite cubic-bezier(0, 0, 0.2, 1); }

.fade-scale-enter-active, .fade-scale-leave-active { transition: all 0.8s cubic-bezier(0.19, 1, 0.22, 1); }
.fade-scale-enter-from { opacity: 0; transform: scale(0.9) translateY(10px); }
.fade-scale-leave-to { opacity: 0; transform: scale(1.1) translateY(-10px); }

.slide-up-enter-active { transition: all 0.6s cubic-bezier(0.19, 1, 0.22, 1); }
.slide-up-enter-from { opacity: 0; transform: translateY(40px); }

.celebration-pop-enter-active { transition: all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1); }
.celebration-pop-enter-from { opacity: 0; transform: translate(-50%, -40%) scale(0.5); }
.celebration-pop-leave-active { transition: all 0.8s ease-in; }
.celebration-pop-leave-to { opacity: 0; transform: translate(-50%, -80%) scale(1.5); }

@keyframes popIn {
  0% { transform: scale(0.8); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
.animate-pop-in { animation: popIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }

@media (max-width: 480px) {
  .text-\[9.5rem\] { font-size: 7.5rem; }
  .text-5xl { font-size: 2.8rem; }
  main { scale: 0.95; margin-top: -3vh; }
}
</style>
