<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { supabase } from '../supabase'
import { useLocalStorage } from '@vueuse/core'
import { useSound } from '@vueuse/sound'
import { translations } from '../translations'
import { useToast } from '../composables/useToast'

/** State Section */
const locale = useLocalStorage<'en' | 'ar'>('dawrak-locale', 'ar')
const currentNumber = ref(0)
const lastIssued = ref(0)
const queueId = ref<number | null>(null)
const isPaused = ref(false)
const lastCalledAt = ref<string | null>(null)
const myTicket = useLocalStorage<number | null>('dawrak-ticket', null)
const serviceStartTime = useLocalStorage<number | null>('dawrak-service-start', null)
const serviceDuration = ref<string | null>(null)
const isAudioEnabled = ref(false)
const showCancelConfirmation = ref(false)
const showHelpGuide = ref(false)
const issuanceStage = ref<'idle' | 'fetching' | 'flipping' | 'revealed'>('idle')
const isLoading = ref(false)
const isIssuing = ref(false)
const isServiceFinished = ref(false)
const isFreshScan = ref(true)
const projectedTicket = ref<number | null>(null)
const toast = useToast()

// Translation helper
const t = (key: keyof typeof translations.en) => {
  return (translations[locale.value] as any)[key] || translations.en[key]
}

// Sound for notification
const { play } = useSound('/notification.mp3', { volume: 1.0, interrupt: true })

/** Core Actions */
async function issueTicket() {
  if (!queueId.value || isLoading.value || isPaused.value) return
  isLoading.value = true
  isIssuing.value = true
  issuanceStage.value = 'fetching'
  
  try {
    const startTime = Date.now()
    // 1. Fetch Ticket
    const { data, error } = await supabase.rpc('next_ticket', { queue_id: queueId.value })
    if (error) throw error

    if (data) {
      projectedTicket.value = data
      
      // 2. Insert into DB
      await supabase.from('tickets').insert({
        queue_id: queueId.value,
        ticket_number: data,
        status: 'waiting'
      })

      // Set myTicket immediately so progress circle logic can start
      myTicket.value = data

      // 3. Wait for minimum 'Processing' time (Reduced to make it feel faster)
      const elapsed = Date.now() - startTime
      const waitTime = Math.max(0, 800 - elapsed)
      await new Promise(resolve => setTimeout(resolve, waitTime))

      // 4. Trigger Flip
      issuanceStage.value = 'flipping'
      await new Promise(resolve => setTimeout(resolve, 400)) // Matches 400ms CSS duration

      // 5. Finalize State
      issuanceStage.value = 'revealed'
      
      // 6. Hold to let them admire the card (Reduced for snappier UX)
      await new Promise(resolve => setTimeout(resolve, 1200))
    }
  } catch (e) {
    console.error('Issue Ticket Error:', e)
    toast.show(t('error_generic'), 'error')
    isIssuing.value = false
  } finally {
    isLoading.value = false
    issuanceStage.value = 'idle'
    projectedTicket.value = null
    isIssuing.value = false
  }
}

function cancelBooking() {
  myTicket.value = null
  serviceStartTime.value = null
  showCancelConfirmation.value = false
  isServiceFinished.value = false
}

function toggleLanguage() {
  locale.value = locale.value === 'en' ? 'ar' : 'en'
}

function toggleNotifications() {
  if (isAudioEnabled.value) {
    isAudioEnabled.value = false
    toast.show(t('audio_disabled'), 'info')
  } else {
    isAudioEnabled.value = true
    toast.show(t('audio_enabled'), 'success')
    play()
  }
}

/** Computed Measurements */
const peopleAheadCount = computed(() => {
  const tNum = myTicket.value
  if (tNum === null) return 0
  return Math.max(0, tNum - currentNumber.value - 1)
})

const queueProgress = computed(() => {
  const ticket = myTicket.value
  if (ticket === null || ticket === 0) return 0
  if (currentNumber.value >= ticket) return 100
  
  // Progress = (current / target) * 100
  // This makes the circle fill gradually as the turn approach
  return Math.min(100, Math.max(0, (currentNumber.value / ticket) * 100))
})

const isMyTurnActive = computed(() => {
  const tNum = myTicket.value
  return tNum !== null && tNum === currentNumber.value
})

const estimatedWaitTime = computed(() => (peopleAheadCount.value + 1) * 2)
const totalServedToday = ref(0)
const totalBookingsToday = ref(0)

/** Initialization & Realtime */
async function loadMetrics() {
  if (!queueId.value) return
  
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayISO = today.toISOString()

  // 1. Total Bookings Today
  const { count: bookingsCount } = await supabase
    .from('tickets')
    .select('*', { count: 'exact', head: true })
    .eq('queue_id', queueId.value)
    .gte('created_at', todayISO)
  
  totalBookingsToday.value = bookingsCount || 0

  // 2. Total Served Today
  const { count: servedCount } = await supabase
    .from('tickets')
    .select('*', { count: 'exact', head: true })
    .eq('queue_id', queueId.value)
    .eq('status', 'called')
    .gte('created_at', todayISO)

  totalServedToday.value = servedCount || 0
}

async function loadInitialData() {
  const { data } = await supabase.from('queues').select('*').limit(1).maybeSingle()
  if (data) {
    queueId.value = data.id
    currentNumber.value = data.current_number ?? 0
    lastIssued.value = data.last_issued_number ?? 0
    isPaused.value = data.name === 'PAUSED'
    lastCalledAt.value = data.last_called_at
    await loadMetrics()
  }
}

onMounted(async () => {
  await loadInitialData()
  
  // Realtime Channel
  const channel = supabase.channel('home-realtime-sync')
  
  channel
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'queues' }, (payload) => {
      const row = payload.new as any
      if (queueId.value && row.id == queueId.value) {
        // Essential: Update current number for the circle progress
        if (row.current_number !== undefined && row.current_number !== currentNumber.value) {
           const newVal = row.current_number
           
           // Update local state first
           currentNumber.value = newVal

           // NOTIFICATION LOGIC: 
           // Trigger if universal audio is enabled OR if it is specifically MY turn
           const isMyTurn = myTicket.value !== null && newVal === myTicket.value
           
            if (isAudioEnabled.value || isMyTurn) {
              // Ring the bell
              play()
              
              // HAPTIC FEEDBACK: WOW factor for mobile
              if ('vibrate' in navigator) {
                navigator.vibrate([100, 50, 100])
              }
              
              // Gorgeous Visual Feedback: Show Toast for someone else's turn
              if (!isMyTurn) {
                 const msg = t('now_serving_notification').replace('{n}', newVal.toString())
                 toast.show(msg, 'info')
              }
            }
        }
        
        if (row.last_issued_number !== undefined) {
          lastIssued.value = row.last_issued_number
        }
        isPaused.value = row.name === 'PAUSED'

        // RECALL LOGIC:
        // If last_called_at updates, and it aligns with MY turn, play sound again.
        if (row.last_called_at !== undefined && row.last_called_at !== lastCalledAt.value) {
           lastCalledAt.value = row.last_called_at
           
           // If it's my turn, play sound (Recall)
           if (myTicket.value !== null && currentNumber.value === myTicket.value) {
              if (isAudioEnabled.value) {
                play()
                if ('vibrate' in navigator) navigator.vibrate([100, 50, 100, 50, 100])
                toast.show(t('attention_recall'), 'info') // Add translation key or generic
              }
           }
        }
      }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets' }, (payload) => {
      const newTicket = payload.new as any
      if (queueId.value && newTicket.queue_id == queueId.value) {
        lastIssued.value = Math.max(lastIssued.value, newTicket.ticket_number)
        totalBookingsToday.value++
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets' }, (payload) => {
      const updatedTicket = payload.new as any
      if (queueId.value && updatedTicket.queue_id == queueId.value && updatedTicket.status === 'called') {
        totalServedToday.value++
        
        // CHECK IF IT WAS MY TICKET
        if (myTicket.value && updatedTicket.ticket_number === myTicket.value) {
           // Calculate Duration
           const end = Date.now()
           const start = serviceStartTime.value || (end - 1000 * 60 * 5) // Fallback 5 mins if missed start
           const diff = end - start
           
           const mins = Math.floor(diff / 60000)
           const secs = Math.floor((diff % 60000) / 1000)
           serviceDuration.value = `${mins}m ${secs}s`
           
           isServiceFinished.value = true
           
           // Cleanup local state for next time (but keep finished view open)
           myTicket.value = null
           serviceStartTime.value = null
           // We do NOT set cancelled true, so next scan works nicely
        }
      }
    })
    .subscribe()

  // IMMEDIATE AUTO-ISSUE (QR SCAN UX):
  // If first time scanning (fresh session/refresh), always issue if no ticket.
  if (myTicket.value === null && !isPaused.value) {
     issueTicket()
  }
  
  isFreshScan.value = false
})

// Watch for Turn Active -> Start Timer
// Watch for Turn Active -> Start Timer
watch(isMyTurnActive, (isActive) => {
  if (isActive && !serviceStartTime.value) {
    serviceStartTime.value = Date.now()
  }
})

// Watch for Completion
watch(totalServedToday, () => {
   // This is a naive trigger, we really need to check specific ticket status from realtime payload
   // But logic is better handled inside the realtime callback 'UPDATE' block if we want precision
})


</script>

<template>
  <div 
    class="fixed inset-0 h-[100dvh] bg-[radial-gradient(circle_at_center,_var(--tw-gradient-from)_0%,_var(--tw-gradient-to)_100%)] from-white via-slate-50 to-slate-200 font-['Poppins',sans-serif] overflow-hidden flex flex-col items-center select-none" 
    :dir="locale === 'ar' ? 'rtl' : 'ltr'"
  >
    
    <!-- Grain/Noise Overlay -->
    <div class="fixed inset-0 pointer-events-none z-0 opacity-[0.04] mix-blend-multiply" style="background-image: url('data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E');"></div>
    
    <!-- Premium Accents -->
    <div class="absolute inset-0 pointer-events-none overflow-hidden transform-gpu" aria-hidden="true">
      <div class="absolute top-[-10%] right-[-10%] w-[400px] h-[400px] bg-emerald-100/40 rounded-full blur-[100px] animate-float-slow will-change-transform"></div>
      <div class="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-teal-100/30 rounded-full blur-[120px] animate-float-reverse will-change-transform"></div>
    </div>

    <!-- Header Brand Pill -->
    <header class="w-full relative z-30 px-6 pt-10 pb-3 flex items-center justify-between gap-3 max-w-md mx-auto">
      <div class="flex-shrink min-w-0 inline-flex items-center bg-white/90 backdrop-blur-md rounded-2xl px-5 py-3 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/50 relative overflow-hidden group/brand">
        <span class="text-xl font-black tracking-tighter bg-gradient-to-r from-slate-900 via-emerald-600 to-slate-900 bg-clip-text text-transparent animate-shimmer-text bg-[length:200%_auto] relative z-10">Dawrak</span>
        
        <!-- Live Bell Indicator -->
        <div v-if="isAudioEnabled" class="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 bg-teal-500 rounded-full text-white shadow-lg animate-float scale-75 origin-center z-20">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        </div>
      </div>

      <!-- Actions Group -->
      <div class="flex items-center gap-2 flex-shrink-0">
        <!-- Help Button (Emerald Glow & Wiggle) -->
        <button 
          @click="showHelpGuide = true"
          class="w-10 h-10 bg-white/90 backdrop-blur-md rounded-2xl border border-slate-100 flex items-center justify-center text-emerald-500 transition-all shadow-lg shadow-emerald-500/10 active:scale-95 hover:animate-wiggle group relative overflow-hidden"
        >
          <div class="absolute inset-0 bg-emerald-500/5 animate-pulse"></div>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="relative z-10 transition-transform group-hover:scale-110"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </button>

        <!-- Language Toggle (Shortcut EN/ع) -->
        <button 
          @click="toggleLanguage"
          class="w-10 h-10 bg-white/90 backdrop-blur-md rounded-2xl border border-slate-100 flex items-center justify-center text-[0.85rem] font-black text-slate-800 active:scale-95 transition-all shadow-lg shadow-black/5 hover:animate-wiggle group overflow-hidden relative"
          :title="locale === 'en' ? 'Switch to Arabic' : 'Switch to English'"
        >
          <div class="absolute inset-0 bg-slate-900/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <span class="relative z-10 transition-transform duration-500 group-hover:scale-110" :class="locale === 'en' ? 'text-lg pt-0.5' : 'text-[0.75rem]'">
            {{ locale === 'en' ? 'ع' : 'EN' }}
          </span>
        </button>
      </div>
    </header>

    <!-- Main View Section -->
    <main class="relative z-20 flex-1 w-full max-w-md mx-auto flex flex-col items-center justify-center px-6">
      
       <!-- PAUSE OVERLAY -->
       <Transition name="fade-scale">
         <div v-if="isPaused" class="absolute inset-0 z-[40] flex items-center justify-center p-6 bg-white/80 backdrop-blur-sm">
            <div class="bg-white rounded-[3rem] p-10 border border-slate-100 shadow-2xl flex flex-col items-center text-center max-w-sm w-full relative overflow-hidden">
               <div class="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-red-400 to-rose-500"></div>
               
               <div class="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mb-6 text-red-500 animate-pulse relative">
                  <div class="absolute inset-0 rounded-full border-4 border-red-100 animate-ping opacity-20"></div>
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
               </div>
               
               <h2 class="text-2xl font-black text-slate-800 mb-3 tracking-tight">{{ t('queue_is_paused') }}</h2>
               <p class="text-slate-400 text-sm font-medium leading-relaxed max-w-[240px]">
                 {{ t('queue_paused_friendly') }}
               </p>
            </div>
         </div>
       </Transition>



      <!-- STATE 1: WELCOME SCREEN (NO CIRCLE) -->
      <Transition name="fade-scale" mode="out-in">
        <div v-if="myTicket === null && !isIssuing && !isServiceFinished && !isFreshScan" class="w-full flex flex-col items-center" :class="{ 'opacity-20 pointer-events-none scale-95 blur-sm transition-all duration-700': isPaused }">
          <div class="w-full bg-white rounded-[2.5rem] shadow-[0_30px_60px_-15px_rgba(0,0,0,0.08)] border border-slate-50/50 p-10 flex flex-col items-center text-center relative overflow-hidden group">
            
            <div class="absolute inset-0 pointer-events-none opacity-[0.03]">
              <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
                <defs><pattern id="grid-welcome" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" stroke-width="1"/></pattern></defs>
                <rect width="100%" height="100%" fill="url(#grid-welcome)" />
              </svg>
            </div>

            <div class="relative z-10 w-full flex flex-col items-center">
              <div class="w-24 h-24 bg-emerald-50 rounded-[2.5rem] flex items-center justify-center shadow-[0_20px_40px_rgba(16,185,129,0.1)] border border-white mb-10 transition-all duration-700 animate-float-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-emerald-500 animate-icon-pulse"><path d="M16 2H1a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/><path d="M4 12h4m-4 4h6"/></svg>
              </div>

              <h1 class="text-4xl font-black text-slate-800 leading-tight mb-4 tracking-tight">
                {{ t('welcome') }} <span class="text-emerald-500">Dawrak</span>
              </h1>
              <p class="text-slate-400 text-lg font-medium leading-relaxed max-w-[280px] mb-12">
                {{ t('get_pass') }}
              </p>

              <button 
                @click="issueTicket"
                class="w-full h-20 bg-[#1e293b] text-white rounded-[2rem] font-bold text-xl flex items-center justify-center gap-4 shadow-[0_24px_48px_rgba(30,41,59,0.25)] hover:bg-slate-800 hover:scale-[1.02] hover:shadow-[0_30px_60px_rgba(30,41,59,0.3)] active:scale-[0.97] transition-all duration-500 overflow-hidden relative group/btn"
              >
                <!-- Premium Button Shimmer -->
                <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-[150%] skew-x-12 group-hover/btn:animate-shimmer-btn"></div>
                
                <span class="relative z-10">{{ t('get_ticket') }}</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="relative z-10 transition-transform duration-500 group-hover/btn:translate-x-1" :class="locale === 'ar' ? 'rotate-180' : ''">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- STATE 2: SERVICE FINISHED (GORGEOUS REVEAL) -->
        <div v-else-if="isServiceFinished" class="w-full h-full flex items-center justify-center p-4">
            <div class="bg-white rounded-[3rem] px-8 py-8 sm:p-10 shadow-[0_30px_100px_-20px_rgba(16,185,129,0.15)] border border-slate-100 flex flex-col items-center text-center max-w-[340px] w-full relative overflow-hidden animate-scale-in">
                
                <div class="absolute inset-0 bg-gradient-to-br from-emerald-50/40 via-white to-transparent"></div>
                
                <div class="relative z-10 flex flex-col items-center w-full">
                   <!-- Premium Success Icon -->
                   <div class="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-2xl shadow-emerald-500/10 border border-emerald-50 mb-5 group relative transition-transform duration-700 hover:scale-110">
                      <div class="absolute inset-0 rounded-full bg-emerald-500/5 animate-ping opacity-50"></div>
                      <div class="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center text-white shadow-xl shadow-emerald-500/30">
                         <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" class="animate-draw-circle"><polyline points="20 6 9 17 4 12"/></svg>
                      </div>
                   </div>
                   
                   <h2 class="text-3xl font-black text-slate-900 mb-2 tracking-tighter leading-none">{{ t('thank_you') }}</h2>
                   <p class="text-slate-900 font-bold mb-6 text-base opacity-95 leading-tight px-2">{{ t('see_you_again') }}</p>
                   
                   <!-- Service Stats Pill -->
                   <div class="flex flex-col items-center gap-1.5 bg-slate-900/5 backdrop-blur-sm px-6 py-3 rounded-[1.5rem] border border-white shadow-sm mb-8 w-full">
                       <span class="text-[0.6rem] font-black text-slate-800 uppercase tracking-[0.2em]">{{ t('elapsed_time') }}</span>
                       <div class="flex items-center gap-2">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-emerald-500"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          <span class="text-xl font-black text-slate-800 tabular-nums">{{ serviceDuration }}</span>
                       </div>
                   </div>

                   <button 
                     @click="isServiceFinished = false;" 
                     class="w-full h-18 bg-slate-900 text-white rounded-[1.5rem] font-black text-sm uppercase tracking-widest shadow-2xl shadow-slate-900/40 active:scale-95 transition-all relative overflow-hidden group/btn"
                   >
                      <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-[150%] skew-x-12 group-hover/btn:animate-shine transition-all duration-1000"></div>
                      <span class="relative z-10">{{ t('done') }}</span>
                   </button>
                </div>
            </div>
        </div>

        <!-- STATE 3: QUEUE & REVEAL (KEEP THE CIRCLE) -->
        <div v-else class="relative w-full max-w-[min(90vw,400px)] aspect-square flex items-center justify-center" :class="{ 'opacity-20 scale-95 blur-sm transition-all duration-700': isPaused }">
          <!-- Organic Wave Aura (Directly Under the Progress Ring) -->
          <div class="absolute inset-0 pointer-events-none opacity-70 z-0">
            <div class="absolute inset-0 bg-emerald-400 blur-[80px] animate-aura-blob-1 will-change-transform opacity-50"></div>
            <div class="absolute inset-2 bg-teal-400 blur-[90px] animate-aura-blob-2 will-change-transform opacity-40"></div>
            <div class="absolute inset-[-5%] bg-emerald-200 blur-[120px] animate-aura-blob-3 will-change-transform opacity-30"></div>
          </div>
          
          <!-- Shared Boundary Container -->
          <div 
            class="relative w-full h-full flex flex-col items-center justify-center text-center transition-all duration-700 z-20"
          >
            <!-- Shared SVG Definitions -->
            <svg width="0" height="0" class="absolute">
              <defs>
                <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="#065f46" /> <!-- Darker green -->
                  <stop offset="100%" stop-color="#34d399" /> <!-- Lighter green -->
                </linearGradient>
              </defs>
            </svg>
            <!-- Solid White Inner Core (To prevent blob bleed through text area) -->
            <div class="absolute inset-1.5 bg-white/95 backdrop-blur-3xl rounded-full shadow-[0_30px_60px_-15px_rgba(0,0,0,0.12)] border border-white/50 z-0"></div>
            <!-- REVEAL ANIMATION (3D FLIP CARD) -->
            <div v-if="isIssuing" class="flex flex-col items-center justify-center w-full h-full relative z-20 perspective-1000">
               <div 
                 class="relative w-48 aspect-[3/4] preserve-3d transition-all duration-[400ms] ease-out will-change-transform"
                 :class="{ 
                   'rotate-y-180 scale-105 shadow-emerald-200/50': issuanceStage === 'flipping' || issuanceStage === 'revealed',
                   'scale-95': issuanceStage === 'fetching'
                 }"
               >
                  <!-- FRONT: LOADING STATE -->
                   <div class="absolute inset-0 backface-hidden bg-white rounded-3xl shadow-2xl border border-emerald-100/50 flex flex-col items-center justify-center overflow-hidden">
                     <div class="absolute inset-0 bg-gradient-to-br from-white to-slate-50"></div>
                     <div class="relative z-10 flex flex-col items-center gap-6">
                        <div class="relative">
                          <div class="w-12 h-12 rounded-full border-4 border-slate-100 border-t-emerald-500 animate-spin"></div>
                          <div class="absolute inset-0 flex items-center justify-center">
                             <div class="w-6 h-6 bg-emerald-50 rounded-full animate-pulse"></div>
                          </div>
                        </div>
                        <div class="text-center space-y-2">
                           <p class="text-[0.6rem] font-black text-slate-800 uppercase tracking-[0.2em]">{{ t('queue_service') }}</p>
                           <p class="text-[0.5rem] font-bold text-slate-400 uppercase tracking-[0.2em] animate-pulse">{{ t('materializing') }}</p>
                        </div>
                     </div>
                  </div>

                  <!-- BACK: TICKET REVEALED -->
                  <div class="absolute inset-0 backface-hidden rotate-y-180 bg-white rounded-3xl shadow-2xl border border-emerald-500 overflow-hidden flex flex-col">
                     <div class="absolute inset-0 bg-gradient-to-br from-emerald-50/50 to-white"></div>
                     <div class="absolute top-0 left-[-100%] w-full h-full bg-gradient-to-r from-transparent via-white/50 to-transparent skew-x-12 animate-shine pointer-events-none"></div>
                     <div class="absolute top-0 left-0 w-full h-1.5 bg-emerald-500"></div>
                     
                     <div class="relative flex-1 flex flex-col items-center justify-center p-6">
                        <div class="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-200 mb-6">
                           <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M20 6L9 17l-5-5"></path></svg>
                        </div>

                        <span class="text-[0.6rem] font-black text-slate-400 uppercase tracking-widest mb-1">{{ t('your_number') }}</span>
                        <div class="text-8xl sm:text-9xl font-black text-slate-800 tabular-nums tracking-tighter mb-2">{{ projectedTicket }}</div>
                        <span class="text-[0.6rem] font-bold text-emerald-600 uppercase tracking-widest bg-emerald-50 px-3 py-1 rounded-full">Success</span>
                     </div>
                  </div>
               </div>
            </div>

            <!-- ACTIVE WAITING -->
            <div v-else-if="myTicket !== null && !isMyTurnActive" class="flex flex-col items-center w-full h-full justify-center relative z-10 animate-scale-in">
               <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <svg class="w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="47.5" fill="none" stroke="#f1f5f9" stroke-width="4"></circle>
                    
                    <!-- Glow Layer -->
                    <circle 
                      cx="50" cy="50" r="47.5" 
                      fill="none" 
                      stroke-width="4.5" 
                      stroke-linecap="round"
                      stroke-dasharray="298.5" 
                      :stroke-dashoffset="298.5 - (2.985 * queueProgress)"
                      class="transition-all duration-700 ease-out opacity-20 blur-[3px]"
                      :stroke="isPaused ? '#ef4444' : 'url(#progressGradient)'"
                    ></circle>

                    <!-- Main Progress Circle with Shimmer -->
                    <circle 
                      cx="50" cy="50" r="47.5" 
                      fill="none" 
                      stroke-width="4" 
                      stroke-linecap="round"
                      stroke-dasharray="298.5" 
                      :stroke-dashoffset="298.5 - (2.985 * queueProgress)"
                      class="transition-all duration-700 ease-out animate-progress-shimmer"
                      :stroke="isPaused ? '#ef4444' : 'url(#progressGradient)'"
                      style="filter: drop-shadow(0 0 2px rgba(16, 185, 129, 0.2));"
                    ></circle>
                  </svg>
               </div>

                <div class="flex flex-col items-center justify-center gap-1 sm:gap-4 scale-[0.95] sm:scale-100">
                  <div class="text-center">
                    <span 
                      class="text-[0.65rem] font-bold uppercase tracking-[0.3em] mb-[-0.5rem] sm:mb-0 block text-slate-400"
                    >
                      {{ t('position') }}
                    </span>
                    <div class="flex items-baseline justify-center">
                      <span class="text-[6rem] sm:text-[7.5rem] font-black text-slate-900 leading-none tracking-tighter drop-shadow-sm">{{ peopleAheadCount + 1 }}</span>
                    </div>
                  </div>

                  <div class="flex items-center gap-3 sm:gap-4">
                    <div class="flex flex-col items-center px-3 sm:px-4 py-2 bg-white rounded-2xl border border-slate-100 min-w-[75px] sm:min-w-[85px] shadow-sm">
                      <span 
                        class="text-[9px] sm:text-[10px] font-bold uppercase mb-0.5 text-slate-400 tracking-wider"
                      >
                        {{ t('ahead') }}
                      </span>
                      <span class="text-xl sm:text-2xl font-black text-slate-800 tabular-nums">{{ peopleAheadCount }}</span>
                    </div>
                    <div class="flex flex-col items-center px-3 sm:px-4 py-2 bg-white rounded-2xl border border-slate-100 min-w-[75px] sm:min-w-[85px] shadow-sm">
                      <span 
                        class="text-[9px] sm:text-[10px] font-bold uppercase mb-0.5 text-slate-400 tracking-wider"
                      >
                        {{ t('wait_time') }}
                      </span>
                      <span class="text-xl sm:text-2xl font-black text-slate-800 tabular-nums">{{ estimatedWaitTime }}<span class="text-[10px] sm:text-xs ms-1 text-slate-500 font-bold uppercase tracking-tighter">{{ t('mins') }}</span></span>
                    </div>
                  </div>
                  
                  <div class="px-3 py-1 sm:px-4 sm:py-1.5 bg-emerald-50 text-emerald-600 rounded-full text-[10px] sm:text-xs font-black tracking-widest border border-emerald-100 uppercase mt-1">
                    {{ t('pass') }} #{{ String(myTicket).padStart(3, '0') }}
                  </div>
                </div>
            </div>

            <!-- SUCCESS (Serving) -->
            <div v-else-if="isMyTurnActive" class="flex flex-col items-center justify-center w-full h-full relative z-30 animate-scale-in">
               <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <svg class="w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="47.5" fill="none" stroke="url(#progressGradient)" stroke-width="4.5" stroke-linecap="round" class="animate-draw-circle opacity-20 blur-[3px]"></circle>
                    <circle cx="50" cy="50" r="47.5" fill="none" stroke="url(#progressGradient)" stroke-width="4" stroke-linecap="round" class="animate-draw-circle"></circle>
                  </svg>
               </div>
               <div class="flex flex-col items-center gap-4 animate-bounce-gentle px-8">
                  <div class="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center shadow-xl shadow-emerald-500/20">
                     <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                  </div>
                  <div class="text-center">
                    <h2 class="text-2xl font-black text-slate-800 tracking-tight leading-tight">{{ t('its_your_turn') }}</h2>
                    <p class="text-sm font-bold text-slate-400 mt-1 uppercase tracking-widest">{{ t('proceed_to_counter') }}</p>
                  </div>
               </div>
            </div>
          </div>
        </div>



      </Transition>
    </main>

    <!-- Footer Stats -->
    <footer class="w-full relative z-30 px-10 pb-16" :class="{ 'opacity-20 pointer-events-none scale-95 blur-sm transition-all duration-700': isPaused || isServiceFinished }">
      <Transition name="fade-up" mode="out-in">
        <div v-if="(myTicket === null && !isIssuing) || isServiceFinished" class="flex flex-col items-center w-full max-w-sm mx-auto">
           <!-- Footer is kept empty or simplified to maintain breathing room -->
        </div>
        
        <div v-else-if="myTicket !== null && !isIssuing" class="w-full max-w-sm mx-auto flex flex-col gap-5">
          <!-- Audio Button: Premium Toggle Pill -->
          <button 
            @click="toggleNotifications"
            class="w-full h-18 text-white rounded-full font-black text-[1.1rem] shadow-2xl transition-all flex items-center justify-center gap-3 relative overflow-hidden group active:scale-[0.98]"
            :class="isAudioEnabled ? 'bg-slate-800' : 'bg-gradient-to-r from-emerald-500 to-teal-600 shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:scale-[1.02]'"
          >
            <!-- Animated Shine Effect (Only if not enabled) -->
            <div v-if="!isAudioEnabled" class="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-[150%] skew-x-12 animate-shine pointer-events-none"></div>
            
            <svg width="24" height="24" viewBox="0 0 24 24" :fill="isAudioEnabled ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2.5" class="relative z-10">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span class="relative z-10 tracking-wide">
              {{ isAudioEnabled ? t('audio_enabled') : t('enable_notifications') }}
            </span>
          </button>
          
          <!-- Leave Button: Elegant Glassmorphic Pill -->
          <button @click="showCancelConfirmation = true" class="w-full h-18 bg-white/60 backdrop-blur-xl text-slate-500 hover:bg-rose-50/80 hover:text-rose-600 rounded-full font-bold text-[0.9rem] uppercase tracking-[0.2em] active:scale-[0.98] transition-all flex items-center justify-center border border-white/80 shadow-lg shadow-black/5 gap-2 group">
            <span class="opacity-70 group-hover:opacity-100 transition-opacity">{{ t('leave_queue') }}</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="opacity-40 group-hover:opacity-100 transition-opacity"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </div>
      </Transition>
    </footer>

    <!-- Help Guide Modal -->
    <div v-if="showHelpGuide" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md">
      <div class="bg-white w-full max-w-sm rounded-[3rem] shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh] animate-scale-in">
        <!-- Close Button -->
        <button @click="showHelpGuide = false" class="absolute top-6 right-6 w-10 h-10 bg-slate-100 hover:bg-slate-200 rounded-full flex items-center justify-center text-slate-500 transition-colors z-20">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>

        <div class="overflow-y-auto px-8 pt-12 pb-10 custom-scrollbar">
           <div class="flex flex-col items-center mb-8">
              <div class="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-500 mb-4 shadow-sm">
                 <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <h3 class="text-2xl font-black text-slate-800 tracking-tight">{{ t('guide_welcome_title') }}</h3>
              <p class="text-slate-500 text-sm font-medium mt-1">{{ t('guide_welcome_desc') }}</p>
           </div>

           <div class="space-y-6">
              <!-- Step 1 -->
              <div class="bg-slate-50 border border-slate-100 p-5 rounded-3xl flex gap-4 transition-all hover:bg-white hover:shadow-xl hover:shadow-slate-200/50 group">
                 <div class="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-emerald-500 shadow-sm border border-slate-50 group-hover:scale-110 transition-transform">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 11l3 3 3-3"/></svg>
                 </div>
                 <div class="flex-1">
                    <h4 class="text-sm font-black text-slate-800 mb-1 uppercase tracking-wider">{{ t('step_1_title') }}</h4>
                    <p class="text-xs font-medium text-slate-500 leading-relaxed">{{ t('step_1_desc') }}</p>
                 </div>
              </div>

              <!-- Step 2 -->
              <div class="bg-slate-50 border border-slate-100 p-5 rounded-3xl flex gap-4 transition-all hover:bg-white hover:shadow-xl hover:shadow-slate-200/50 group">
                 <div class="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-blue-500 shadow-sm border border-slate-50 group-hover:scale-110 transition-transform">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20V16"/></svg>
                 </div>
                 <div class="flex-1">
                    <h4 class="text-sm font-black text-slate-800 mb-1 uppercase tracking-wider">{{ t('step_2_title') }}</h4>
                    <p class="text-xs font-medium text-slate-500 leading-relaxed">{{ t('step_2_desc') }}</p>
                 </div>
              </div>

              <!-- Step 3 -->
              <div class="bg-slate-50 border border-slate-100 p-5 rounded-3xl flex gap-4 transition-all hover:bg-white hover:shadow-xl hover:shadow-slate-200/50 group">
                 <div class="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-amber-500 shadow-sm border border-slate-50 group-hover:scale-110 transition-transform">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                 </div>
                 <div class="flex-1">
                    <h4 class="text-sm font-black text-slate-800 mb-1 uppercase tracking-wider">{{ t('step_3_title') }}</h4>
                    <p class="text-xs font-medium text-slate-500 leading-relaxed">{{ t('step_3_desc') }}</p>
                 </div>
              </div>

              <!-- Step 4 -->
              <div class="bg-emerald-50 border border-emerald-100 p-5 rounded-3xl flex gap-4 shadow-lg shadow-emerald-500/5">
                 <div class="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-emerald-600 shadow-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                 </div>
                 <div class="flex-1">
                    <h4 class="text-sm font-black text-emerald-900 mb-1 uppercase tracking-wider">{{ t('step_4_title') }}</h4>
                    <p class="text-xs font-bold text-emerald-700/70 leading-relaxed">{{ t('step_4_desc') }}</p>
                 </div>
              </div>
           </div>

           <button @click="showHelpGuide = false" class="w-full h-16 bg-slate-900 text-white rounded-2xl font-black text-sm uppercase tracking-widest mt-10 active:scale-95 transition-all shadow-xl shadow-slate-900/20">
              {{ t('done') }}
           </button>
        </div>
      </div>
    </div>

    <!-- Confirmation Modal -->
    <div v-if="showCancelConfirmation" class="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-md">
      <div class="bg-white w-full max-w-xs rounded-[2.5rem] p-8 shadow-2xl text-center relative overflow-hidden animate-scale-in">
        <h3 class="text-2xl font-black text-slate-900 mb-3">{{ t('leave_queue') }}</h3>
        <p class="text-slate-500 text-sm font-medium leading-relaxed mb-8">{{ t('leave_queue_desc') }}</p>
        <div class="flex flex-col gap-3">
          <button @click="showCancelConfirmation = false" class="w-full py-4 bg-emerald-500 text-white rounded-2xl font-black shadow-lg shadow-emerald-200">{{ t('stay_here') }}</button>
          <button @click="cancelBooking" class="w-full py-4 bg-slate-50 text-slate-500 rounded-2xl font-bold">{{ t('yes_leave') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes float-slow { 0%, 100% { transform: translate(0,0); } 33% { transform: translate(20px, -20px); } 66% { transform: translate(-10px, 15px); } }
@keyframes float-reverse { 0%, 100% { transform: translate(0,0); } 50% { transform: translate(-30px, 30px); } }
.animate-float-slow { animation: float-slow 12s ease-in-out infinite; }
.animate-float-reverse { animation: float-reverse 15s ease-in-out infinite; }
@keyframes bounce-gentle { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
@keyframes draw-circle { from { stroke-dasharray: 0 283; } to { stroke-dasharray: 283 0; } }
@keyframes scale-in { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes shine { from { left: -100%; } to { left: 100%; } }

.animate-draw-circle { animation: draw-circle 1.2s ease-out forwards; will-change: stroke-dashoffset; }
.animate-bounce-gentle { animation: bounce-gentle 2s ease-in-out infinite; will-change: transform; }
.animate-scale-in { animation: scale-in 0.4s cubic-bezier(0.17, 0.67, 0.83, 0.67) forwards; will-change: transform, opacity; }
.animate-shine { animation: shine 2s infinite; will-change: left; }

.perspective-1000 { 
  perspective: 1000px; 
  -webkit-perspective: 1000px;
}
.preserve-3d { 
  transform-style: preserve-3d; 
  -webkit-transform-style: preserve-3d;
  will-change: transform;
}
.backface-hidden { 
  backface-visibility: hidden; 
  -webkit-backface-visibility: hidden;
  transform: translateZ(0);
  -webkit-transform: translateZ(0);
}
.rotate-y-180 { 
  transform: rotateY(180deg) translateZ(0); 
  -webkit-transform: rotateY(180deg) translateZ(0);
}

@keyframes float-icon { 0%, 100% { transform: translateY(0) rotate(0); } 33% { transform: translateY(-10px) rotate(2deg); } 66% { transform: translateY(5px) rotate(-2deg); } }
@keyframes shimmer-btn { 0% { transform: translateX(-150%) skewX(12deg); } 100% { transform: translateX(250%) skewX(12deg); } }
@keyframes icon-pulse { 0% { transform: scale(1); filter: drop-shadow(0 0 0 rgba(16, 185, 129, 0)); } 50% { transform: scale(1.1); filter: drop-shadow(0 0 10px rgba(16, 185, 129, 0.2)); } 100% { transform: scale(1); filter: drop-shadow(0 0 0 rgba(16, 185, 129, 0)); } }
@keyframes shimmer-text { 0% { background-position: 200% center; } 100% { background-position: -200% center; } }

/* Shared Aura Animation Core */
@keyframes aura-morph {
  0%, 100% { border-radius: 66% 34% 53% 47% / 46% 30% 70% 54%; transform: rotate(0deg) scale(1); }
  50% { border-radius: 40% 60% 70% 40% / 50% 60% 30% 60%; transform: rotate(180deg) scale(1.15); }
}

.animate-aura-blob-1 { animation: aura-morph 18s ease-in-out infinite; }
.animate-aura-blob-2 { animation: aura-morph 24s linear infinite reverse; }
.animate-aura-blob-3 { animation: aura-morph 30s ease-in-out infinite; }

.animate-float-icon { animation: float-icon 8s ease-in-out infinite; will-change: transform; }
.animate-shimmer-btn { animation: shimmer-btn 1.5s ease-out; will-change: transform; }
.animate-icon-pulse { animation: icon-pulse 4s ease-in-out infinite; will-change: transform, filter; }
.animate-shimmer-text { animation: shimmer-text 5s linear infinite; }
.hover\:animate-wiggle:hover { animation: wiggle 0.5s ease-in-out both; }
@keyframes wiggle { 0%, 100% { transform: rotate(0deg); } 25% { transform: rotate(-10deg); } 75% { transform: rotate(10deg); } }
@keyframes aura-morph {
  0% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; transform: rotate(0deg) scale(1); }
  50% { border-radius: 30% 60% 70% 40% / 50% 60% 30% 60%; transform: rotate(180deg) scale(1.15); }
  100% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; transform: rotate(360deg) scale(1); }
}

.animate-aura-morph { animation: aura-morph 18s linear infinite; }
.animate-aura-morph-slow { animation: aura-morph 28s linear infinite reverse; }

@keyframes progress-shimmer {
  0% { opacity: 1; }
  50% { opacity: 0.85; }
  100% { opacity: 1; }
}
.animate-progress-shimmer { animation: progress-shimmer 3s ease-in-out infinite; }

.fade-scale-enter-active, .fade-scale-leave-active { transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); will-change: transform, opacity; }
.fade-scale-enter-from { opacity: 0; transform: scale(0.9); }
.fade-scale-leave-to { opacity: 0; transform: scale(1.1); }
.fade-up-enter-active, .fade-up-leave-active { transition: all 0.5s ease-out; will-change: transform, opacity; }
.fade-up-enter-from { opacity: 0; transform: translateY(20px); }
.fade-up-leave-to { opacity: 0; transform: translateY(-20px); }
</style>
