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
  <div class="min-h-screen bg-[#fcfdfd] flex flex-col items-center justify-start px-6 py-12 safe-area-inset font-sans" dir="rtl">
    
    <!-- Toast Notification -->
    <Transition name="toast">
      <div v-if="showToast" 
           class="fixed top-10 left-1/2 -translate-x-1/2 z-[100] px-8 py-5 rounded-[2rem] shadow-[0_20px_40px_rgba(0,0,0,0.1)] flex items-center justify-center min-w-[320px] backdrop-blur-2xl border border-white/40"
           :class="{
             'bg-emerald-600/95 text-white shadow-emerald-200/50': showToast.type === 'success',
             'bg-slate-900/95 text-white shadow-slate-200/50': showToast.type === 'info',
             'bg-rose-600/95 text-white shadow-rose-200/50': showToast.type === 'error'
           }">
        <span class="font-bold text-sm text-center leading-relaxed tracking-wide">{{ showToast.text }}</span>
      </div>
    </Transition>

    <!-- Celebration Overlay -->
    <Transition name="fade">
      <div v-if="showCelebration" class="fixed inset-0 z-50 pointer-events-none flex items-center justify-center">
        <div class="absolute inset-0 bg-emerald-50/20 backdrop-blur-[2px]"></div>
        <div class="relative scale-animate text-[10rem]">🎫</div>
      </div>
    </Transition>

    <!-- Professional Cancel Modal -->
    <Transition name="modal">
      <div v-if="showCancelModal" class="fixed inset-0 z-[110] p-6 flex items-center justify-center">
        <div class="absolute inset-0 bg-[#0c1e19]/60 backdrop-blur-md" @click="showCancelModal = false"></div>
        <div class="relative w-full max-w-sm bg-white rounded-[3.5rem] p-10 shadow-3xl text-center border border-slate-100/50 overflow-hidden">
          <div class="absolute top-0 left-0 w-full h-1.5 bg-rose-500"></div>
          <div class="w-20 h-20 bg-rose-50 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-rose-600"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </div>
          <h2 class="text-3xl font-black text-slate-900 mb-4 tracking-tight">إلغاء الموعد؟</h2>
          <p class="text-slate-500 mb-10 leading-relaxed text-sm px-4">هل أنت متأكد من رغبتك في إلغاء تذكرتك؟ سيتم حذف دورك ولن تتمكن من العودة إليه لاحقاً.</p>
          <div class="flex flex-col gap-3">
             <button @click="confirmCancel" class="w-full py-5 rounded-[1.8rem] bg-rose-600 text-white font-black text-lg transition-all shadow-xl shadow-rose-200 hover:bg-rose-700 active:scale-[0.98]">نعم، إلغاء الحجز</button>
             <button @click="showCancelModal = false" class="w-full py-4 rounded-[1.8rem] text-slate-400 font-bold text-sm hover:text-slate-600 transition-colors">تراجع</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Header Section - Elite Branding -->
    <div class="w-full max-w-md flex flex-col items-center mb-16 animate-in slide-in-from-top duration-700">
      <div class="relative p-1 bg-white rounded-[2.5rem] shadow-[0_15px_30px_rgba(0,0,0,0.03)] border border-slate-100/50 mb-6">
        <img :src="logoUrl" alt="Dawrak Logo" class="w-20 h-20 rounded-[2.2rem] drop-shadow-sm hover:rotate-6 transition-transform duration-500" />
      </div>
      <h1 class="text-3xl font-black text-emerald-950 tracking-tighter">نظـام دورك</h1>
      <p class="text-[0.7rem] font-bold text-emerald-600/60 uppercase tracking-[0.5em] mt-3">النظـام والكرامة</p>
    </div>

    <!-- Main Container -->
    <div class="w-full max-w-lg flex flex-col gap-8">
      
      <!-- State 1: No Ticket (Current Status Only) -->
      <Transition name="fade-scale" mode="out-in">
        <div v-if="myTicket === null" class="w-full flex flex-col items-center">
          
          <!-- Large Card for Serving Info -->
          <div class="w-full bg-white rounded-[4rem] p-16 shadow-[0_50px_100px_-20px_rgba(6,78,59,0.06)] border border-slate-100 flex flex-col items-center relative overflow-hidden group mb-8">
            <div class="absolute inset-0 bg-gradient-to-b from-emerald-50/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-1000"></div>
            
            <div class="flex items-center gap-3 mb-10 bg-emerald-50 px-6 py-2.5 rounded-full border border-emerald-100/50 relative z-10">
              <span class="flex h-2.5 w-2.5 relative">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span class="text-[0.75rem] font-black text-emerald-800 uppercase tracking-widest">مبـاشر الآن</span>
            </div>

            <div class="text-[12rem] font-black leading-none text-emerald-950 tracking-[calc(-0.05em)] tabular-nums mb-6 transition-transform duration-1000 group-hover:scale-[1.03] select-none">
              {{ currentNumber }}
            </div>
            <p class="text-sm font-bold text-slate-400 uppercase tracking-[0.2em] relative z-10">الرقم قيد الخدمة</p>
          </div>

          <!-- Get Ticket Action -->
          <button 
            @click="getTicket" 
            :disabled="isLoading"
            class="w-full max-w-md bg-emerald-600 hover:bg-emerald-700 text-white py-8 rounded-[3rem] text-2xl font-black transition-all shadow-[0_20px_40px_rgba(5,150,105,0.25)] active:scale-95 disabled:opacity-50 flex items-center justify-center gap-5 group"
          >
            <span v-if="isLoading" class="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin"></span>
            <span v-else class="flex items-center gap-4">
              احصل على دورك
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="transition-transform group-hover:-translate-x-3"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </span>
          </button>

          <div class="mt-10 flex items-center gap-3 text-slate-400 font-bold text-xs uppercase tracking-widest">
            <span>المنتظرين:</span>
            <span class="text-emerald-800 font-black text-lg">{{ Math.max(0, lastIssued - currentNumber) }}</span>
          </div>
        </div>

        <!-- State 2: Has Ticket (User Prominence First) -->
        <div v-else class="w-full flex flex-col items-center">
          
          <!-- PROMINENT USER TICKET CARD (ON TOP) -->
          <div class="w-full bg-[#0c1e19] rounded-[4rem] p-16 shadow-[0_50px_100px_-20px_rgba(6,78,59,0.3)] flex flex-col items-center relative overflow-hidden mb-8 transition-all duration-700"
               :class="isMyTurn ? 'ring-[16px] ring-emerald-500/10 scale-105' : ''">
            
            <div class="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 blur-[100px] rounded-full"></div>
            <div class="absolute bottom-0 left-0 w-48 h-48 bg-emerald-300/5 blur-[80px] rounded-full"></div>

            <p class="text-[0.8rem] font-black text-emerald-400 uppercase tracking-[0.4em] mb-4 relative z-10">رقم تذكرتك الخاص</p>
            <div class="text-[13rem] font-black leading-none text-white tracking-tighter tabular-nums mb-10 transition-transform duration-1000 select-none relative z-10">
              {{ myTicket }}
            </div>

            <!-- Turn Status Indicator -->
            <div class="w-full relative z-10">
              <div v-if="isMyTurn" class="bg-emerald-500 text-white py-7 px-10 rounded-[2.5rem] font-black text-2xl text-center shadow-2xl shadow-emerald-500/20 animate-bounce-slow">
                 ✨ تفضل! دورك الآن
              </div>
              <div v-else-if="isPast" class="bg-slate-800 text-slate-500 py-7 px-10 rounded-[2.5rem] font-black text-xl text-center border border-white/5">
                 انتهى مـوعد دورك
                 <p class="text-[0.7rem] font-bold mt-2 cursor-pointer text-emerald-400 hover:underline" @click="myTicket = null">اضغط للتجديد</p>
              </div>
              <!-- Wait Progress info -->
              <div v-else class="grid grid-cols-2 gap-6 w-full">
                <div class="bg-white/5 backdrop-blur-md p-7 rounded-[2.5rem] border border-white/10 text-center">
                  <p class="text-[0.65rem] text-emerald-400/60 font-black mb-1.5 uppercase tracking-widest">أمامك</p>
                  <p class="text-4xl font-black text-white leading-none">{{ peopleAhead }}</p>
                </div>
                <div class="bg-white/5 backdrop-blur-md p-7 rounded-[2.5rem] border border-white/10 text-center">
                  <p class="text-[0.65rem] text-emerald-400/60 font-black mb-1.5 uppercase tracking-widest">مدة الانتظار</p>
                  <p class="text-2xl font-black text-white mt-1 leading-none">~{{ peopleAhead * 5 }}د</p>
                </div>
              </div>
            </div>
          </div>

          <!-- SECONDARY: CURRENT SERVING INFO -->
          <div class="w-full max-w-sm bg-white rounded-[3rem] p-8 shadow-xl border border-slate-100/80 flex flex-row items-center justify-between mb-12">
            <div class="flex flex-col items-start gap-1">
              <span class="text-[0.65rem] font-black text-slate-400 uppercase tracking-widest">يتم خدمته حالياً</span>
              <span class="text-4xl font-black text-emerald-900 leading-none">{{ currentNumber }}</span>
            </div>
            <div class="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-emerald-600"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"></path></svg>
            </div>
          </div>

          <!-- PROFESSIONAL CANCEL TRIGGER -->
          <button 
            @click="requestCancel" 
            class="w-full max-w-xs py-5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-[2.2rem] text-xs font-black uppercase tracking-[0.3em] transition-all border border-rose-100/30 flex items-center justify-center gap-3 group"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="opacity-50 group-hover:rotate-90 transition-transform duration-500">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
            <span>إلغاء الموعد والحجز</span>
          </button>
        </div>
      </Transition>

    </div>

    <!-- ELITE FOOTER -->
    <div class="mt-auto pt-16 pb-8 flex flex-col items-center gap-6 opacity-30 text-[0.7rem] font-black uppercase tracking-[0.6em] pointer-events-none w-full max-w-xs">
      <div class="h-[1px] w-full bg-slate-300/50"></div>
      <span class="text-center">Dawrak Elite Service System</span>
    </div>

  </div>
</template>

<style scoped>
.safe-area-inset {
  padding-top: max(3rem, env(safe-area-inset-top));
  padding-bottom: max(2rem, env(safe-area-inset-bottom));
}

.shadow-3xl {
  box-shadow: 0 60px 120px -30px rgba(0, 78, 59, 0.15);
}

/* Elite Scale Animation */
.scale-animate {
  animation: elitePulse 2.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes elitePulse {
  0%, 100% { transform: scale(1); opacity: 0.8; }
  50% { transform: scale(1.1); opacity: 1; }
}

.animate-bounce-slow {
  animation: bounceSlow 2s infinite ease-in-out;
}

@keyframes bounceSlow {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}

/* Vue Transitions */
.toast-enter-active, .toast-leave-active {
  transition: all 0.6s cubic-bezier(0.19, 1, 0.22, 1);
}
.toast-enter-from { opacity: 0; transform: translate(-50%, -40px); }
.toast-leave-to { opacity: 0; transform: translate(-50%, -10px); }

.modal-enter-active, .modal-leave-active {
  transition: opacity 0.4s ease;
}
.modal-enter-active .relative, .modal-leave-active .relative {
  transition: transform 0.5s cubic-bezier(0.19, 1, 0.22, 1);
}
.modal-enter-from { opacity: 0; }
.modal-enter-from .relative { transform: scale(1.05) translateY(20px); }
.modal-leave-to { opacity: 0; }
.modal-leave-to .relative { transform: scale(0.98); }

.fade-scale-enter-active, .fade-scale-leave-active {
  transition: all 0.8s cubic-bezier(0.19, 1, 0.22, 1);
}
.fade-scale-enter-from { opacity: 0; transform: scale(0.96) translateY(30px); }
.fade-scale-leave-to { opacity: 0; transform: scale(1.04) translateY(-30px); }

.fade-enter-active, .fade-leave-active { transition: opacity 0.8s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* Responsive adjustments */
@media (max-width: 480px) {
  .text-\[12rem\] { font-size: 8rem; }
  .text-\[13rem\] { font-size: 9rem; }
  .p-16 { padding: 3rem 2rem; }
}
</style>
