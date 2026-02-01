<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { supabase } from '../supabase'
import { useLocalStorage } from '@vueuse/core'
import { useSound } from '@vueuse/sound'
import logoUrl from '../assets/logo.png'

/** State */
const currentNumber = ref(0)
const lastIssued = ref(0)
const queueId = ref<number | null>(null)
const myTicket = useLocalStorage<number | null>('dawrak-ticket', null)
const isLoading = ref(false)
const showCelebration = ref(false)
const showCancelModal = ref(false)
const showToast = ref<{ type: 'success' | 'info' | 'error', text: string } | null>(null)

const notificationSound = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'
const { play } = useSound(notificationSound)

/** Realtime */
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
    triggerCelebration()
    displayToast('success', 'تم استلام تذكرتك بنجاح')
  } else {
    console.error('Error getting ticket:', error)
    displayToast('error', 'نعتذر، حدث خطأ ما')
  }
  isLoading.value = false
}

function requestCancel() {
  showCancelModal.value = true
}

function confirmCancel() {
  myTicket.value = null
  showCancelModal.value = false
  displayToast('info', 'تم إلغاء الحجز بنجاح')
}

function triggerCelebration() {
  showCelebration.value = true
  setTimeout(() => showCelebration.value = false, 3000)
}

function displayToast(type: 'success' | 'info' | 'error', text: string) {
  showToast.value = { type, text }
  setTimeout(() => showToast.value = null, 4000)
}

/** Computed */
const peopleAhead = computed(() => {
  if (!myTicket.value) return 0
  return Math.max(0, myTicket.value - currentNumber.value - 1)
})

const isMyTurn = computed(() => myTicket.value !== null && myTicket.value <= currentNumber.value)
const isPast = computed(() => myTicket.value !== null && myTicket.value < currentNumber.value)
</script>

<template>
  <div class="min-h-screen bg-slate-50 flex flex-col items-center justify-start p-6 safe-area-inset" dir="rtl">
    
    <!-- Toast Notification -->
    <Transition name="toast">
      <div v-if="showToast" 
           class="fixed top-8 left-1/2 -translate-x-1/2 z-[100] px-6 py-4 rounded-2xl shadow-2xl flex items-center justify-center min-w-[300px] border border-white/20 backdrop-blur-xl"
           :class="{
             'bg-emerald-600 text-white': showToast.type === 'success',
             'bg-slate-800 text-white': showToast.type === 'info',
             'bg-rose-600 text-white': showToast.type === 'error'
           }">
        <span class="font-bold text-sm text-center">{{ showToast.text }}</span>
      </div>
    </Transition>

    <!-- Celebration Overlay -->
    <Transition name="fade">
      <div v-if="showCelebration" class="fixed inset-0 z-50 pointer-events-none flex items-center justify-center">
        <div class="absolute inset-0 bg-emerald-500/5 backdrop-blur-[1px]"></div>
        <div class="relative scale-animate text-8xl">🎫✨</div>
      </div>
    </Transition>

    <!-- Custom Cancel Modal -->
    <Transition name="modal">
      <div v-if="showCancelModal" class="fixed inset-0 z-[110] p-6 flex items-center justify-center">
        <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" @click="showCancelModal = false"></div>
        <div class="relative w-full max-w-sm bg-white rounded-[2.5rem] p-8 shadow-2xl text-center border border-slate-100 animate-in fade-in zoom-in duration-300">
          <div class="w-16 h-16 bg-rose-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-rose-600"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </div>
          <h2 class="text-2xl font-black text-slate-900 mb-3">إلغاء الحجز؟</h2>
          <p class="text-slate-500 mb-8 leading-relaxed">هل أنت متأكد من رغبتك في إلغاء تذكرتك الحالية؟ سيفقد رقمك ولن تتمكن من استعادته.</p>
          <div class="grid grid-cols-2 gap-4">
            <button @click="showCancelModal = false" class="py-4 rounded-2xl bg-slate-100 text-slate-600 font-bold transition-all active:scale-95">تراجع</button>
            <button @click="confirmCancel" class="py-4 rounded-2xl bg-rose-600 text-white font-bold transition-all shadow-lg shadow-rose-200 active:scale-95">نعم، إلغاء</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Header Section -->
    <div class="w-full max-w-md flex flex-col items-center mb-12 animate-in slide-in-from-top duration-1000">
      <img :src="logoUrl" alt="Dawrak Premium Logo" class="w-24 h-24 mb-6 drop-shadow-xl hover-float" />
      <h1 class="text-2xl font-black text-emerald-950 tracking-tight">نظـام دورك</h1>
      <p class="text-[0.6rem] font-bold text-slate-400 uppercase tracking-[0.3em] mt-2">النظـام والكرامة</p>
    </div>

    <!-- Main Live Queue Card -->
    <div class="w-full max-w-md bg-white rounded-[3.5rem] shadow-[0_40px_80px_-15px_rgba(0,0,0,0.08)] border border-slate-100/80 overflow-hidden relative mb-10 hover-glow transition-all duration-700">
      <div class="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-emerald-600 to-teal-500"></div>
      
      <div class="p-12 flex flex-col items-center">
        <!-- Live Indicator -->
        <div class="flex items-center gap-2.5 mb-10 bg-emerald-50/50 px-5 py-2.5 rounded-full border border-emerald-100/50">
          <span class="relative flex h-2.5 w-2.5">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span class="text-[0.7rem] font-black text-emerald-800 uppercase tracking-widest">مبـاشر الآن</span>
        </div>

        <!-- The Big Number -->
        <div class="relative mb-6 group">
          <div class="text-[11rem] font-black leading-none text-emerald-950 tracking-tighter tabular-nums drop-shadow-sm transition-transform duration-700 group-hover:scale-105">
            {{ currentNumber }}
          </div>
          <!-- Pulse decoration -->
          <div class="absolute inset-0 bg-emerald-500/5 blur-3xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
        </div>
        <p class="text-sm font-bold text-slate-400 uppercase tracking-widest text-center">الرقم الذي يتم خدمته حالياً</p>

        <!-- Dynamic Content Area -->
        <div class="w-full mt-14">
          
          <!-- State: No Ticket -->
          <Transition name="fade-scale" mode="out-in">
            <div v-if="myTicket === null" class="w-full flex flex-col items-center">
              <button 
                @click="getTicket" 
                :disabled="isLoading"
                class="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-7 rounded-[2.5rem] text-2xl font-black transition-all shadow-2xl shadow-emerald-200/50 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-4 group"
              >
                <span v-if="isLoading" class="w-7 h-7 border-4 border-white/30 border-t-white rounded-full animate-spin"></span>
                <span v-else class="flex items-center gap-3">
                  احصل على رقمك
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="transition-transform group-hover:-translate-x-2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                </span>
              </button>
              
              <div class="mt-8 flex items-center gap-3 bg-slate-50 px-6 py-3 rounded-2xl border border-slate-100 opacity-80">
                <span class="text-slate-400 text-[0.75rem] font-bold">إجمالي المنتظرين:</span>
                <span class="text-emerald-800 font-black text-base">{{ Math.max(0, lastIssued - currentNumber) }}</span>
              </div>
            </div>

            <!-- State: Has Ticket -->
            <div v-else class="w-full">
              <div class="bg-slate-50/50 rounded-[3rem] p-12 border border-slate-100 relative transition-all duration-700 overflow-hidden"
                   :class="isMyTurn ? 'ring-[12px] ring-emerald-500/10 border-emerald-500 bg-emerald-50/80 shadow-2xl shadow-emerald-100/50' : ''">
                
                <div class="relative z-10 flex flex-col items-center text-center">
                  <p class="text-[0.75rem] font-black text-slate-400 mb-3 uppercase tracking-widest">رقمك الخاص</p>
                  <div class="text-[5.5rem] font-black text-emerald-950 mb-10 tabular-nums leading-none">{{ myTicket }}</div>

                  <!-- Status Banner -->
                  <div v-if="isMyTurn" class="w-full bg-emerald-600 text-white py-6 px-8 rounded-3xl font-black text-xl shadow-xl shadow-emerald-200/50 animate-bounce-slow">
                     تفضل! حان دورك الآن ✨
                  </div>
                  <div v-else-if="isPast" class="w-full bg-slate-200/80 text-slate-500 py-6 px-8 rounded-3xl font-black text-lg opacity-70">
                     انتهي وقت دورك
                     <p class="text-[0.65rem] font-bold mt-2 cursor-pointer text-emerald-700 hover:underline" @click="myTicket = null">اضغط هنا للتجديد</p>
                  </div>
                  <!-- Wait Info Grid -->
                  <div v-else class="grid grid-cols-2 gap-5 w-full">
                    <div class="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100/80 text-center">
                      <p class="text-[0.7rem] text-slate-400 font-black mb-1.5 uppercase tracking-wider">أمامك</p>
                      <p class="text-4xl font-black text-emerald-900 leading-none">{{ peopleAhead }}</p>
                    </div>
                    <div class="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100/80 text-center">
                      <p class="text-[0.7rem] text-slate-400 font-black mb-1.5 uppercase tracking-wider">الوقت المتوقع</p>
                      <p class="text-xl font-black text-emerald-900 mt-1">~ {{ peopleAhead * 5 }} د</p>
                    </div>
                  </div>
                </div>

                <!-- Subtle background number decoration -->
                <div class="absolute -right-12 -bottom-12 text-[15rem] font-black text-emerald-950 opacity-[0.02] select-none pointer-events-none">{{ myTicket }}</div>
              </div>

              <!-- Redesigned professional Cancel Button -->
              <button 
                @click="requestCancel" 
                class="w-full mt-10 py-5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-[2rem] text-sm font-black uppercase tracking-[0.2em] transition-all border border-rose-100/50 flex items-center justify-center gap-3 group shadow-sm hover:shadow-md"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="opacity-70 group-hover:rotate-90 transition-transform duration-300">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
                <span>إلغاء الموعد والحجز</span>
              </button>
            </div>
          </Transition>

        </div>
      </div>
    </div>

    <!-- Info Footer -->
    <div class="mt-auto mb-8 flex flex-col items-center gap-5 opacity-40 text-[0.7rem] font-black uppercase tracking-[0.4em] pointer-events-none">
      <div class="h-[1px] w-32 bg-slate-300"></div>
      <span>Dawrak Elite Service System</span>
    </div>


  </div>
</template>

<style scoped>
.safe-area-inset {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}

.hover-float:hover {
  transform: translateY(-8px) rotate(2deg);
  transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.hover-glow:hover {
  box-shadow: 0 40px 80px -20px rgba(6, 78, 59, 0.12);
}

/* Animations */
.scale-animate {
  animation: scaleBounce 3s infinite;
}

@keyframes scaleBounce {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

.animate-bounce-slow {
  animation: bounceSlow 2s infinite;
}

@keyframes bounceSlow {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}

/* Transitions */
.toast-enter-active, .toast-leave-active {
  transition: all 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
}
.toast-enter-from { opacity: 0; transform: translate(-50%, -50px); }
.toast-leave-to { opacity: 0; transform: translate(-50%, -20px); }

.modal-enter-active, .modal-leave-active {
  transition: opacity 0.3s ease;
}
.modal-enter-active .relative, .modal-leave-active .relative {
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.modal-enter-from { opacity: 0; }
.modal-enter-from .relative { transform: scale(0.9); }
.modal-leave-to { opacity: 0; }
.modal-leave-to .relative { transform: scale(0.95); }

.fade-scale-enter-active, .fade-scale-leave-active {
  transition: all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.fade-scale-enter-from { opacity: 0; transform: scale(0.98) translateY(10px); }
.fade-scale-leave-to { opacity: 0; transform: scale(1.02) translateY(-10px); }

.fade-enter-active, .fade-leave-active { transition: opacity 0.5s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.dir-ltr { direction: ltr; }
</style>
