<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { supabase } from '../supabase'
import { useLocalStorage } from '@vueuse/core'
import { useSound } from '@vueuse/sound'

/** State Management - Keeping production backend logic intact */
const currentNumber = ref(0)
const lastIssued = ref(0)
const queueId = ref<number | null>(null)
const myTicket = useLocalStorage<number | null>('dawrak-ticket', null)
const isLoading = ref(false)
const showCelebrationList = ref<number[]>([])

// Audio notification
const notificationSound = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'
const { play } = useSound(notificationSound)

/** Core Logic Initialization */
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

/** User Actions */
async function getTicket() {
  if (!queueId.value) return
  isLoading.value = true
  
  const { data, error } = await supabase.rpc('next_ticket', { queue_id: queueId.value })
  
  if (data) {
    myTicket.value = data
    triggerCelebration()
  } else {
    console.error('Error getting ticket:', error)
  }
  isLoading.value = false
}

function triggerCelebration() {
  const id = Date.now()
  showCelebrationList.value.push(id)
  setTimeout(() => {
    showCelebrationList.value = showCelebrationList.value.filter(item => item !== id)
  }, 4000)
}

function cancelTicket() {
  if (confirm('هل أنت متأكد من إلغاء تذكرتك؟ سيفقد ترتيبك الحالي.')) {
    myTicket.value = null
  }
}

/** Computed Metrics */
const peopleAhead = computed(() => {
  if (!myTicket.value) return 0
  return Math.max(0, myTicket.value - currentNumber.value - 1)
})

const isMyTurn = computed(() => myTicket.value !== null && myTicket.value <= currentNumber.value)
const isFinished = computed(() => myTicket.value !== null && myTicket.value < currentNumber.value)

// Circle progress: starts full and decreases as people are served
const progressOffset = computed(() => {
  if (!myTicket.value || isMyTurn.value) return 0
  // Relative progress logic based on a small window (max 10 people)
  return Math.max(0, (peopleAhead.value / 10) * 289)
})
</script>

<template>
  <div class="min-h-screen bg-white flex flex-col items-center justify-between px-8 py-14 font-['Inter',sans-serif] selection:bg-emerald-100 overflow-hidden relative" dir="rtl">
    
    <!-- 1. Poetic Background Blobs (SVG Effects from Reference Images) -->
    <div class="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      <!-- The "Fluid" background shapes -->
      <svg class="absolute -top-1/4 -right-1/4 w-[150%] h-[150%] opacity-20 filter blur-[80px] animate-morph" viewBox="0 0 1000 1000">
        <path d="M784,395Q742,490,695,571Q648,652,551,691Q454,730,344,704Q234,678,168,589Q102,500,147,404Q192,308,284,244Q376,180,488,187Q600,194,713,247Q826,300,784,395Z" fill="url(#grad1)"/>
        <defs>
          <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#10b981;stop-opacity:0.2" />
            <stop offset="100%" style="stop-color:#ecfdf5;stop-opacity:0" />
          </linearGradient>
        </defs>
      </svg>
      <!-- Smaller accent blob -->
      <div class="absolute top-[40%] left-[-10%] w-[60%] aspect-square bg-emerald-50 rounded-full blur-[100px] opacity-40"></div>
    </div>

    <!-- 2. Minimalist Header -->
    <header class="w-full flex flex-col items-center relative z-10 animate-in fade-in slide-in-from-top duration-700">
      <div class="flex items-center gap-1.5 opacity-60 mb-1">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" class="text-slate-900"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>
        <span class="text-[0.65rem] font-bold text-slate-900 uppercase tracking-widest">تتبع الدور المباشر</span>
      </div>
    </header>

    <!-- 3. Central Interactive Ring (Reference Images 1, 2, 3) -->
    <main class="flex-1 flex flex-col items-center justify-center w-full max-w-lg mb-[10vh]">
      <div class="relative w-full aspect-square max-w-[360px] flex items-center justify-center">
        
        <!-- The SVG Atmosphere Blobs behind the circle -->
        <div class="absolute inset-0 z-0 flex items-center justify-center">
           <div class="w-[110%] h-[110%] bg-emerald-50 rounded-full blur-[60px] opacity-30 animate-pulse"></div>
        </div>

        <!-- The Circular Container -->
        <div 
          class="relative z-10 w-full h-full rounded-full bg-white shadow-[0_45px_100px_-25px_rgba(0,0,0,0.06)] flex flex-col items-center justify-center p-10 text-center border border-slate-50 transition-all duration-1000"
          :class="isMyTurn ? 'border-emerald-500 shadow-[0_0_80px_rgba(16,185,129,0.2)]' : ''"
        >
          
          <!-- Circular Progress SVG -->
          <svg class="absolute inset-0 w-full h-full -rotate-90 transform p-4" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="46" fill="none" class="stroke-slate-50" stroke-width="4"></circle>
            <circle 
              cx="50" cy="50" r="46" fill="none" 
              class="transition-all duration-1000 ease-in-out"
              :class="isMyTurn ? 'stroke-emerald-500' : 'stroke-emerald-600'"
              stroke-width="8"
              stroke-linecap="round"
              :stroke-dasharray="289"
              :stroke-dashoffset="isMyTurn ? 0 : progressOffset"
            ></circle>
          </svg>

          <!-- Content Switching -->
          <Transition name="fade-scale" mode="out-in">
            <!-- Idle: Current Serving State -->
            <div v-if="myTicket === null" key="current" class="flex flex-col items-center">
              <p class="text-slate-400 text-xs font-semibold mb-3 uppercase tracking-wider">الرقم الحالي</p>
              <div class="text-[8.5rem] font-black text-slate-900 leading-none tabular-nums drop-shadow-sm">{{ currentNumber }}</div>
              <p class="text-emerald-700 text-[0.65rem] font-black uppercase tracking-[0.4em] mt-8">— يرجى الانتظار</p>
            </div>

            <!-- Turn Arrival: The Success Message (Image 3) -->
            <div v-else-if="isMyTurn" key="turn" class="flex flex-col items-center px-6">
              <div class="absolute inset-0 rounded-full bg-emerald-400/5 animate-ping-slow"></div>
              <p class="text-slate-400 text-[0.7rem] font-medium mb-4">رقم تذكرتكم هو <span class="text-slate-900 font-black">#{{ myTicket }}</span></p>
              <h2 class="text-4xl md:text-5xl font-black text-slate-900 leading-[1.1] mb-6">لقد حان<br>دوركم الآن!</h2>
              <p class="text-emerald-600 text-[0.7rem] font-black uppercase tracking-[0.2em]">تفضلوا.. مرحب بكـم</p>
            </div>

            <!-- Active Queue: Waiting State (Image 1 & 2) -->
            <div v-else key="waiting" class="flex flex-col items-center">
              <p class="text-slate-400 text-[0.7rem] font-medium mb-3">رقم تذكرتكم هو <span class="text-slate-900 font-black">#{{ myTicket }}</span></p>
              <h2 class="text-4xl md:text-5xl font-black text-slate-900 leading-tight mb-4 select-none">ترتيبكم {{ peopleAhead + 1 }}<br>في القائمة</h2>
              
              <div class="mt-2 flex flex-col items-center">
                <span class="text-slate-400 text-[0.65rem] font-medium uppercase tracking-tight mb-1">وقت الانتظار التقريبي</span>
                <div class="flex items-center gap-1.5">
                   <span class="text-2xl font-black text-slate-900 tracking-tighter">≈ {{ peopleAhead * 5 }}</span>
                   <span class="text-base font-bold text-slate-400 mb-0.5">دقائق</span>
                </div>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </main>

    <!-- 4. Bottom Performance Actions (Image 1 Style Buttons) -->
    <div class="w-full max-w-sm flex flex-col items-center gap-4 relative z-10 animate-in slide-in-from-bottom duration-1000">
      
      <Transition name="button-swap" mode="out-in">
        <!-- Action: Issue New Ticket -->
        <div v-if="myTicket === null" class="w-full">
           <button 
            @click="getTicket" 
            :disabled="isLoading"
            class="w-full py-6 rounded-[1.8rem] bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xl transition-all shadow-[0_30px_60px_-15px_rgba(5,150,105,0.4)] active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-4 relative overflow-hidden group"
          >
            <span v-if="isLoading" class="w-7 h-7 border-4 border-white/20 border-t-white rounded-full animate-spin"></span>
            <span v-else>احصل على رقمك</span>
          </button>
        </div>

        <!-- Action: Manage Existing Ticket -->
        <div v-else class="w-full space-y-4">
           <!-- The "Enable Notifications" Bar (Reference Image 1) -->
           <button class="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-[1.4rem] font-bold text-sm tracking-tight transition-all active:scale-[0.98] shadow-lg shadow-emerald-200">
              تفعيل الإشعارات
           </button>
           
           <button 
            @click="cancelTicket" 
            class="w-full py-4 rounded-[1.4rem] bg-slate-50 hover:bg-slate-100 text-slate-400 font-bold text-sm tracking-tight border border-slate-100 transition-all active:scale-[0.98]"
          >
            {{ isFinished ? 'بدء حجز جديد' : 'إلغاء حجز الدور' }}
          </button>
        </div>
      </Transition>

      <!-- Status Sub-footer -->
      <div v-if="myTicket === null" class="text-[0.6rem] font-black text-slate-300 uppercase tracking-[0.5em] mt-4 select-none">
        عدد المنتظرين حالياً: {{ Math.max(0, lastIssued - currentNumber) }}
      </div>
    </div>

    <!-- 5. Poetic Overlays (Image 2 Notification & Pop) -->
    <TransitionGroup name="celebration-pop">
      <div 
        v-for="popId in showCelebrationList" 
        :key="popId"
        class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[200] pointer-events-none"
      >
        <div class="relative scale-popup flex flex-col items-center">
           <div class="text-[14rem] drop-shadow-[0_20px_100px_rgba(16,185,129,0.4)]">🎫</div>
           <p class="mt-[-2rem] bg-white text-emerald-900 border border-emerald-100 px-8 py-3 rounded-full font-black text-lg shadow-2xl animate-bounce">تم حجز دورك بنجاح!</p>
        </div>
      </div>
    </TransitionGroup>

  </div>
</template>

<style scoped>
/* High-End Poetic Animations */
@keyframes morph {
  0%, 100% { d: path("M784,395Q742,490,695,571Q648,652,551,691Q454,730,344,704Q234,678,168,589Q102,500,147,404Q192,308,284,244Q376,180,488,187Q600,194,713,247Q826,300,784,395Z"); }
  50% { d: path("M795,417Q774,534,713,638Q652,742,525,739Q398,736,310,652Q222,568,230,446Q238,324,314,248Q390,172,500,170Q610,168,713,234Q816,300,795,417Z"); }
}

.animate-morph {
  animation: morph 20s infinite ease-in-out;
}

@keyframes pingSlow {
  0% { transform: scale(1); opacity: 0.15; }
  100% { transform: scale(1.4); opacity: 0; }
}
.animate-ping-slow {
  animation: pingSlow 3s infinite cubic-bezier(0, 0, 0.2, 1);
}

@keyframes pulseGlow {
  0%, 100% { box-shadow: 0 45px 100px -25px rgba(0,0,0,0.06); }
  50% { box-shadow: 0 45px 100px -25px rgba(16, 185, 129, 0.15); }
}
.animate-gentle-pulse {
  animation: pulseGlow 3s infinite ease-in-out;
}

/* Transitions */
.fade-scale-enter-active, .fade-scale-leave-active {
  transition: all 0.7s cubic-bezier(0.19, 1, 0.22, 1);
}
.fade-scale-enter-from { opacity: 0; transform: scale(0.9) translateY(10px); }
.fade-scale-leave-to { opacity: 0; transform: scale(1.1) translateY(-10px); }

.button-swap-enter-active, .button-swap-leave-active {
  transition: all 0.5s cubic-bezier(0.19, 1, 0.22, 1);
}
.button-swap-enter-from { opacity: 0; transform: translateY(20px); }
.button-swap-leave-to { opacity: 0; transform: translateY(-20px); }

.celebration-pop-enter-active {
  transition: all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.celebration-pop-leave-active {
  transition: all 0.5s ease-in;
}
.celebration-pop-enter-from { opacity: 0; transform: translate(-50%, -40%) scale(0.5) rotate(-20deg); }
.celebration-pop-leave-to { opacity: 0; transform: translate(-50%, -60%) scale(1.5); }

/* Custom Scrollbar for hidden elements */
::-webkit-scrollbar { display: none; }

@media (max-width: 480px) {
  .text-\[8.5rem\], .text-9xl { font-size: 7.5rem; }
  main { scale: 0.95; margin-top: -2vh; }
  header { top: 4rem; }
}
</style>
