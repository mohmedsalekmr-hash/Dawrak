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
const showMessage = ref<{ type: 'success' | 'info' | 'error', text: string } | null>(null)

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
    displayToast('success', 'تم حجز دورك بنجاح! شكراً لانتظارك.')
  } else {
    console.error('Error getting ticket:', error)
    displayToast('error', 'حدث خطأ أثناء حجز التذكرة. الرجاء المحاولة مرة أخرى.')
  }
  isLoading.value = false
}

function cancelOrder() {
  if (confirm('هل أنت متأكد من إلغاء التذكرة؟')) {
    myTicket.value = null
    displayToast('info', 'تم إلغاء حجزك بنجاح. نتمنى رؤيتك قريباً.')
  }
}

function triggerCelebration() {
  showCelebration.value = true
  setTimeout(() => showCelebration.value = false, 3000)
}

function displayToast(type: 'success' | 'info' | 'error', text: string) {
  showMessage.value = { type, text }
  setTimeout(() => showMessage.value = null, 4000)
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
  <div class="min-h-screen bg-slate-50 flex flex-col items-center p-6 relative overflow-hidden" dir="rtl">
    
    <!-- Nice Flashy Celebration Overlay -->
    <Transition name="fade">
      <div v-if="showCelebration" class="fixed inset-0 z-50 pointer-events-none flex items-center justify-center">
        <div class="absolute inset-0 bg-emerald-500/10 backdrop-blur-[2px]"></div>
        <div class="relative animate-bounce-scale text-6xl">✨ 🎫 ✨</div>
      </div>
    </Transition>

    <!-- Toast Message -->
    <Transition name="slide-up">
      <div v-if="showMessage" 
           class="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 backdrop-blur-md border border-white/20"
           :class="{
             'bg-emerald-600 text-white': showMessage.type === 'success',
             'bg-blue-600 text-white': showMessage.type === 'info',
             'bg-red-600 text-white': showMessage.type === 'error'
           }">
        <span class="font-bold text-sm">{{ showMessage.text }}</span>
      </div>
    </Transition>

    <!-- Logo Section -->
    <div class="mt-8 mb-12 flex flex-col items-center animate-fade-in">
      <img :src="logoUrl" alt="Dawrak Logo" class="w-24 h-24 mb-4 drop-shadow-xl transform hover:rotate-3 transition-transform" />
      <h1 class="text-2xl font-black text-emerald-950 tracking-tight">نظـام دورك للأرزاق</h1>
    </div>

    <!-- Main Container -->
    <div class="w-full max-w-md bg-white rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.05)] border border-slate-100 overflow-hidden relative group">
      <!-- Top Decorative Bar -->
      <div class="h-2 w-full bg-emerald-500"></div>

      <div class="p-10 flex flex-col items-center">
        
        <!-- Live Status Heading -->
        <div class="flex items-center gap-2 mb-6">
          <div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
          <span class="text-[0.6rem] font-black uppercase tracking-[0.2em] text-slate-400">مبـاشر الآن</span>
        </div>

        <!-- Current Serving Number -->
        <div class="text-[8rem] font-black leading-none text-emerald-900 tracking-tighter mb-4 tabular-nums drop-shadow-sm transition-all group-hover:scale-105 duration-500">
          {{ currentNumber }}
        </div>
        <p class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-10">الرقم الذي يتم خدمته حالياً</p>

        <!-- Dynamic Content -->
        <div class="w-full">
          
          <!-- State: No Ticket -->
          <Transition name="scale" mode="out-in">
            <div v-if="myTicket === null" class="flex flex-col items-center">
              <button 
                @click="getTicket" 
                :disabled="isLoading"
                class="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-6 rounded-3xl text-xl font-black shadow-xl shadow-emerald-200 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3"
              >
                <span v-if="isLoading" class="w-6 h-6 border-4 border-white/30 border-t-white rounded-full animate-spin"></span>
                <span v-else>احصل على رقمك الآن</span>
              </button>
              
              <div class="mt-6 flex items-center gap-2 bg-slate-50 px-4 py-2 rounded-full border border-slate-100">
                <span class="text-slate-400 text-[0.7rem] font-bold">إجمالي المنتظرين:</span>
                <span class="text-emerald-700 font-black text-sm">{{ Math.max(0, lastIssued - currentNumber) }}</span>
              </div>
            </div>

            <!-- State: Has Ticket -->
            <div v-else class="w-full">
              <div class="bg-slate-50 rounded-[1.8rem] p-8 border border-slate-100 transition-all duration-500"
                   :class="isMyTurn ? 'ring-4 ring-emerald-500 border-transparent bg-emerald-50' : ''">
                
                <p class="text-[0.7rem] font-bold text-slate-400 mb-2 uppercase">رقمك الخاص</p>
                <div class="text-6xl font-black text-emerald-950 mb-6">{{ myTicket }}</div>

                <!-- Turn Status -->
                <div v-if="isMyTurn" class="bg-emerald-600 text-white py-4 px-6 rounded-2xl font-black text-center shadow-lg animate-pulse">
                   ✨ تفضل! حان دورك الآن ✨
                </div>
                <div v-else-if="isPast" class="bg-slate-200 text-slate-600 py-4 px-6 rounded-2xl font-black text-center decoration-red-500 line-through">
                   فات موعد دورك
                   <p class="text-[0.6rem] no-underline font-bold mt-2 cursor-pointer hover:text-emerald-700" @click="myTicket = null">اضغط للتجديد</p>
                </div>
                <!-- Wait Info -->
                <div v-else class="grid grid-cols-2 gap-4">
                  <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 text-center">
                    <p class="text-[0.6rem] text-slate-400 font-bold mb-1">أمامك</p>
                    <p class="text-2xl font-black text-emerald-800">{{ peopleAhead }}</p>
                  </div>
                  <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 text-center">
                    <p class="text-[0.6rem] text-slate-400 font-bold mb-1">وقت تقريبي</p>
                    <p class="text-sm font-black text-emerald-800 mt-1">~ {{ peopleAhead * 5 }} دقيقة</p>
                  </div>
                </div>
              </div>

              <!-- Cancel Button -->
              <button @click="cancelOrder" class="w-full mt-6 py-3 text-red-500 hover:text-red-700 text-[0.7rem] font-black uppercase tracking-widest transition-colors">
                إلغاء حجز الدور
              </button>
            </div>
          </Transition>

        </div>
      </div>
    </div>

    <!-- Footer -->
    <footer class="mt-auto mb-6 text-slate-300 text-[0.6rem] font-bold uppercase tracking-widest opacity-50">
      النظام والكرامة • DAWRAK SYSTEM
    </footer>

  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 1s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

.animate-fade-in-up {
  animation: fadeInUp 0.5s ease-out forwards;
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.animate-bounce-scale {
  animation: bounceScale 3s infinite;
}

@keyframes bounceScale {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.3); }
}

/* Transitions */
.scale-enter-active, .scale-leave-active {
  transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.scale-enter-from, .scale-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.5s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

.slide-up-enter-active, .slide-up-leave-active {
  transition: all 0.4s ease;
}
.slide-up-enter-from {
  transform: translate(-50%, 100%);
  opacity: 0;
}
.slide-up-leave-to {
  transform: translate(-50%, 50%);
  opacity: 0;
}
</style>
