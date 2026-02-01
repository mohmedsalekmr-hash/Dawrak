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
const isPopAnimating = ref(false)
const showCancelModal = ref(false)
const showToast = ref<{ type: 'success' | 'info' | 'error', text: string } | null>(null)

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
           triggerPopAnimation()
        }
        currentNumber.value = newRow.current_number ?? 0
        lastIssued.value = newRow.last_issued_number ?? 0
      }
    })
    .subscribe()
})

function triggerPopAnimation() {
  isPopAnimating.value = true
  setTimeout(() => isPopAnimating.value = false, 500)
}

/** Actions */
async function getTicket() {
  if (!queueId.value) return
  isLoading.value = true
  
  const { data, error } = await supabase.rpc('next_ticket', { queue_id: queueId.value })
  
  if (data) {
    myTicket.value = data
    displayToast('success', 'تم حجز دورك بنجاح')
  } else {
    console.error('Error getting ticket:', error)
    displayToast('error', 'نعتذر، حدث خطأ ما')
  }
  isLoading.value = false
}

function confirmCancel() {
  myTicket.value = null
  showCancelModal.value = false
  displayToast('info', 'تم إلغاء الحجز')
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
  <div class="min-h-screen bg-white flex flex-col items-center justify-start px-8 py-16 font-['Inter',sans-serif]" dir="rtl">
    
    <!-- Branding -->
    <div class="w-full max-w-lg mb-20 flex flex-col items-center animate-fade-in">
      <img :src="logoUrl" alt="Dawrak Logo" class="h-12 w-auto mb-4 grayscale contrast-125" />
      <h1 class="text-sm font-black uppercase tracking-[0.3em] text-black">Dawrak Neo-Bank System</h1>
    </div>

    <!-- Main Display Section -->
    <div class="w-full max-w-lg flex flex-col items-center">
      
      <!-- Current Serving Number (With massive whitespace) -->
      <div class="py-24 w-full flex flex-col items-center text-center border-b border-slate-100">
        <p class="text-[0.65rem] font-bold text-slate-400 uppercase tracking-widest mb-2">الرقم الحالي قيد الخدمة</p>
        <div 
          class="text-[14rem] font-black leading-none text-black tracking-tighter tabular-nums transition-transform duration-300"
          :class="{ 'scale-110 !text-[#2563EB]': isPopAnimating }"
        >
          {{ currentNumber }}
        </div>
      </div>

      <!-- Action Section -->
      <div class="w-full mt-20">
        <Transition name="fade-slide" mode="out-in">
          
          <!-- State: No Ticket -->
          <div v-if="myTicket === null" class="flex flex-col items-center">
            <button 
              @click="getTicket" 
              :disabled="isLoading"
              class="w-full bg-[#2563EB] text-white py-10 px-8 text-3xl font-black transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-4"
            >
              <span v-if="isLoading" class="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin"></span>
              <span v-else>احصل على رقمك</span>
            </button>
            <div class="mt-8 flex items-center gap-2 text-[0.65rem] font-bold text-slate-400 uppercase tracking-widest">
              <span>المنتظرين:</span>
              <span class="text-black">{{ Math.max(0, lastIssued - currentNumber) }}</span>
            </div>
          </div>

          <!-- State: Has Ticket -->
          <div v-else class="w-full space-y-12">
            <div 
              class="py-16 border-4 flex flex-col items-center transition-all duration-500"
              :class="isMyTurn ? 'border-[#2563EB] bg-blue-50' : 'border-black'"
            >
              <p class="text-[0.65rem] font-black text-slate-400 uppercase tracking-widest mb-4">رقمك الخاص</p>
              <div class="text-[8rem] font-black text-black leading-none mb-10 tabular-nums">{{ myTicket }}</div>

              <!-- Status Badge -->
              <div v-if="isMyTurn" class="bg-[#2563EB] text-white py-6 px-12 font-black text-2xl uppercase">
                 IT'S YOUR TURN • حان دوركم
              </div>
              <div v-else-if="isPast" class="bg-black text-white py-6 px-12 font-black text-xl uppercase">
                 EXPIRED • انتهى الموعد
                 <p class="text-[0.6rem] font-bold mt-2 cursor-pointer underline" @click="myTicket = null">RESET • استلام رقم جديد</p>
              </div>
              <!-- Wait Stats -->
              <div v-else class="flex gap-12 mt-4 text-center">
                <div>
                  <p class="text-[0.65rem] text-slate-400 font-black mb-1">WAITING • أمامكم</p>
                  <p class="text-3xl font-black text-black leading-none">{{ peopleAhead }}</p>
                </div>
                <div>
                  <p class="text-[0.65rem] text-slate-400 font-black mb-1">TIME • الوقت</p>
                  <p class="text-3xl font-black text-black mt-1 leading-none">~{{ peopleAhead * 5 }}M</p>
                </div>
              </div>
            </div>

            <!-- Flat Cancel Trigger -->
            <button 
              @click="showCancelModal = true" 
              class="w-full py-6 border-2 border-slate-200 text-slate-400 font-black text-xs uppercase tracking-widest transition-all hover:bg-slate-50 hover:text-black hover:border-black"
            >
              CANCEL APPOINTMENT • إلغاء الموعد
            </button>
          </div>
        </Transition>
      </div>
    </div>

    <!-- Modals -->
    <Transition name="fade">
      <div v-if="showCancelModal" class="fixed inset-0 z-[110] p-8 flex items-center justify-center">
        <div class="absolute inset-0 bg-white/95" @click="showCancelModal = false"></div>
        <div class="relative w-full max-w-sm border-4 border-black bg-white p-12 text-center">
          <h2 class="text-3xl font-black text-black mb-6 uppercase tracking-tight">CANCEL?</h2>
          <p class="text-slate-500 mb-12 leading-relaxed text-sm font-bold">إلغاء الموعد سيؤدي لفقدان رقمكم الحالي. هل أنتم متأكدون؟</p>
          <div class="flex flex-col gap-4">
             <button @click="confirmCancel" class="w-full py-6 bg-black text-white font-black text-lg uppercase tracking-widest active:scale-95">YES • تأكيد الإلغاء</button>
             <button @click="showCancelModal = false" class="w-full py-4 text-slate-400 font-black text-xs uppercase underline">Go Back • تراجع</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="showToast" 
           class="fixed bottom-12 left-1/2 -translate-x-1/2 z-[200] px-12 py-6 bg-black text-white font-black text-sm uppercase tracking-widest border border-white">
        {{ showToast.text }}
      </div>
    </Transition>

    <!-- Footer -->
    <div class="mt-auto pt-20 text-[0.6rem] font-black uppercase tracking-[0.5em] text-slate-300">
      AUTHENTIC NEO-BANK SYSTEM • DAWRAK
    </div>

  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.8s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Vue Transitions */
.fade-slide-enter-active, .fade-slide-leave-active {
  transition: all 0.4s cubic-bezier(0.19, 1, 0.22, 1);
}
.fade-slide-enter-from { opacity: 0; transform: translateY(10px); }
.fade-slide-leave-to { opacity: 0; transform: translateY(-10px); }

.toast-enter-active, .toast-leave-active {
  transition: all 0.5s cubic-bezier(0.19, 1, 0.22, 1);
}
.toast-enter-from { opacity: 0; transform: translate(-50%, 20px); }
.toast-leave-to { opacity: 0; transform: translate(-50%, 0); }

.fade-enter-active, .fade-leave-active { transition: opacity 0.4s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
