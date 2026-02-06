<script setup lang="ts">
import { ref, onMounted, computed, watch, onUnmounted } from 'vue'
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
const initialPeopleAhead = useLocalStorage<number>('dawrak-initial-ahead', 0)
const serviceStartTime = useLocalStorage<number | null>('dawrak-service-start', null)
const serviceDuration = useLocalStorage<string | null>('dawrak-service-duration', null)
const isAudioEnabled = useLocalStorage('dawrak-audio-enabled', false)
const showCancelConfirmation = ref(false)
const showHelpGuide = ref(false)
const issuanceStage = ref<'idle' | 'fetching' | 'flipping' | 'revealed'>('idle')
const isLoading = ref(false)
const isIssuing = ref(false)
const isServiceFinished = useLocalStorage('dawrak-service-finished', false)
const isFreshScan = ref(true)
const isLoadingInitial = ref(true)
const projectedTicket = ref<number | null>(null)
const toast = useToast()

/** PWA Installation Logic */
const deferredPrompt = ref<any>(null)
const isIOS = ref(false)
const showPWAInstallPrompt = useLocalStorage('dawrak-show-pwa-prompt', true)
const isAppInstallable = ref(false)

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
        const { error: insertError } = await supabase.from('tickets').insert({
          queue_id: queueId.value,
          ticket_number: data,
          status: 'waiting'
        })

        if (insertError) throw insertError

        // Set context ONLY after confirmed DB residence
        myTicket.value = data
        initialPeopleAhead.value = peopleAheadCount.value

      // 3. Wait for minimum 'Processing' time (Reduced to make it feel faster)
      const elapsed = Date.now() - startTime
      const waitTime = Math.max(0, 600 - elapsed)
      await new Promise(resolve => setTimeout(resolve, waitTime))

      // 4. Trigger Flip
      issuanceStage.value = 'flipping'
      await new Promise(resolve => setTimeout(resolve, 400)) // Matches 400ms CSS duration

      // 5. Finalize State
      issuanceStage.value = 'revealed'
      
      // 6. Hold to let them admire the card (Reduced for snappier UX)
      await new Promise(resolve => setTimeout(resolve, 1000))
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


async function toggleNotifications() {
  if (isAudioEnabled.value) {
    isAudioEnabled.value = false
    toast.show(t('audio_disabled'), 'info')
  } else {
    // Attempt to unlock audio/speech context via user gesture
    isAudioEnabled.value = true
    
    // 1. Request Browser Notification Permission
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission()
    }
    
    // 2. Play Test Sound
    play()
    
    // 3. Test Voice
    speak(locale.value === 'ar' ? 'تم تفعيل التنبيهات الصوتية' : 'Voice alerts enabled')
    
    toast.show(t('audio_enabled'), 'success')
  }
}


function speak(text: string) {
  if (!isAudioEnabled.value || !('speechSynthesis' in window)) return
  
  window.speechSynthesis.cancel()
  
  const utterance = new SpeechSynthesisUtterance(text)
  const voices = window.speechSynthesis.getVoices()
  
  // Try to find a premium/natural sounding voice
  const preferredLang = locale.value === 'ar' ? 'ar' : 'en'
  const naturalVoice = voices.find(v => 
    v.lang.startsWith(preferredLang) && 
    (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Premium'))
  ) || voices.find(v => v.lang.startsWith(preferredLang))

  if (naturalVoice) utterance.voice = naturalVoice
  
  utterance.lang = locale.value === 'ar' ? 'ar-SA' : 'en-US'
  utterance.rate = 0.9
  utterance.pitch = 1.0
  utterance.volume = 1.0
  
  window.speechSynthesis.speak(utterance)
}

async function installPWA() {
  if (isIOS.value) {
    // For iOS, we handle it in UI (showing instructions)
    return
  }
  if (!deferredPrompt.value) return
  deferredPrompt.value.prompt()
  const { outcome } = await deferredPrompt.value.userChoice
  if (outcome === 'accepted') {
    deferredPrompt.value = null
    isAppInstallable.value = false
  }
}

function dismissPWA() {
  showPWAInstallPrompt.value = false
}

function notifyBrowser(title: string, body: string) {
  if (!isAudioEnabled.value) return
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body,
        icon: '/vite.svg',
        silent: false // Browser usually plays default sound, but we play our own 'play()' too
      })
    } catch (e) {
      console.error('Notification Error:', e)
    }
  }
}

/** Computed Measurements */
const peopleAheadCount = computed(() => {
  const tNum = myTicket.value
  if (tNum === null) return 0
  return Math.max(0, tNum - currentNumber.value - 1)
})

const currentSpiritualQuote = computed(() => {
  const quotes = t('spiritual_quotes') as unknown as string[]
  if (!Array.isArray(quotes)) return ""
  // Combined seed: Ticket ID + People Ahead (ensures change as queue moves)
  const seed = (myTicket.value || 0) + (peopleAheadCount.value || 0)
  const index = seed % quotes.length
  return quotes[index]
})

const queueProgress = computed(() => {
  if (myTicket.value === null || myTicket.value === 0) return 0
  if (isMyTurnActive.value) return 100
  
  // المنطق الجديد: "التقدم التحفيزي" 
  // نبدأ بنسبة بسيطة (إضافة 1) لضمان أن العميل يرى تقدماً فور انضمامه
  const initial = initialPeopleAhead.value || 1
  const currentAhead = peopleAheadCount.value
  
  // المعادلة تضمن بدء الشريط بنسبة (1 / المجموع الحقيقي) لتعزيز شعور العميل بالحركة
  const progress = ((initial - currentAhead + 0.5) / (initial + 1)) * 100
  
  return Math.min(100, Math.max(10, progress))
})

const isMyTurnActive = computed(() => {
  const tNum = myTicket.value
  return tNum !== null && tNum === currentNumber.value
})

const estimatedWaitTime = computed(() => (peopleAheadCount.value + 1) * 2)

// الميزة 6: رسائل الترقب الذكية
const queueStatusMessage = computed(() => {
  if (locale.value === 'ar') {
    if (peopleAheadCount.value === 0) return 'أنت التالي في الخدمة، استعد..'
    if (peopleAheadCount.value === 1) return 'استعد، أنت التالي مباشرة!'
    if (peopleAheadCount.value === 2) return 'لحظات ويحين دوركم..'
    return 'سعداء بانتظاركم، دوركم يقترب..'
  } else {
    if (peopleAheadCount.value === 0) return "You are next, please get ready"
    if (peopleAheadCount.value === 1) return "Get ready, you're next!"
    if (peopleAheadCount.value === 2) return "Almost there, hold on.."
    return "Your turn is approaching soon.."
  }
})

// تحسين اللغة العربية (Pluralization & Ordinals)
const ordinalRank = computed(() => {
  const n = peopleAheadCount.value + 1
  if (locale.value !== 'ar') return n
  
  const ordinals: Record<number, string> = {
    1: 'الأول',
    2: 'الثاني',
    3: 'الثالث',
    4: 'الرابع',
    5: 'الخامس',
    6: 'السادس',
    7: 'السابع',
    8: 'الثامن',
    9: 'التاسع',
    10: 'العاشر'
  }
  return ordinals[n] || n
})

const waitTimeLabel = computed(() => {
  const mins = estimatedWaitTime.value
  if (locale.value !== 'ar') return t('mins')
  
  if (mins === 1) return 'دقيقة واحدة'
  if (mins === 2) return 'دقيقتان'
  if (mins >= 3 && mins <= 10) return 'دقائق'
  return 'دقيقة'
})

const totalServedToday = ref(0)
const totalBookingsToday = ref(0)

/** Initialization & Realtime */
async function loadMetrics() {
  if (!queueId.value) return
  
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayISO = today.toISOString()

  // Execute queries in parallel
  const [bookingsRes, servedRes] = await Promise.all([
    supabase
      .from('tickets')
      .select('*', { count: 'exact', head: true })
      .eq('queue_id', queueId.value)
      .gte('created_at', todayISO),
    supabase
      .from('tickets')
      .select('*', { count: 'exact', head: true })
      .eq('queue_id', queueId.value)
      .eq('status', 'called')
      .gte('created_at', todayISO)
  ])
  
  totalBookingsToday.value = bookingsRes.count || 0
  totalServedToday.value = servedRes.count || 0
}

async function loadInitialData() {
  isLoading.value = true
  try {
    const { data, error } = await supabase.from('queues').select('*').limit(1).maybeSingle()
    if (error) throw error
    
    if (data) {
      queueId.value = data.id
      currentNumber.value = data.current_number ?? 0
      lastIssued.value = data.last_issued_number ?? 0
      isPaused.value = data.name === 'PAUSED'
      lastCalledAt.value = data.last_called_at
      
      // Load metrics in parallel with other setup if possible, 
      // but here we wait for it to ensure UI is ready.
      await loadMetrics()
    }
  } catch (e) {
    console.error('Failed to load initial data:', e)
  } finally {
    isLoading.value = false
  }
}

onMounted(async () => {
  await loadInitialData()
  isLoadingInitial.value = false
  
  onMounted(() => {
    // Check if iOS
    isIOS.value = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault()
      deferredPrompt.value = e
      isAppInstallable.value = true
    })

    window.addEventListener('appinstalled', () => {
      isAppInstallable.value = false
      deferredPrompt.value = null
    })
  })

  // Realtime Channel
  const channel = supabase.channel('home-realtime-sync')
  
  onUnmounted(() => {
    supabase.removeChannel(channel)
  })
  
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
              
              const ahead = peopleAheadCount.value
              
              // 1. Voice Announcement
              if (isMyTurn) {
                speak(locale.value === 'ar' ? 'حان دوركم الآن، تفضلوا للمنضدة وشكراً لصبركم' : "It's your turn now, please proceed to the counter. Thank you for your patience.")
                notifyBrowser(t('its_your_turn'), t('proceed_to_counter'))
              } else if (ahead !== null && ahead >= 0 && ahead < 5) {
                const aheadText = locale.value === 'ar' 
                   ? `بقي ${ahead + 1} أشخاص أمامك، دورك يقترب` 
                   : `There are ${ahead + 1} people ahead of you. Your turn is approaching.`
                speak(aheadText)
                notifyBrowser('Dawrak Update', aheadText)
              } else if (!isMyTurn) {
                 const msg = t('now_serving_notification').replace('{n}', newVal.toString())
                 toast.show(msg, 'info')
                 // Only speak general updates if we are very far or just turned it on
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
                 
                 const recallText = locale.value === 'ar' ? 'نرجو الانتباه، تتم إعادة استدعائكم الآن' : 'Attention! Your number is being recalled.'
                 speak(recallText)
                 notifyBrowser(t('attention_recall'), t('proceed_to_counter'))
                 toast.show(t('attention_recall'), 'info')
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
      if (queueId.value && updatedTicket.queue_id == queueId.value) {
        
        // IF MY TICKET status changes to 'called' (terminal status)
        // Use loose equality (==) to handle string/number comparison safely
        if (myTicket.value && updatedTicket.ticket_number == myTicket.value && updatedTicket.status === 'called') {
              const end = Date.now()
              const start = serviceStartTime.value || (end - 120000)
              const diff = end - start
              
              const mins = Math.floor(diff / 60000)
              const secs = Math.floor((diff % 60000) / 1000)
              
              const pad = (n: number) => n.toString().padStart(2, '0')
              serviceDuration.value = `${pad(mins)}:${pad(secs)}`
              
              isServiceFinished.value = true
              // Important: We reset myTicket here to conclude the session
              myTicket.value = null
              serviceStartTime.value = null
        }
        
        // GLOBAL UPDATE: Increment total served for stats
        if (updatedTicket.status === 'called') {
           totalServedToday.value++
        }
      }
    })
    .subscribe()

  // IMMEDIATE AUTO-ISSUE (QR SCAN UX):
  // We add a tiny delay to ensure connections are stable before firing the RPC.
  if (myTicket.value === null && !isPaused.value) {
     setTimeout(() => {
        if (myTicket.value === null && !isPaused.value) {
          issueTicket()
        }
     }, 500)
  }
  
  isFreshScan.value = false
})

const resetCurrentState = () => {
  myTicket.value = null
  isServiceFinished.value = false
  // Delay clearing duration so the card doesn't blank out during fade-out
  setTimeout(() => {
    serviceDuration.value = null
    serviceStartTime.value = null
  }, 500)
}

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
    
    <!-- INITIAL BOOT OVERLAY (Prevents state flicker) -->
    <div v-if="isLoadingInitial" class="fixed inset-0 z-[100] bg-white flex flex-col items-center justify-center gap-6">
       <div class="w-20 h-20 bg-emerald-50 rounded-[2.5rem] flex items-center justify-center animate-pulse">
          <div class="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
       </div>
       <div class="text-[0.6rem] font-black text-slate-400 uppercase tracking-[0.4em] animate-pulse">Initializing System</div>
    </div>
    
    <!-- Background Texture Overlay (Grain & Noise) -->
    <div class="fixed inset-0 pointer-events-none z-[1] opacity-[0.03] mix-blend-overlay bg-[url('https://grainy-gradients.vercel.app/noise.svg')] transition-opacity duration-1000"></div>
    <div class="fixed inset-0 pointer-events-none z-0 opacity-[0.01] bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:32px_32px] transition-opacity duration-1000"></div>
    
    <!-- الميزة 5: الخلفية الحركية (Dynamic Aura Blooms) -->
    <div class="fixed inset-0 z-0 overflow-hidden pointer-events-none bg-slate-50/50">
      <div class="absolute -top-[20%] -left-[10%] w-[70%] h-[70%] bg-emerald-100/40 rounded-full blur-[120px] animate-morph-aura"></div>
      <div class="absolute -bottom-[20%] -right-[10%] w-[70%] h-[70%] bg-emerald-200/20 rounded-full blur-[120px] animate-morph-aura-delayed"></div>
    </div>
    <!-- Premium Accents (Glows) -->
    <div class="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      <div class="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-emerald-200/20 rounded-full blur-[120px] animate-float-slow transform-gpu"></div>
      <div class="absolute bottom-[-10%] left-[-10%] w-[600px] h-[600px] bg-teal-200/15 rounded-full blur-[120px] animate-float-reverse transform-gpu"></div>
    </div>

    <!-- Global Command Center Header: Symmetrical & Sleek -->
    <header class="relative z-40 w-full px-6 pt-10 flex items-center justify-between max-w-md mx-auto" :class="{ 'opacity-20 pointer-events-none blur-sm': isPaused }">
      
      <!-- Identity Pillar (Logo + Status) -->
      <div class="h-10 bg-white/80 backdrop-blur-md px-3 sm:px-4 rounded-2xl shadow-xl shadow-emerald-500/5 border border-white flex items-center gap-2 sm:gap-3 active:scale-95 transition-all">
        <span class="text-sm sm:text-base font-black text-slate-900 tracking-tighter">Dawrak</span>
        <div class="w-[1px] h-3 bg-slate-200"></div>
        <div v-if="currentNumber > 0" class="flex items-center gap-1.5 sm:gap-2">
           <div class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse relative">
              <div class="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-40"></div>
           </div>
           <span class="text-xs sm:text-sm font-black text-emerald-600 tabular-nums">#{{ currentNumber }}</span>
        </div>
      </div>

      <!-- Controls Pillar (Language + Help) -->
      <div class="flex items-center gap-2 h-10">
        <!-- Help -->
        <button 
          @click="showHelpGuide = true"
          class="h-full w-10 bg-white/80 backdrop-blur-md rounded-2xl border border-white flex items-center justify-center text-emerald-500 shadow-xl shadow-emerald-500/5 active:scale-90 group transition-all"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="transition-transform group-hover:rotate-12"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </button>

        <!-- Language Pillar (Glass) -->
        <button 
          @click="locale = locale === 'ar' ? 'en' : 'ar'"
          class="h-full px-4 bg-white/80 backdrop-blur-md rounded-2xl border border-white flex items-center justify-center text-[0.65rem] font-black text-slate-800 shadow-xl shadow-emerald-500/5 active:scale-90 transition-all uppercase tracking-widest"
        >
          {{ locale === 'ar' ? 'EN' : 'عربي' }}
        </button>
      </div>
    </header>

    <!-- Main View Section -->
    <main class="relative z-20 flex-1 w-full max-w-md mx-auto flex flex-col items-center justify-center px-6">
      
       <!-- INITIAL LOADING STATE (Wait for auto-issue check) -->
       <div v-if="isLoading && isFreshScan && myTicket === null" class="flex flex-col items-center gap-6 animate-pulse">
          <div class="w-16 h-16 bg-slate-50 border border-slate-100 rounded-3xl flex items-center justify-center">
             <div class="w-8 h-8 border-2 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
          </div>
          <div class="h-4 w-32 bg-slate-100 rounded-full"></div>
       </div>

       <!-- PAUSE OVERLAY -->
       <Transition name="fade-scale">
          <div v-if="isPaused" class="absolute inset-0 z-[40] flex items-center justify-center p-6 bg-white/80 backdrop-blur-sm">
             <div class="bg-white rounded-[3rem] p-10 border border-slate-100 shadow-2xl flex flex-col items-center text-center max-w-sm w-full relative overflow-hidden">
                <div class="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-red-400 to-rose-500"></div>
                
                <div class="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mb-6 text-red-500 animate-pulse relative">
                   <div v-if="!isPaused" class="absolute inset-0 rounded-full border-4 border-red-100 animate-ping opacity-20"></div>
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
        <div v-if="myTicket === null && !isIssuing && !isServiceFinished && !isFreshScan && !isLoading" class="w-full flex flex-col items-center" :class="{ 'opacity-20 pointer-events-none scale-95 blur-sm transition-all duration-700': isPaused }">
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
                class="w-full h-18 sm:h-20 bg-[#1e293b] text-white rounded-[2.2rem] font-bold text-lg sm:text-xl flex items-center justify-center gap-4 shadow-[0_20px_40px_rgba(0,0,0,0.15)] hover:shadow-[0_25px_50px_rgba(0,0,0,0.2)] active:scale-[0.96] transition-all duration-500 overflow-hidden relative group/btn border border-white/5"
              >
                <!-- Inner Glow Effect -->
                <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
                
                <!-- Premium Dynamic Shimmer -->
                <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent -translate-x-[100%] skew-x-[35deg] group-hover/btn:animate-[shine_1.5s_infinite] transition-transform"></div>
                
                <span class="relative z-10 tracking-tight">{{ t('get_ticket') }}</span>
                
                <!-- Animated Icon Circle -->
                <div class="relative z-10 w-9 h-9 sm:w-10 sm:h-10 bg-white/10 rounded-full flex items-center justify-center group-hover/btn:bg-white/20 transition-colors duration-500">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="transition-transform duration-500 group-hover/btn:translate-x-0.5" :class="locale === 'ar' ? 'rotate-180' : ''">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </div>

                <!-- Subtle Pulse Decoration (Mobile optimized) -->
                <div class="absolute inset-0 rounded-[2.2rem] group-hover/btn:ring-4 ring-white/5 transition-all duration-700"></div>
              </button>
            </div>
          </div>
        </div>

        <!-- STATE 2: SERVICE FINISHED (ULTIMATUM SUCCESS CARD) -->
        <div v-else-if="isServiceFinished" class="w-full flex-1 flex items-center justify-center p-4">
             <div 
               class="relative w-full max-w-[340px] max-h-[85vh] overflow-y-auto bg-white rounded-[3.5rem] p-7 sm:p-10 shadow-[0_50px_100px_-20px_rgba(0,0,0,0.15)] border border-slate-100 flex flex-col items-center animate-card-reveal overflow-x-hidden"
             >
                <!-- Decorative Border Accent -->
                <div class="absolute inset-[8px] rounded-[3rem] border border-emerald-500/5 pointer-events-none"></div>
                
                <!-- Success Shimmer Overlay -->
                <div class="absolute inset-0 bg-gradient-to-tr from-transparent via-emerald-400/5 to-transparent -translate-x-full animate-shine-slow pointer-events-none"></div>

                <!-- Floating Sparkles (Interior Decorations) -->
                <div class="absolute inset-0 pointer-events-none">
                   <div class="absolute top-10 left-10 w-2 h-2 bg-emerald-400/20 rounded-full animate-sparkle"></div>
                   <div class="absolute bottom-20 right-10 w-3 h-3 bg-emerald-500/10 rounded-full animate-sparkle" style="animation-delay: 1s;"></div>
                   <div class="absolute top-1/2 left-4 w-1.5 h-1.5 bg-teal-400/20 rounded-full animate-sparkle" style="animation-delay: 2s;"></div>
                </div>

                <!-- Animated Success Signature -->
                <div class="relative mb-8 sm:mb-10">
                   <div class="absolute inset-0 bg-emerald-500/20 blur-3xl rounded-full scale-150 animate-pulse"></div>
                   <div class="w-16 h-16 sm:w-20 sm:h-20 bg-emerald-500 rounded-[1.8rem] sm:rounded-[2.2rem] flex items-center justify-center shadow-2xl shadow-emerald-500/40 relative z-10">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" class="animate-icon-bounce-success"><path d="M20 6L9 17l-5-5"/></svg>
                   </div>
                </div>
                
                <div class="text-center mb-8 sm:mb-10 space-y-1 relative z-10">
                   <h2 class="text-2xl sm:text-[1.75rem] font-black text-slate-900 tracking-tighter leading-none">{{ t('thank_you') }}</h2>
                   <p class="text-slate-400 font-bold text-xs sm:text-sm tracking-tight px-4">{{ t('hope_served_well') }}</p>
                </div>
                
                <!-- Luxury Duration Display -->
                <div 
                  v-if="serviceDuration"
                  class="w-full bg-slate-50/80 rounded-[2.5rem] p-6 sm:p-8 border border-slate-100 flex flex-col items-center gap-3 sm:gap-4 mb-8 sm:mb-10 group hover:bg-white hover:shadow-xl transition-all duration-700 relative z-10"
                >
                   <span class="text-[0.55rem] sm:text-[0.6rem] font-black text-slate-400 uppercase tracking-[0.4em]">{{ t('service_duration') }}</span>
                   
                   <div class="flex items-center justify-center gap-4 sm:gap-6">
                      <div class="flex flex-col items-center">
                         <span class="text-3xl sm:text-4xl font-black text-slate-900 tabular-nums font-mono tracking-tight">{{ serviceDuration.split(':')[0] }}</span>
                         <span class="text-[0.45rem] sm:text-[0.5rem] font-black text-slate-300 uppercase tracking-widest mt-1">{{ locale === 'ar' ? 'دقيقة' : 'MIN' }}</span>
                      </div>
                      <div class="text-xl sm:text-2xl font-black text-emerald-500/30 animate-pulse mb-4 sm:mb-6">:</div>
                      <div class="flex flex-col items-center">
                         <span class="text-3xl sm:text-4xl font-black text-slate-900 tabular-nums font-mono tracking-tight">{{ serviceDuration.split(':')[1] }}</span>
                         <span class="text-[0.45rem] sm:text-[0.5rem] font-black text-slate-300 uppercase tracking-widest mt-1">{{ locale === 'ar' ? 'ثانية' : 'SEC' }}</span>
                      </div>
                   </div>
                   
                   <div class="w-full h-px bg-slate-100 mt-1"></div>
                   
                   <p class="text-[0.6rem] sm:text-[0.65rem] font-bold text-slate-400 italic px-2 text-center">
                      "{{ t('welcome_back_message') }}"
                   </p>
                </div>

                <button 
                  @click="resetCurrentState()" 
                  class="w-full h-16 sm:h-18 bg-slate-900 text-white rounded-2xl font-black text-xs sm:text-sm uppercase tracking-[0.3em] shadow-2xl shadow-slate-900/20 active:scale-95 transition-all relative group/btn z-10"
                >
                   <span class="relative z-10">{{ locale === 'ar' ? 'اكتمل بنجاح' : 'DONE' }}</span>
                   <div class="absolute inset-0 bg-white/10 opacity-0 group-hover/btn:opacity-100 transition-opacity"></div>
                </button>
             </div>
        </div>

        <!-- STATE 3: QUEUE & REVEAL (KEEP THE CIRCLE) -->
        <div v-else class="relative w-full max-w-[min(90vw,400px)] aspect-square flex items-center justify-center" :class="{ 'opacity-20 scale-95 blur-sm transition-all duration-700': isPaused }">
          <!-- TRUE ORGANIC LIQUID AURA (Unclipped & Asymmetric) -->
          <div class="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
             <!-- Blob 1: Large Base (Slow Rotation) -->
             <div class="absolute w-[140%] h-[140%] bg-emerald-500/10 rounded-[40%] blur-[60px] animate-blob-spin-slow"></div>
             <!-- Blob 2: Moving Shape (Counter Rotation) -->
             <div class="absolute w-[130%] h-[130%] bg-emerald-400/10 rounded-[45%] blur-[50px] animate-blob-spin-reverse"></div>
             <!-- Blob 3: Pulse Core -->
             <div class="absolute w-[100%] h-[100%] bg-emerald-300/10 rounded-full blur-[40px] animate-pulse-slow"></div>
          </div>
          
          <!-- Shared Boundary Container -->
          <div 
            class="relative w-full h-full flex flex-col items-center justify-center text-center transition-all duration-700 z-20"
          >
            <!-- Shared SVG Definitions -->
            <svg width="0" height="0" class="absolute">
              <defs>
                <linearGradient id="progressGradient" x1="100%" y1="0%" x2="0%" y2="0%">
                  <stop offset="0%" stop-color="#059669" /> <!-- emerald-600 -->
                  <stop offset="50%" stop-color="#10b981" /> <!-- emerald-500 -->
                  <stop offset="100%" stop-color="#34d399" /> <!-- emerald-400 -->
                </linearGradient>
              </defs>
            </svg>
            <!-- Glassmorphic Inner Core -->
            <div class="absolute inset-2 bg-white/70 backdrop-blur-3xl rounded-full shadow-[inset_0_2px_10px_rgba(255,255,255,0.5),0_20px_40px_rgba(0,0,0,0.05)] border border-white/60 z-0"></div>
            <!-- REVEAL ANIMATION (3D FLIP CARD) -->
            <div v-if="isIssuing" class="flex flex-col items-center justify-center w-full h-full relative z-20 perspective-1000">
               <div 
                 class="relative w-52 aspect-[4/5] preserve-3d transition-all duration-1000 ease-out will-change-transform"
                 :class="{ 
                   'rotate-y-180': issuanceStage === 'flipping' || issuanceStage === 'revealed'
                 }"
               >
                  <!-- FRONT: THE CARD BACK (Logo Design / Fetching) -->
                  <div class="absolute inset-0 backface-hidden bg-white rounded-3xl shadow-2xl border border-slate-100 flex flex-col items-center justify-center p-8 overflow-hidden">
                     <div class="absolute inset-0 bg-gradient-to-br from-white via-emerald-50/20 to-slate-50"></div>
                     
                     <!-- Loading Spinner if fetching -->
                     <div v-if="issuanceStage === 'fetching'" class="relative z-10 flex flex-col items-center gap-6">
                        <div class="relative">
                           <div class="w-12 h-12 rounded-full border-4 border-slate-100 border-t-emerald-500 animate-spin"></div>
                           <div class="absolute inset-0 flex items-center justify-center">
                              <div class="w-6 h-6 bg-emerald-50 rounded-full animate-pulse"></div>
                           </div>
                        </div>
                        <p class="text-[0.6rem] font-black text-slate-400 uppercase tracking-[0.2em] animate-pulse">{{ t('queue_service') }}</p>
                     </div>

                     <!-- Static Back for Flip start -->
                     <div v-else class="relative z-10 flex flex-col items-center">
                        <div class="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-2xl shadow-emerald-500/20 mb-6">
                           <span class="text-white text-3xl font-black italic">D</span>
                        </div>
                        <div class="text-slate-300 font-black tracking-[0.5em] uppercase text-xs mb-2">Dawrak</div>
                        <div class="w-8 h-[2px] bg-emerald-200 rounded-full"></div>
                     </div>
                  </div>

                  <!-- BACK: THE TICKET REVEALED -->
                  <div class="absolute inset-0 backface-hidden rotate-y-180 bg-white rounded-3xl shadow-2xl border-2 border-emerald-500/10 overflow-hidden flex flex-col">
                     <div class="absolute inset-0 bg-gradient-to-br from-emerald-50/50 via-white to-white"></div>
                     <div class="absolute top-0 left-0 w-full h-2 bg-emerald-500 shadow-[0_2px_10px_rgba(16,185,129,0.3)]"></div>
                     
                     <div class="relative flex-1 flex flex-col items-center justify-center p-6 text-center">
                        <div class="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center mb-6">
                           <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="4"><path d="M20 6L9 17l-5-5"></path></svg>
                        </div>

                        <span class="text-[0.65rem] font-black text-slate-300 uppercase tracking-[0.3em] mb-2">{{ t('your_number') }}</span>
                        <div class="text-[5.5rem] leading-none font-black text-slate-900 tabular-nums tracking-tighter mb-4">{{ String(projectedTicket).padStart(3, '0') }}</div>
                        <div class="px-4 py-1.5 bg-emerald-50 text-emerald-700 text-[0.6rem] font-bold uppercase tracking-widest rounded-full border border-emerald-100/50">
                           {{ t('digital_pass') }}
                        </div>
                     </div>
                  </div>
               </div>
            </div>

            <!-- حالة الانتظار: المجسم الموحد (Unity Unit) -->
            <div 
              v-else-if="myTicket !== null && !isMyTurnActive" 
              class="flex flex-col items-center w-full h-full justify-center relative z-10 animate-scale-in"
            >
               <!-- شريط التقدم والمسار الأخضر الفاتح (Liquid Road) -->
               <div class="absolute inset-[-6px] flex items-center justify-center pointer-events-none">
                  <svg class="w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
                    <!-- مسار الطريق (The Path) -->
                    <circle cx="50" cy="50" r="46.5" fill="none" class="stroke-emerald-500/10" stroke-width="6.5"></circle>
                    
                    <!-- السائل الأخضر المتوهج (Base Progress) -->
                    <circle 
                      cx="50" cy="50" r="46.5" 
                      fill="none" 
                      stroke-width="6.5" 
                      stroke-linecap="round"
                      stroke-dasharray="292" 
                      :stroke-dashoffset="292 - (2.92 * queueProgress)"
                      class="transition-all duration-[1200ms] cubic-bezier(0.34, 1.56, 0.64, 1)"
                      stroke="url(#progressGradient)"
                    ></circle>

                    <!-- الميزة 1: الحركة السائلة (Liquid Flow Shimmer) -->
                    <circle 
                      v-if="queueProgress > 1"
                      cx="50" cy="50" r="46.5" 
                      fill="none" 
                      stroke-width="6.5" 
                      stroke-linecap="round"
                      stroke-dasharray="20 272"
                      :stroke-dashoffset="-(2.92 * queueProgress)"
                      class="animate-liquid-flow stroke-white/30"
                      style="filter: blur(2px);"
                    ></circle>

                    <!-- شرارة التقدم (Leading Spark) -->
                    <circle 
                      v-if="queueProgress > 1 && queueProgress < 100"
                      cx="50" cy="50" r="47" 
                      fill="none" 
                      stroke="#fff" 
                      stroke-width="2.5" 
                      stroke-linecap="round"
                      stroke-dasharray="0.5 294.8" 
                      :stroke-dashoffset="-(2.953 * queueProgress)"
                      class="transition-all duration-[1200ms] cubic-bezier(0.34, 1.56, 0.64, 1)"
                      style="filter: drop-shadow(0 0 5px #fff);"
                    ></circle>
                  </svg>
               </div>

                <!-- الميزة 5: التأثير الزجاجي العميق (Deep 3D Glass) مع حافة مضيئة -->
                <div 
                  class="w-[92%] h-[92%] bg-gradient-to-b from-white/90 to-white/50 backdrop-blur-3xl rounded-full flex flex-col items-center justify-center text-center relative z-10 border-[0.5px] transition-all duration-1000 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.1),inset_0_4px_12px_rgba(255,255,255,0.8),inset_0_-8px_20px_rgba(16,185,129,0.05)] overflow-hidden"
                  :class="[
                    peopleAheadCount < 3 ? 'border-emerald-500/30 animate-breathing-core' : 'border-white/80'
                  ]"
                >
                  <!-- الميزة 2: لمعان الحافة الزجاجية (Glass Edge Highlight) -->
                  <div class="absolute inset-0 rounded-full border-[1.5px] border-transparent [mask-image:linear-gradient(to_bottom,black,transparent)] pointer-events-none opacity-40 invisible sm:visible">
                    <div class="absolute inset-0 rounded-full border-t-[1.5px] border-white"></div>
                  </div>

                  <div class="relative z-10 flex flex-col items-center justify-center p-8 w-full h-full">
                    
                    <!-- رقم التذكرة (Upper Identity) -->
                    <div class="mb-3">
                      <span class="text-[0.65rem] sm:text-[0.75rem] font-medium text-emerald-600/40 uppercase tracking-[0.4em] block">
                        #{{ String(myTicket).padStart(3, '0') }} {{ t('your_number') }}
                      </span>
                    </div>
                    
                    <!-- الميزة الأولى والثالثة: هرمية النصوص والظلال العميقة -->
                    <div class="flex flex-col items-center justify-center mb-6 overflow-hidden w-full px-4 text-center">
                      <Transition name="slide-up" mode="out-in">
                        <div :key="peopleAheadCount" class="flex flex-col items-center w-full px-2">
                          <h2 
                            class="font-extrabold text-slate-900 leading-[1.3] font-display drop-shadow-[0_2px_4px_rgba(0,0,0,0.05)]"
                            :style="{ 
                              fontSize: locale === 'en' ? 'clamp(1rem, 6.5vw, 1.7rem)' : 'clamp(1.1rem, 7.8vw, 1.9rem)' 
                            }"
                          >
                            <template v-if="locale === 'ar'">
                               <span>أنت </span>
                               <span class="text-emerald-600 drop-shadow-[0_4px_8px_rgba(16,185,129,0.15)]">{{ ordinalRank }}</span>
                               <span> في القائمة</span>
                            </template>
                            <template v-else>
                               <span>{{ t('you_are_n_in_queue').split('{n}')[0] }}</span>
                               <span class="text-emerald-600">{{ ordinalRank }}</span>
                               <span>{{ t('you_are_n_in_queue').split('{n}')[1] }}</span>
                            </template>
                          </h2>
                        </div>
                      </Transition>
                      
                      <!-- الميزة 6: الرسائل التفاعلية الذكية (Micro-copy) -->
                      <div class="h-8 mt-1 flex items-center justify-center overflow-hidden">
                        <Transition name="fade-up" mode="out-in">
                          <span :key="queueStatusMessage" class="text-[0.6rem] sm:text-[0.65rem] font-medium text-slate-500/60 uppercase tracking-[0.1em] px-2 text-center leading-tight">
                             {{ queueStatusMessage }}
                          </span>
                        </Transition>
                      </div>
                    </div>

                    <!-- Divider Line -->
                    <div class="w-10 h-[1px] bg-emerald-500/10 mb-6 rounded-full"></div>

                    <!-- محتوى المعلومات (Spiritual or Info) -->
                    <div class="w-full flex items-center justify-center min-h-[60px]">
                      <template v-if="peopleAheadCount === 0">
                         <span class="text-lg sm:text-xl font-medium text-emerald-600/60 font-amiri italic tracking-tighter">{{ t('alhamdulillah') }}</span>
                      </template>
                      <template v-else-if="peopleAheadCount < 3">
                        <div class="flex flex-col items-center">
                           <p class="text-[0.5rem] font-bold text-slate-400 uppercase tracking-[0.2em] mb-1">{{ t('estimated_wait') }}</p>
                           <div class="flex items-center gap-1.5">
                              <span class="text-lg text-slate-200">≈</span>
                               <span class="text-3xl sm:text-4xl font-black text-slate-900 tabular-nums tracking-tighter font-display">{{ estimatedWaitTime }}</span>
                               <span class="text-[0.6rem] text-slate-400 font-bold uppercase tracking-widest">{{ waitTimeLabel }}</span>
                           </div>
                        </div>
                      </template>
                      <template v-else>
                         <div class="px-6 py-2 rounded-[2.5rem] active:scale-[0.98] transition-all group relative cursor-pointer max-w-[280px] w-full mx-auto text-center">
                            <p class="text-[0.9rem] sm:text-[1rem] font-medium leading-[1.6] text-slate-700/80 font-amiri italic relative z-10 drop-shadow-sm">
                               "{{ currentSpiritualQuote }}"
                            </p>
                            <!-- Subtle Living Divider -->
                            <div class="w-10 h-[2px] bg-emerald-500/10 mx-auto mt-2 rounded-full animate-pulse"></div>
                         </div>
                      </template>
                    </div>
                  </div>
                </div>
              </div>

             <!-- SUCCESS (Serving) - Hyper Polish -->
            <div v-else-if="isMyTurnActive" class="flex flex-col items-center justify-center w-full h-full relative z-30 animate-scale-in">
               <div class="absolute inset-[-20%] bg-emerald-500/5 rounded-full blur-[100px] animate-pulse"></div>
               <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <svg class="w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="47.5" fill="none" stroke="url(#progressGradient)" stroke-width="5" stroke-linecap="round" class="animate-draw-circle opacity-20 blur-[5px]"></circle>
                    <circle cx="50" cy="50" r="47.5" fill="none" stroke="url(#progressGradient)" stroke-width="4.5" stroke-linecap="round" class="animate-draw-circle transition-all duration-1000"></circle>
                  </svg>
               </div>
               <div class="flex flex-col items-center gap-6 animate-bounce-gentle px-8 relative z-10">
                  <div class="w-24 h-24 rounded-[2.5rem] bg-emerald-500 flex items-center justify-center shadow-2xl shadow-emerald-500/40 relative overflow-hidden group">
                     <div class="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-white/10"></div>
                     <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" class="relative z-10 animate-icon-bounce-success"><path d="M20 6L9 17l-5-5"/></svg>
                  </div>
                  <div class="text-center">
                    <h2 class="text-4xl font-black text-slate-900 tracking-tight leading-tight drop-shadow-md">{{ t('its_your_turn') }}</h2>
                    <p class="text-lg font-bold text-emerald-600 mt-2 uppercase tracking-wide opacity-90">{{ t('proceed_to_counter') }}</p>
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
             <!-- Animated Shine Sweep -->
             <div v-if="!isAudioEnabled" class="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-[150%] skew-x-12 animate-shimmer-btn"></div>
          </button>
          
          <!-- Leave Button: Elegant Low-Priority Pill -->
          <button @click="showCancelConfirmation = true" class="w-full h-18 bg-white/40 backdrop-blur-xl text-slate-400 hover:bg-rose-50/50 hover:text-rose-500 rounded-full font-bold text-[0.85rem] uppercase tracking-[0.2em] active:scale-[0.98] transition-all flex items-center justify-center border border-white/50 shadow-sm gap-2 group">
             <span class="opacity-80 group-hover:opacity-100 transition-opacity">{{ t('leave_queue') }}</span>
             <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="opacity-30 group-hover:opacity-100 transition-opacity"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
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
    <!-- PWA Installation Prompt (The "Upgrade" Banner) -->
    <Transition name="fade-up">
      <div v-if="(isAppInstallable || isIOS) && showPWAInstallPrompt" class="fixed bottom-10 left-6 right-6 z-[80] flex justify-center pointer-events-none">
        <div class="bg-white/90 backdrop-blur-2xl px-6 py-6 rounded-[2.5rem] border border-white shadow-[0_40px_80px_-20px_rgba(0,0,0,0.15)] max-w-sm w-full pointer-events-auto flex flex-col gap-5 relative overflow-hidden group">
          
          <!-- Animated Background Accent -->
          <div class="absolute -top-10 -right-10 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-1000"></div>

          <div class="flex items-start gap-4 h-full">
            <div class="w-14 h-14 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-xl shadow-emerald-500/30 flex-shrink-0 animate-bounce-gentle">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>
            </div>
            <div class="flex flex-col gap-1">
              <h3 class="font-black text-slate-900 tracking-tight text-lg">{{ isIOS ? t('pwa_install_ios') : t('pwa_install') }}</h3>
              <p class="text-xs font-bold text-slate-400 leading-relaxed pr-2">
                {{ isIOS ? t('pwa_install_ios_desc') : t('pwa_install_desc') }}
              </p>
            </div>
          </div>

          <div class="flex gap-2">
            <button 
              @click="isIOS ? dismissPWA() : installPWA()" 
              class="flex-1 h-14 bg-black text-white rounded-2xl font-black text-xs uppercase tracking-widest relative overflow-hidden group/btn"
            >
              <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-[150%] skew-x-12 group-hover/btn:animate-shimmer-btn"></div>
              {{ isIOS ? t('done') : t('pwa_install') }}
            </button>
            <button 
              @click="dismissPWA" 
              class="px-6 h-14 bg-slate-50 text-slate-400 rounded-2xl font-black text-[0.6rem] uppercase tracking-widest hover:bg-slate-100 transition-colors"
            >
              {{ t('pwa_dismiss') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
@keyframes float-slow { 0%, 100% { transform: translate3d(0,0,0); } 33% { transform: translate3d(20px, -20px, 0); } 66% { transform: translate3d(-10px, 15px, 0); } }
@keyframes float-reverse { 0%, 100% { transform: translate3d(0,0,0); } 50% { transform: translate3d(-30px, 30px, 0); } }
.animate-float-slow { animation: float-slow 12s ease-in-out infinite; will-change: transform; }
.animate-float-reverse { animation: float-reverse 15s ease-in-out infinite; will-change: transform; }
@keyframes bounce-gentle { 0%, 100% { transform: translate3d(0,0,0); } 50% { transform: translate3d(0, -8px, 0); } }
@keyframes draw-circle { from { stroke-dasharray: 0 283; } to { stroke-dasharray: 283 0; } }
@keyframes scale-in { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes shine { from { left: -100%; } to { left: 100%; } }

.animate-draw-circle { animation: draw-circle 1.2s ease-out forwards; will-change: stroke-dashoffset; }
.animate-bounce-gentle { animation: bounce-gentle 2s ease-in-out infinite; will-change: transform; }
.animate-scale-in { animation: scale-in 0.4s cubic-bezier(0.17, 0.67, 0.83, 0.67) forwards; will-change: transform, opacity; }
.animate-shine { animation: shine 2s infinite; will-change: left; }
@keyframes progress-pulse { 0%, 100% { opacity: 0.4; transform: scale(1); } 50% { opacity: 0.8; transform: scale(1.02); } }
@keyframes progress-glow { 0%, 100% { filter: drop-shadow(0 0 2px rgba(16, 185, 129, 0.4)); } 50% { filter: drop-shadow(0 0 8px rgba(16, 185, 129, 0.8)); } }
.animate-progress-pulse { animation: progress-pulse 3s ease-in-out infinite; transform-origin: center; }
.animate-progress-glow { animation: progress-glow 3s ease-in-out infinite; }

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
/* Professional Blob Spin Animation (The "Squircle" fix) */
@keyframes blob-spin-slow {
  0% { transform: rotate(0deg) scale(1); border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; }
  50% { transform: rotate(180deg) scale(1.1); border-radius: 30% 60% 70% 40% / 50% 60% 30% 60%; }
  100% { transform: rotate(360deg) scale(1); border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; }
}

@keyframes blob-spin-reverse {
  0% { transform: rotate(360deg) scale(1.1); border-radius: 40% 60% 70% 30% / 40% 50% 60% 50%; }
  50% { transform: rotate(180deg) scale(0.9); border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; }
  100% { transform: rotate(0deg) scale(1.1); border-radius: 40% 60% 70% 30% / 40% 50% 60% 50%; }
}

@keyframes pulse-slow {
  0%, 100% { opacity: 0.8; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(1.05); }
}

.animate-blob-spin-slow { animation: blob-spin-slow 20s linear infinite; }
.animate-blob-spin-reverse { animation: blob-spin-reverse 25s linear infinite; }
.animate-pulse-slow { animation: pulse-slow 8s ease-in-out infinite; }

.animate-aura-blob-1 { animation: aura-morph-1 20s ease-in-out infinite; }
.animate-aura-blob-2 { animation: aura-morph-2 25s linear infinite; }
.animate-aura-blob-3 { animation: aura-morph-3 15s ease-in-out infinite alternate; }

.animate-float-icon { animation: float-icon 8s ease-in-out infinite; transform-gpu: translate3d(0,0,0); }
.animate-shimmer-btn { animation: shimmer-btn 1.2s ease-out; }
.animate-icon-pulse { animation: icon-pulse 4s ease-in-out infinite; }
.animate-shimmer-text { animation: shimmer-text 5s linear infinite; }
.hover\:animate-wiggle:hover { animation: wiggle 0.5s ease-in-out both; }
@keyframes wiggle { 0%, 100% { transform: rotate(0deg); } 25% { transform: rotate(-10deg); } 75% { transform: rotate(10deg); } }

@keyframes liquid-flow {
  0% { stroke-dashoffset: 292; }
  100% { stroke-dashoffset: -292; }
}

@keyframes breathing-core {
  0%, 100% { box-shadow: 0 0 30px rgba(16,185,129,0.1), inset 0 2px 10px rgba(255,255,255,1); transform: scale(1); }
  50% { box-shadow: 0 0 50px rgba(16,185,129,0.25), inset 0 2px 10px rgba(255,255,255,1); transform: scale(1.01); }
}

@keyframes magnetic-pulse {
  0%, 100% { transform: scale(1); box-shadow: 0 20px 40px rgba(16,185,129,0.3); }
  50% { transform: scale(1.02); box-shadow: 0 25px 60px rgba(16,185,129,0.4); }
}

@keyframes morph-aura {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(10%, 10%) scale(1.1); }
  66% { transform: translate(-5%, 15%) scale(0.9); }
}
.animate-morph-aura { animation: morph-aura 20s ease-in-out infinite; }
.animate-morph-aura-delayed { animation: morph-aura 25s ease-in-out infinite reverse; }

.animate-magnetic-pulse { animation: magnetic-pulse 3s ease-in-out infinite; }
.animate-liquid-flow { animation: liquid-flow 4s linear infinite; }
.animate-breathing-core { animation: breathing-core 4s ease-in-out infinite; }

.animate-ticket-3d {
  animation: ticket-reveal-3d 1s cubic-bezier(0.19, 1, 0.22, 1) forwards;
}

/* انتقالات الأرقام الذكية */
.slide-up-enter-active, .slide-up-leave-active { transition: all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1); }
.slide-up-enter-from { opacity: 0; transform: translateY(20px); }
.slide-up-leave-to { opacity: 0; transform: translateY(-20px); }

.fade-scale-enter-active, .fade-scale-leave-active { transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); will-change: transform, opacity; }
.fade-scale-enter-from { opacity: 0; transform: scale(0.9); }
.fade-scale-leave-to { opacity: 0; transform: scale(1.1); }
.fade-up-enter-active, .fade-up-leave-active { transition: all 0.5s ease-out; will-change: transform, opacity; }
.fade-up-enter-from { opacity: 0; transform: translateY(20px); }
.fade-up-leave-to { opacity: 0; transform: translateY(-20px); }
</style>
