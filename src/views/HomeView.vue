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
    displayToast('success', 'تم حجز الموعد بنجاح')
  } else {
    console.error('Error getting ticket:', error)
    displayToast('error', 'نعتذر، لم نتمكن من إتمام الحجز')
  }
  isLoading.value = false
}

function requestCancel() {
  showCancelModal.value = true
}

function confirmCancel() {
  myTicket.value = null
  showCancelModal.value = false
  displayToast('info', 'تم إلغاء الموعد المسبق بنجاح')
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
  <div class="min-h-screen bg-[#f8fafc] flex flex-col items-center justify-start px-6 safe-area-inset font-sans" dir="rtl">
    
    <!-- Toast Notification -->
    <Transition name="toast">
      <div v-if="showToast" 
           class="fixed top-8 inset-x-6 mx-auto z-[200] px-8 py-5 rounded-[2rem] shadow-2xl flex items-center justify-center max-w-sm backdrop-blur-2xl border border-white/40"
           :class="{
             'bg-emerald-600/95 text-white shadow-emerald-200/50': showToast.type === 'success',
             'bg-slate-900/95 text-white shadow-slate-200/50': showToast.type === 'info',
             'bg-rose-600/95 text-white shadow-rose-200/50': showToast.type === 'error'
           }">
        <span class="font-bold text-sm text-center leading-relaxed">{{ showToast.text }}</span>
      </div>
    </Transition>

    <!-- Celebration Overlay -->
    <Transition name="fade">
      <div v-if="showCelebration" class="fixed inset-0 z-50 pointer-events-none flex items-center justify-center">
        <div class="absolute inset-0 bg-emerald-50/10 backdrop-blur-[1px]"></div>
        <div class="relative scale-animate text-[8rem] drop-shadow-2xl">🎫</div>
      </div>
    </Transition>

    <!-- Professional Cancellation Modal -->
    <Transition name="modal">
      <div v-if="showCancelModal" class="fixed inset-0 z-[110] p-6 flex items-center justify-center">
        <div class="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" @click="showCancelModal = false"></div>
        <div class="relative w-full max-w-sm bg-white rounded-[3rem] p-10 shadow-3xl text-center border border-slate-100 overflow-hidden">
          <div class="absolute top-0 left-0 w-full h-1.5 bg-rose-500"></div>
          <div class="w-16 h-16 bg-rose-50 rounded-2xl flex items-center justify-center mx-auto mb-8">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-rose-600">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </div>
          <h2 class="text-2xl font-black text-slate-900 mb-3 tracking-tight">إلغاء الموعد</h2>
          <p class="text-slate-500 mb-10 leading-relaxed text-sm">هل أنت متأكد من رغبتك في إلغاء تذكرتك؟ سيتم حذف دوركم ولن تتمكنوا من استعادته لاحقاً.</p>
          <div class="flex flex-col gap-3">
             <button @click="confirmCancel" class="w-full py-5 rounded-[1.5rem] bg-rose-600 text-white font-black text-lg transition-all shadow-xl shadow-rose-200 active:scale-95">نعم، إلغاء الموعد</button>
             <button @click="showCancelModal = false" class="w-full py-4 text-slate-400 font-bold hover:text-slate-600 transition-colors">تراجع</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Branding Section -->
    <div class="mt-12 mb-16 flex flex-col items-center animate-in slide-in-from-top duration-700">
      <div class="p-1 px-4 bg-white rounded-[1.5rem] shadow-sm border border-slate-100 mb-6 transition-transform hover:scale-105">
        <img :src="logoUrl" alt="Dawrak Logo" class="h-16 w-auto object-contain" />
      </div>
      <h1 class="text-2xl font-black text-emerald-950 tracking-tight">نظام إدارة الطوابير</h1>
      <p class="text-[0.6rem] font-bold text-emerald-600/50 uppercase tracking-[0.4em] mt-3">الدقة والارتقاء في الخدمة</p>
    </div>

    <!-- Main Dynamic Container -->
    <div class="w-full max-w-lg mb-12">
      <Transition name="fade-scale" mode="out-in">
        
        <!-- State: No Ticket (Showing General Status) -->
        <div v-if="myTicket === null" class="flex flex-col items-center">
          <div class="w-full bg-white rounded-[3.5rem] p-12 shadow-[0_40px_80px_-15px_rgba(0,0,0,0.05)] border border-slate-100 flex flex-col items-center relative overflow-hidden group mb-10">
            <div class="flex items-center gap-2 mb-10 bg-emerald-50 px-5 py-2 rounded-full border border-emerald-100/30">
              <span class="flex h-2.5 w-2.5 relative">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span class="text-[0.65rem] font-black text-emerald-700 uppercase tracking-widest">تحديث مباشر</span>
            </div>

            <div class="text-[12rem] font-black leading-none text-emerald-950 tracking-tighter tabular-nums mb-8 select-none group-hover:scale-105 transition-transform duration-1000">
              {{ currentNumber }}
            </div>
            <p class="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mb-2 px-8 text-center leading-relaxed">الرقم جاري خدمته حالياً</p>
          </div>

          <button 
            @click="getTicket" 
            :disabled="isLoading"
            class="w-full max-w-sm bg-emerald-600 hover:bg-emerald-700 text-white py-7 rounded-[2.2rem] text-2xl font-black shadow-2xl shadow-emerald-200/50 transition-all active:scale-95 group flex items-center justify-center gap-4"
          >
            <span v-if="isLoading" class="w-7 h-7 border-4 border-white/30 border-t-white rounded-full animate-spin"></span>
            <span v-else class="flex items-center gap-3">
              احجز دورك الآن
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="transition-transform group-hover:-translate-x-2">
                <path d="m15 18-6-6 6-6"/>
              </svg>
            </span>
          </button>

          <div class="mt-10 flex items-center gap-3 text-slate-300 font-bold text-[0.6rem] uppercase tracking-widest">
            <span>إجمالي المنتظرين:</span>
            <span class="text-emerald-700/60 font-black text-base">{{ Math.max(0, lastIssued - currentNumber) }}</span>
          </div>
        </div>

        <!-- State: Has Ticket (Showing User Priority) -->
        <div v-else class="flex flex-col items-center">
          
          <!-- Large User Ticket Card -->
          <div class="w-full bg-emerald-600 rounded-[3.5rem] p-12 shadow-[0_45px_90px_-20px_rgba(5,150,105,0.3)] flex flex-col items-center relative overflow-hidden mb-10 border border-emerald-500/20"
               :class="isMyTurn ? 'ring-[16px] ring-emerald-500/10 scale-105' : ''">
            
            <div class="absolute top-0 left-0 w-full h-full bg-gradient-to-tr from-emerald-700 via-transparent to-emerald-400 opacity-30 select-none"></div>

            <p class="text-[0.7rem] font-black text-emerald-100/60 uppercase tracking-[0.4em] mb-4 relative z-10">رقم تذكرتك</p>
            <div class="text-[13rem] font-black leading-none text-white tracking-tighter tabular-nums mb-12 select-none relative z-10 drop-shadow-2xl">
              {{ myTicket }}
            </div>

            <!-- Enhanced Turn Status -->
            <div class="w-full relative z-10">
              <div v-if="isMyTurn" class="bg-white text-emerald-700 py-6 px-8 rounded-3xl font-black text-xl text-center shadow-2xl animate-bounce-slow">
                 تفضل، حان دوركم يرجى التوجه للموظف
              </div>
              <div v-else-if="isPast" class="bg-emerald-800/40 text-emerald-200/60 py-6 px-8 rounded-3xl font-black text-center border border-white/5">
                 انتهى مـوعد دوركم
                 <p class="text-[0.65rem] font-bold mt-2 cursor-pointer text-white underline" @click="myTicket = null">اضغط للتجديد</p>
              </div>
              <div v-else class="grid grid-cols-2 gap-4 w-full">
                <div class="bg-white/10 backdrop-blur-md p-6 rounded-[2rem] border border-white/10 text-center">
                  <p class="text-[0.6rem] text-emerald-200 font-black mb-1.5 uppercase tracking-widest">أمامكم</p>
                  <p class="text-3xl font-black text-white leading-none">{{ peopleAhead }} أشخاص</p>
                </div>
                <div class="bg-white/10 backdrop-blur-md p-6 rounded-[2rem] border border-white/10 text-center">
                  <p class="text-[0.6rem] text-emerald-200 font-black mb-1.5 uppercase tracking-widest">الوقت المتوقع</p>
                  <p class="text-2xl font-black text-white mt-1 leading-none">~{{ peopleAhead * 5 }} دقيقة</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Smaller Current Progress Card -->
          <div class="w-full max-w-xs bg-white rounded-[2.5rem] p-7 shadow-xl border border-slate-100 flex flex-row items-center justify-between mb-12">
            <div class="flex flex-col items-start gap-1">
              <span class="text-[0.6rem] font-black text-slate-400 uppercase tracking-widest leading-none">الرقم المنادى عليه</span>
              <span class="text-4xl font-black text-emerald-950 leading-none">{{ currentNumber }}</span>
            </div>
            <div class="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="text-emerald-600">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>
              </svg>
            </div>
          </div>

          <!-- Professional Cancel Button -->
          <button 
            @click="requestCancel" 
            class="w-full max-w-sm py-5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-[2rem] text-[0.7rem] font-black uppercase tracking-[0.3em] transition-all border border-rose-100/50 flex items-center justify-center gap-3 shadow-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="opacity-50 group-hover:rotate-90 transition-transform duration-500">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
            إلغاء الموعد المسبق
          </button>
        </div>
      </Transition>
    </div>

    <!-- Professional Footer -->
    <div class="mt-auto pb-10 flex flex-col items-center gap-6 opacity-30 text-[0.6rem] font-black uppercase tracking-[0.5em] pointer-events-none w-full max-w-xs">
      <div class="h-[1px] w-full bg-slate-300/50"></div>
      <span class="text-center">Dawrak Elite Queue Management System</span>
    </div>

  </div>
</template>

<style scoped>
.safe-area-inset {
  padding-top: max(3rem, env(safe-area-inset-top));
  padding-bottom: max(2rem, env(safe-area-inset-bottom));
}

.shadow-3xl {
  box-shadow: 0 60px 120px -30px rgba(0, 0, 0, 0.1);
}

/* Animations */
.scale-animate {
  animation: elitePulse 2.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes elitePulse {
  0%, 100% { transform: scale(1); opacity: 0.8; }
  50% { transform: scale(1.05); opacity: 1; }
}

.animate-bounce-slow {
  animation: bounceSlow 2.5s infinite ease-in-out;
}

@keyframes bounceSlow {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}

/* Transitions */
.toast-enter-active, .toast-leave-active {
  transition: all 0.6s cubic-bezier(0.19, 1, 0.22, 1);
}
.toast-enter-from { opacity: 0; transform: translateY(-40px) scale(0.9); }
.toast-leave-to { opacity: 0; transform: translateY(-10px); }

.modal-enter-active, .modal-leave-active {
  transition: opacity 0.4s ease;
}
.modal-enter-active .relative, .modal-leave-active .relative {
  transition: transform 0.5s cubic-bezier(0.19, 1, 0.22, 1);
}
.modal-enter-from { opacity: 0; }
.modal-enter-from .relative { transform: scale(1.1) translateY(30px); }
.modal-leave-to { opacity: 0; }
.modal-leave-to .relative { transform: scale(0.95); }

.fade-scale-enter-active, .fade-scale-leave-active {
  transition: all 0.7s cubic-bezier(0.19, 1, 0.22, 1);
}
.fade-scale-enter-from { opacity: 0; transform: scale(0.98) translateY(40px); }
.fade-scale-leave-to { opacity: 0; transform: scale(1.02) translateY(-40px); }

.fade-enter-active, .fade-leave-active { transition: opacity 0.8s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@media (max-width: 480px) {
  .text-\[12rem\] { font-size: 8rem; }
  .text-\[13rem\] { font-size: 9rem; }
  .p-12 { padding: 3rem 1.5rem; }
}
</style>
