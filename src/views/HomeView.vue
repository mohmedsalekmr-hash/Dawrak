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

// Sound Configuration
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
    showCelebration.value = true
    setTimeout(() => showCelebration.value = false, 3000)
  } else {
    console.error('Error getting ticket:', error)
  }
  isLoading.value = false
}

function cancelTicket() {
  if (confirm('هل أنت متأكد من إلغاء دورك؟')) {
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
</script>

<template>
  <div class="min-h-screen bg-[#051c14] text-white flex flex-col items-center justify-start px-6 pt-12 pb-20 safe-area-inset font-sans selection:bg-emerald-500/30 overflow-x-hidden" dir="rtl">
    
    <!-- Background Decor -->
    <div class="fixed inset-0 pointer-events-none overflow-hidden">
      <div class="absolute -top-24 -right-24 w-96 h-96 bg-emerald-500/10 blur-[120px] rounded-full"></div>
      <div class="absolute bottom-0 -left-24 w-80 h-80 bg-emerald-600/5 blur-[100px] rounded-full"></div>
    </div>

    <!-- Header / Branding -->
    <div class="w-full max-w-lg mb-12 flex flex-col items-center animate-fade-in relative z-10">
      <div class="p-1 px-4 bg-white/5 rounded-[2rem] border border-white/10 backdrop-blur-xl mb-6 shadow-2xl">
        <img :src="logoUrl" alt="Dawrak Logo" class="h-16 w-auto object-contain hover:scale-110 transition-transform duration-500" />
      </div>
      <h1 class="text-3xl font-black tracking-tight text-white mb-2">نظام دورك</h1>
      <p class="text-[0.7rem] font-bold text-emerald-400/60 uppercase tracking-[0.5em]">النظام والكرامة</p>
    </div>

    <!-- Main Live Queue Section -->
    <div class="w-full max-w-lg space-y-8 relative z-10">
      
      <!-- Primary Display: Serving Number -->
      <div class="bg-white/5 backdrop-blur-3xl rounded-[4rem] p-16 shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)] border border-white/5 flex flex-col items-center relative overflow-hidden group">
        <div class="absolute inset-0 bg-gradient-to-tr from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-1000"></div>
        
        <div class="flex items-center gap-3 mb-10 bg-emerald-500/10 px-6 py-2 rounded-full border border-emerald-500/20">
          <span class="flex h-2.5 w-2.5 relative">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span class="text-[0.75rem] font-black text-emerald-400 uppercase tracking-widest">تحديث مباشر</span>
        </div>

        <div class="text-[13rem] font-black leading-none text-white tracking-[calc(-0.06em)] tabular-nums mb-8 select-none transition-transform duration-1000 group-hover:scale-105 animate-breathing drop-shadow-emerald">
          {{ currentNumber }}
        </div>
        <p class="text-sm font-bold text-emerald-400/40 uppercase tracking-[0.2em]">الرقم قيد الخدمة حالياً</p>
      </div>

      <!-- Action Area -->
      <Transition name="fade-slide" mode="out-in">
        
        <!-- State: No Ticket -->
        <div v-if="myTicket === null" class="w-full flex flex-col items-center gap-10">
          <button 
            @click="getTicket" 
            :disabled="isLoading"
            class="w-full bg-white text-emerald-950 py-8 rounded-[3rem] text-3xl font-black transition-all shadow-[0_20px_40px_rgba(255,255,255,0.1)] hover:bg-emerald-50 hover:shadow-white/20 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-5 group"
          >
            <span v-if="isLoading" class="w-8 h-8 border-4 border-emerald-950/30 border-t-emerald-950 rounded-full animate-spin"></span>
            <span v-else class="flex items-center gap-4">
              احصل على رقمك
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="transition-transform group-hover:-translate-x-3"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </span>
          </button>
          
          <div class="flex items-center gap-4 text-emerald-400/40 font-bold text-xs uppercase tracking-[0.4em]">
            <span>إجمالي المنتظرين:</span>
            <span class="text-white font-black text-xl tracking-normal">{{ Math.max(0, lastIssued - currentNumber) }}</span>
          </div>
        </div>

        <!-- State: User Priority -->
        <div v-else class="w-full space-y-8">
          
          <!-- User Ticket Card -->
          <div 
            class="bg-emerald-900/40 backdrop-blur-3xl rounded-[4rem] p-12 border transition-all duration-700 flex flex-col items-center relative overflow-hidden"
            :class="isMyTurn ? 'border-emerald-400 ring-[20px] ring-emerald-400/10 shadow-[0_0_100px_rgba(52,211,153,0.1)]' : 'border-white/5'"
          >
            <div class="absolute -right-12 -bottom-12 text-[15rem] font-black text-white/5 select-none pointer-events-none">{{ myTicket }}</div>
            
            <p class="text-[0.8rem] font-black text-emerald-400 uppercase tracking-[0.4em] mb-4 relative z-10">رقم تذكرتك الخاص</p>
            <div class="text-[10rem] font-black text-white leading-none mb-10 tabular-nums relative z-10 drop-shadow-lg">{{ myTicket }}</div>

            <!-- Status Messaging -->
            <div v-if="isMyTurn && !isFinished" class="w-full bg-emerald-400 text-emerald-950 py-7 px-10 rounded-[2.5rem] font-black text-2xl text-center shadow-2xl animate-bounce-slow">
               ✨ تفضل! حان دورك الآن
            </div>
            <div v-else-if="isFinished" class="w-full bg-white/5 text-emerald-400/40 py-7 px-10 rounded-[2.5rem] font-black text-center border border-white/5">
               انتهى مـوعد دوركم
               <p class="text-[0.7rem] font-bold mt-2 cursor-pointer text-emerald-400 underline underline-offset-4" @click="myTicket = null">اضغط للتجديد</p>
            </div>
            <!-- Wait Progress -->
            <div v-else class="grid grid-cols-2 gap-6 w-full relative z-10">
              <div class="bg-white/5 p-8 rounded-[2.5rem] border border-white/5 text-center">
                <p class="text-[0.65rem] text-emerald-400/60 font-black mb-1.5 uppercase tracking-widest">أمامكم</p>
                <p class="text-4xl font-black text-white leading-none">{{ peopleAhead }}</p>
              </div>
              <div class="bg-white/5 p-8 rounded-[2.5rem] border border-white/5 text-center">
                <p class="text-[0.65rem] text-emerald-400/60 font-black mb-1.5 uppercase tracking-widest">المـدة</p>
                <p class="text-3xl font-black text-white mt-1 leading-none">~{{ peopleAhead * 5 }}د</p>
              </div>
            </div>
          </div>

          <!-- Professional Cancellation -->
          <button 
            @click="cancelTicket" 
            class="w-full py-6 bg-transparent hover:bg-rose-500/10 text-rose-400 rounded-[2rem] text-[0.7rem] font-black uppercase tracking-[0.4em] transition-all border border-rose-500/20 flex items-center justify-center gap-4 hover:border-rose-500/40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="opacity-50"><path d="M18 6L6 18M6 6l12 12"/></svg>
            إلغاء حجز الموعد
          </button>
        </div>
      </Transition>
    </div>

    <!-- Elite Footer -->
    <div class="mt-auto pt-20 pb-4 flex flex-col items-center gap-8 opacity-20 text-[0.7rem] font-black uppercase tracking-[0.6em] pointer-events-none w-full max-w-xs transition-opacity hover:opacity-100">
      <div class="h-[1px] w-full bg-emerald-400/30"></div>
      <span class="text-center">Dawrak Elite Service • النظام والكرامة</span>
    </div>

    <!-- Celebration Overlay -->
    <Transition name="fade">
      <div v-if="showCelebration" class="fixed inset-0 z-[200] pointer-events-none flex items-center justify-center bg-[#051c14]/60 backdrop-blur-md">
        <div class="relative scale-animate text-[12rem] drop-shadow-[0_0_50px_rgba(52,211,153,0.5)]">🎫</div>
      </div>
    </Transition>

  </div>
</template>

<style scoped>
.safe-area-inset {
  padding-top: max(4rem, env(safe-area-inset-top));
  padding-bottom: max(2rem, env(safe-area-inset-bottom));
}

/* Luxury Breathing Animation */
.animate-breathing {
  animation: breathing 4s ease-in-out infinite;
}

@keyframes breathing {
  0%, 100% { transform: scale(1); filter: brightness(1); }
  50% { transform: scale(1.02); filter: brightness(1.2); }
}

.animate-bounce-slow {
  animation: bounceSlow 3s infinite ease-in-out;
}

@keyframes bounceSlow {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

.drop-shadow-emerald {
  filter: drop-shadow(0 0 30px rgba(52, 211, 153, 0.2));
}

/* Animations & Transitions */
.animate-fade-in {
  animation: fadeIn 1s cubic-bezier(0.19, 1, 0.22, 1);
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-20px); }
  to { opacity: 1; transform: translateY(0); }
}

.fade-slide-enter-active, .fade-slide-leave-active {
  transition: all 0.8s cubic-bezier(0.19, 1, 0.22, 1);
}
.fade-slide-enter-from { opacity: 0; transform: translateY(40px) scale(0.96); }
.fade-slide-leave-to { opacity: 0; transform: translateY(-40px) scale(1.04); }

.fade-enter-active, .fade-leave-active { transition: opacity 0.8s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.scale-animate {
  animation: scoutScale 2.5s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}

@keyframes scoutScale {
  0%, 100% { transform: scale(1); opacity: 0.8; }
  50% { transform: scale(1.1); opacity: 1; }
}

@media (max-width: 480px) {
  .text-\[13rem\] { font-size: 9rem; }
  .text-\[10rem\] { font-size: 7rem; }
  .p-16 { padding: 4rem 2rem; }
}
</style>
