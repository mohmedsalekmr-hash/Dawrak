<script setup lang="ts">
import { ref, onMounted, computed, onUnmounted } from 'vue'
import { supabase } from '../supabase'
import { useLocalStorage } from '@vueuse/core'
import { translations } from '../translations'
import { useToast } from '../composables/useToast'

/** State Section */
const locale = useLocalStorage<'en' | 'ar'>('dawrak-locale', 'ar')
const isAuthenticated = ref(sessionStorage.getItem('admin-auth') === 'true')
const adminPasscode = useLocalStorage('dawrak-admin-passcode', '1234')
const loginInput = ref('')
const loginError = ref(false)

const currentNumber = ref(0)
const lastIssued = ref(0)
const queueId = ref<number | null>(null)
const isPaused = ref(false)
const isLoading = ref(false)
const isRefetching = ref(false)
const showSettings = ref(false)
const currentTab = ref<'dashboard' | 'reports'>('dashboard')
const newPasscode = ref('')
const showFinishConfirmation = ref(false)
const isTicketServing = ref(false)
const isVoiceEnabled = useLocalStorage('dawrak-voice-enabled', true)
const toast = useToast()

const metrics = ref({
  peakHour: '--',
  completionRate: '0%',
  avgWait: '0m',
  todayServed: 0,
  yesterday: 0,
  last3Days: 0,
  last90Days: 0,
  expectedFinish: '--:--',
  trafficTrend: 'up' as 'up' | 'down' | 'steady',
  recentFlux: 0
})

const stats = ref({
  today: 0,
  thisWeek: 0,
  last30Days: 0,
  totalServed: 0,
})

const realActivityLog = ref<any[]>([])

const elapsedTime = ref('00:00')
let timerInterval: any = null

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval)
  const startTime = Date.now()
  timerInterval = setInterval(() => {
    const delta = Math.floor((Date.now() - startTime) / 1000)
    elapsedTime.value = formatTime(delta)
  }, 1000)
}

const cancelledTickets = useLocalStorage<number[]>('dawrak-cancelled-tickets', [])


// Translation helper
const t = (key: keyof typeof translations.en) => {
  return (translations[locale.value] as any)[key] || translations.en[key]
}

const waitingCount = computed(() => {
  let count = 0
  for (let i = currentNumber.value + 1; i <= lastIssued.value; i++) {
    if (!cancelledTickets.value.includes(i)) count++
  }
  return count
})

// avgWaitTime is now a computed at line 96

const waitingList = computed(() => {
  const list = []
  for (let i = currentNumber.value + 1; i <= lastIssued.value; i++) {
    if (!cancelledTickets.value.includes(i)) {
      list.push(i)
      if (list.length >= 20) break
    }
  }
  return list
})


/** Core Stats Loading */
async function fetchStats() {
  if (!queueId.value) return
  
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayISO = today.toISOString()
    
    // Helper to get count for a date range
    const getCount = async (start: Date, end: Date = new Date()) => {
       if (!queueId.value) return 0
       const { count } = await supabase.from('tickets')
         .select('*', { count: 'exact', head: true })
         .eq('queue_id', queueId.value as unknown as number)
         .gte('created_at', start.toISOString())
         .lte('created_at', end.toISOString())
       return count || 0
    }

    // Daily & Historical Totals
    const todayCount = await getCount(today)
    // Removed redundant and incorrect todayServed assignment here

    const yesterdayStart = new Date(today)
    yesterdayStart.setDate(yesterdayStart.getDate() - 1)
    metrics.value.yesterday = await getCount(yesterdayStart, today)

    const threeDaysAgo = new Date(today)
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
    metrics.value.last3Days = await getCount(threeDaysAgo)

    const sevenDaysAgo = new Date(today)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    stats.value.thisWeek = await getCount(sevenDaysAgo)

    const nineteenDaysAgo = new Date(today)
    nineteenDaysAgo.setDate(nineteenDaysAgo.getDate() - 19)
    // We display 90 on UI, but let's fetch for 90
    const ninetyDaysAgo = new Date(today)
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
    metrics.value.last90Days = await getCount(ninetyDaysAgo)

    const thirtyDaysAgo = new Date(today)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    stats.value.last30Days = await getCount(thirtyDaysAgo)

    // REAL SERVED COUNT: Accurate today volume (anyone moved out of 'waiting' state)
    const { count: servedTodayCount } = await supabase.from('tickets')
      .select('*', { count: 'exact', head: true })
      .eq('queue_id', queueId.value)
      .neq('status', 'waiting') // This ensures ALL served/called/serving are counted
      .gte('created_at', todayISO)
    metrics.value.todayServed = servedTodayCount || 0

    // TOTAL LIFETIME SERVED
    const { count: lifetimeServed } = await supabase.from('tickets')
      .select('*', { count: 'exact', head: true })
      .eq('queue_id', queueId.value)
      .neq('status', 'waiting')
    stats.value.totalServed = lifetimeServed || 0

    // COMPLETION RATE
    const rate = todayCount ? Math.round((metrics.value.todayServed / todayCount) * 100) : 100
    metrics.value.completionRate = `${rate}%`

    // AVG WAIT logic: Fallback to estimation as updated_at is missing
    // 4. PREDICTIVE AI: Estimated Closing Time
    const now = new Date()
    if (waitingCount.value > 0) {
       const totalMinutesLeft = waitingCount.value * 3 // 3 mins per person avg
       const finishDate = new Date(now.getTime() + totalMinutesLeft * 60000)
       metrics.value.expectedFinish = finishDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else {
       metrics.value.expectedFinish = 'Ready'
    }

    // 5. TRAFFIC FLUCTUATION: Compare last hour to previous hour
    const oneHourAgo = new Date(now.getTime() - 3600000)
    const twoHoursAgo = new Date(now.getTime() - 7200000)
    
    const lastHourCount = await getCount(oneHourAgo)
    const prevHourCount = await getCount(twoHoursAgo, oneHourAgo)
    
    metrics.value.recentFlux = lastHourCount
    if (lastHourCount > prevHourCount) metrics.value.trafficTrend = 'up'
    else if (lastHourCount < prevHourCount) metrics.value.trafficTrend = 'down'
    else metrics.value.trafficTrend = 'steady'

    stats.value.today = todayCount
  } catch (e) {
    console.error('Fetch Stats Error:', e)
  }
}

async function fetchActivityLog() {
  if (!queueId.value) return
  try {
    const { data } = await supabase
      .from('tickets')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10)
    
    if (data) {
      realActivityLog.value = data.map((t: any) => ({
        id: t.id,
        ticket: t.ticket_number,
        time: new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: t.status.charAt(0).toUpperCase() + t.status.slice(1)
      }))
    }
  } catch (e) {
    console.error('Fetch Activity Log Error:', e)
  }
}

/** Actions */
async function loadInitialData() {
  const { data } = await supabase.from('queues').select('*').limit(1).maybeSingle()
  if (data) {
    queueId.value = data.id
    currentNumber.value = data.current_number ?? 0
    lastIssued.value = data.last_issued_number ?? 0
    isPaused.value = data.name === 'PAUSED'
  }
}

async function nextNumber() {
  if (!queueId.value || isLoading.value) return
  isLoading.value = true
  try {
    let next = currentNumber.value + 1
    while(cancelledTickets.value.includes(next) && next <= lastIssued.value) { next++ }
    if (next > lastIssued.value) {
      toast.show(t('no_one_waiting'), 'info')
      isLoading.value = false
      return
    }

    const { error } = await supabase
      .from('queues')
      .update({ 
        current_number: next,
        last_called_at: new Date().toISOString()
      })
      .eq('id', queueId.value)
    
    if (error) throw error

    // Ticket is now being served
    currentNumber.value = next
    isTicketServing.value = true
    
    // VOICE CALLING: WOW factor
    if (isVoiceEnabled.value) {
      const msg = locale.value === 'ar' 
        ? `صاحب البطاقة رقم ${next}، نرجو منكم التوجه للمنضدة لإتمام خدمتكم.` 
        : `Ticket number ${next}, please proceed to the counter to complete your service.`
      const utterance = new SpeechSynthesisUtterance(msg)
      utterance.lang = locale.value === 'ar' ? 'ar-SA' : 'en-US'
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance)
    }

    startTimer()
    fetchStats() // Update volume instantly
  } catch (e) {
    toast.show(t('error_generic'), 'error')
  } finally {
    isLoading.value = false
  }
}

async function finishService() {
  if (!queueId.value || currentNumber.value === 0 || isLoading.value) return
  isLoading.value = true
  try {
    // 1. Mark ticket as 'called' (done)
    await supabase.from('tickets')
      .update({ status: 'called' })
      .eq('queue_id', queueId.value)
      .eq('ticket_number', currentNumber.value)

    // 2. Clear timer
    if (timerInterval) clearInterval(timerInterval)
    isTicketServing.value = false
    
    // 3. Update stats
    fetchStats()
    toast.show(t('success_op'), 'success')
  } catch (e) {
    toast.show(t('error_generic'), 'error')
  } finally {
    isLoading.value = false
  }
}

async function manualAdd() {
  if (!queueId.value || isLoading.value) return
  isLoading.value = true
  try {
    const { data, error } = await supabase.rpc('next_ticket', { queue_id: queueId.value })
    if (error) throw error
    
    // Log to tickets table for analytics
    await supabase.from('tickets').insert({
      queue_id: queueId.value,
      ticket_number: data,
      status: 'waiting'
    })

    lastIssued.value = data
    await refetchEverything()
  } catch (e) {
    toast.show(t('add_error'), 'error')
  } finally {
    isLoading.value = false
  }
}

async function refetchEverything() {
  if (isRefetching.value) return
  isRefetching.value = true
  try {
    await loadInitialData()
    await fetchStats()
    await fetchActivityLog()
  } finally {
    isRefetching.value = false
  }
}

async function recall() {
  if (!queueId.value) return
  
  // Feedback
  toast.show(t('recall'), 'info')
  if (currentNumber.value === 0) return
  
  try {
    // Just update the timestamp to trigger the customer's sound
    await supabase
      .from('queues')
      .update({ last_called_at: new Date().toISOString() })
      .eq('id', queueId.value)
  } catch (e) {
    console.error('Recall error:', e)
  }
}

async function skip() {
  if (!queueId.value || currentNumber.value === 0) return
  
  if (currentNumber.value > 0) {
    cancelledTickets.value.push(currentNumber.value)
    
    // Mark as cancelled in DB
    await supabase.from('tickets')
      .update({ status: 'cancelled' })
      .eq('queue_id', queueId.value)
      .eq('ticket_number', currentNumber.value)
      
    nextNumber()
  }
}

async function togglePause() {
  if (!queueId.value || isLoading.value) return
  isLoading.value = true
  const nextState = !isPaused.value
  try {
    const { error } = await supabase
      .from('queues')
      .update({ name: nextState ? 'PAUSED' : 'ACTIVE' })
      .eq('id', queueId.value)
    
    if (error) throw error
    isPaused.value = nextState
  } catch (e) {
    toast.show(t('error_generic'), 'error')
  } finally {
    isLoading.value = false
  }
}

async function finishQueue() {
  if (!queueId.value || isLoading.value) return
  isLoading.value = true
  try {
    // Reset the queue numbers in the DB
    const { error } = await supabase
      .from('queues')
      .update({ 
        current_number: 0, 
        last_issued_number: 0,
        last_called_at: null,
        name: 'ACTIVE' // Reset pause state too if any
      })
      .eq('id', queueId.value)
    
    if (error) throw error
    
    // Locally reset
    currentNumber.value = 0
    lastIssued.value = 0
    isPaused.value = false
    elapsedTime.value = '00:00'
    cancelledTickets.value = [] // Clear cancelled tickets for the new day
    if (timerInterval) clearInterval(timerInterval)
    
    showFinishConfirmation.value = false
    toast.show(t('success_op'), 'success')
  } catch (e) {
    toast.show(t('error_generic'), 'error')
  } finally {
    isLoading.value = false
  }
}

function handleLogin() {
  if (loginInput.value === adminPasscode.value) {
    isAuthenticated.value = true
    sessionStorage.setItem('admin-auth', 'true')
    loginError.value = false
  } else {
    loginError.value = true
    setTimeout(() => loginError.value = false, 2000)
  }
}

function updatePasscode() {
  if (newPasscode.value.length < 4) return
  adminPasscode.value = newPasscode.value
  newPasscode.value = ''
  showSettings.value = false
  toast.show(t('success_op'), 'success')
}

const currentOrigin = computed(() => window.location.origin)

function logout() {
  isAuthenticated.value = false
  sessionStorage.removeItem('admin-auth')
}

function toggleLanguage() {
  locale.value = locale.value === 'en' ? 'ar' : 'en'
}

const syncInterval = ref<any>(null)

onMounted(async () => {
  await refetchEverything()
  if (currentNumber.value > 0) {
    startTimer()
    // Check if the current ticket is still being served (not marked 'called' yet)
    if (queueId.value) {
      const { data: currentTicket } = await supabase.from('tickets')
        .select('status')
        .eq('queue_id', queueId.value)
        .eq('ticket_number', currentNumber.value)
        .maybeSingle()
      if (currentTicket && currentTicket.status === 'serving') {
        isTicketServing.value = true
      }
    }
  }
  
  // Backup Polling (every 30 seconds - we trust realtime)
  syncInterval.value = setInterval(() => {
    refetchEverything()
  }, 30000)

  supabase.channel('dashboard-full-sync')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'queues' }, (payload) => {
      const row = payload.new as any
      if (queueId.value && row.id == queueId.value) {
        currentNumber.value = row.current_number !== undefined ? row.current_number : currentNumber.value
        lastIssued.value = row.last_issued_number !== undefined ? row.last_issued_number : lastIssued.value
        isPaused.value = row.name === 'PAUSED'
      }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets' }, (payload) => {
      const newTicket = payload.new as any
      if (queueId.value && newTicket.queue_id == queueId.value) {
        lastIssued.value = Math.max(lastIssued.value, newTicket.ticket_number)
        const logEntry = {
          id: newTicket.id,
          ticket: newTicket.ticket_number,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: 'Waiting'
        }
        realActivityLog.value = [logEntry, ...realActivityLog.value].slice(0, 10)
        fetchStats()
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets' }, () => {
      refetchEverything()
    })
    .subscribe()
})

onUnmounted(() => {
  if (syncInterval.value) clearInterval(syncInterval.value)
  supabase.channel('dashboard-full-sync').unsubscribe()
})
</script>

<template>
  <div class="min-h-screen bg-[#F8FAFC] font-['Poppins',sans-serif] relative overflow-hidden selection:bg-emerald-500/30" :dir="locale === 'ar' ? 'rtl' : 'ltr'">
    
    <!-- Premium Ambient Background -->
    <div class="fixed inset-0 pointer-events-none">
       <div class="absolute top-[-10%] right-[-5%] w-[600px] h-[600px] bg-emerald-100/30 rounded-full blur-3xl mix-blend-multiply animate-float-slow gpu"></div>
       <div class="absolute bottom-[-10%] left-[-5%] w-[500px] h-[500px] bg-blue-50/40 rounded-full blur-3xl mix-blend-multiply animate-float-reverse gpu"></div>
    </div>
    
    <!-- LOGIN VIEW -->
    <div v-if="!isAuthenticated" class="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-900 to-slate-800">
      <div class="w-full max-w-sm bg-white rounded-[2.5rem] p-10 shadow-2xl text-center relative overflow-hidden">
        <div class="absolute top-0 right-0 p-4">
           <button @click="toggleLanguage" class="text-[0.7rem] font-bold text-slate-400 uppercase tracking-widest">{{ locale === 'en' ? 'AR' : 'EN' }}</button>
        </div>
        <div class="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center mx-auto mb-8">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-slate-700">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h1 class="text-2xl font-black text-slate-800 mb-2">{{ t('admin_auth') }}</h1>
        <p class="text-slate-400 text-sm mb-8">{{ t('unlock') }}</p>
        
        <div class="space-y-4">
          <input v-model="loginInput" type="password" maxlength="4" placeholder="••••" class="w-full h-16 bg-slate-50 border-2 border-slate-100 rounded-2xl text-center text-3xl font-bold tracking-[0.5em] focus:border-slate-300 outline-none transition-all" :class="{ 'border-red-500 animate-shake': loginError }" @keyup.enter="handleLogin">
          <button @click="handleLogin" class="w-full h-16 bg-[#1e293b] text-white rounded-2xl font-black text-lg active:scale-95 transition-all shadow-xl">
            {{ t('unlock') }}
          </button>
        </div>
      </div>
    </div>

    <!-- DASHBOARD VIEW -->
    <div v-else class="flex flex-col h-screen relative z-10">
      <!-- Navbar -->
      <!-- Navbar -->
      <nav class="px-6 pt-6 pb-2 z-50">
        <div class="bg-white/80 backdrop-blur-2xl border border-white/60 shadow-xl shadow-slate-200/40 rounded-[2.5rem] px-8 py-5 flex items-center justify-between transition-all hover:shadow-2xl hover:shadow-slate-200/50 hover:bg-white/90">
          <div class="flex items-center gap-8">
            <div class="flex items-center gap-4 pr-8 border-e border-slate-200/60">
               <div class="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center shadow-lg shadow-slate-900/20 transform hover:scale-105 transition-transform">
                  <span class="text-white font-black text-xl">D</span>
               </div>
               <div class="flex flex-col">
                 <span class="font-black text-slate-800 tracking-tight text-xl leading-none">Dawrak</span>
                 <span class="text-[0.65rem] font-bold text-emerald-600 uppercase tracking-[0.2em]">Admin Console</span>
               </div>
            </div>
            
            <!-- Tab Switcher -->
            <div class="flex bg-slate-100/50 p-1.5 rounded-2xl border border-slate-200/50">
              <button 
                @click="currentTab = 'dashboard'"
                class="px-6 py-3 rounded-xl text-xs font-black transition-all flex items-center gap-2.5 relative overflow-hidden"
                :class="currentTab === 'dashboard' ? 'bg-white text-slate-900 shadow-md shadow-slate-200' : 'text-slate-500 hover:bg-slate-200/50'"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                {{ t('dashboard') }}
              </button>
              <button 
                @click="currentTab = 'reports'"
                class="px-6 py-3 rounded-xl text-xs font-black transition-all flex items-center gap-2.5 relative overflow-hidden"
                :class="currentTab === 'reports' ? 'bg-white text-slate-900 shadow-md shadow-slate-200' : 'text-slate-500 hover:bg-slate-200/50'"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20V16"/></svg>
                {{ t('reports') }}
              </button>
            </div>
          </div>
          
          <div class="flex items-center gap-4">
            <!-- PAUSE TOGGLE -->
            <button 
              @click="togglePause"
              class="px-6 py-3.5 rounded-2xl font-black text-[0.7rem] uppercase tracking-widest transition-all active:scale-95 flex items-center gap-3 border shadow-sm group"
              :class="isPaused ? 'bg-slate-900 text-white border-slate-900 shadow-lg shadow-slate-900/20' : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-200 hover:bg-emerald-50/30'"
            >
               <div class="relative flex items-center justify-center">
                  <div v-if="!isPaused" class="w-2 h-2 bg-emerald-500 rounded-full animate-ping absolute opacity-75"></div>
                  <div :class="isPaused ? 'bg-white' : 'bg-emerald-500'" class="w-2 h-2 rounded-full relative shadow-sm"></div>
               </div>
               {{ isPaused ? t('resume_queue') : t('pause_queue') }}
            </button>

            <div class="h-10 w-px bg-slate-200"></div>

            <button @click="toggleLanguage" class="w-11 h-11 bg-white hover:bg-slate-50 rounded-2xl text-xs font-black text-slate-600 border border-slate-200 shadow-sm flex items-center justify-center transition-all hover:scale-105 active:scale-95">{{ locale === 'en' ? 'AR' : 'EN' }}</button>
            
            <button 
              @click="refetchEverything" 
              class="w-11 h-11 bg-white hover:bg-slate-50 rounded-2xl text-slate-400 hover:text-emerald-500 border border-slate-200 shadow-sm flex items-center justify-center transition-all hover:scale-105 active:scale-95 active:rotate-180"
              :class="{ 'animate-spin text-emerald-500 border-emerald-200 bg-emerald-50': isRefetching }"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
            </button>

            <button @click="logout" class="w-11 h-11 bg-white hover:bg-rose-50 rounded-2xl text-slate-400 hover:text-rose-500 border border-slate-200 shadow-sm flex items-center justify-center transition-all hover:scale-105 active:scale-95 group">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="group-hover:translate-x-0.5 transition-transform"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>
          </div>
        </div>
      </nav>

      <!-- Sub-Navbar: Navigation & Control -->
      <div v-if="currentTab === 'dashboard'" class="px-10 pt-4 flex justify-between items-center bg-transparent z-40 relative">
         <div class="flex items-center gap-2 bg-white px-4 py-2 rounded-2xl border border-slate-100 shadow-sm">
            <div class="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
            <span class="text-[0.65rem] font-black text-slate-400 uppercase tracking-widest">Live Activity</span>
         </div>
         
         <div class="flex gap-2">
            <button @click="skip" class="px-4 py-2 bg-white text-slate-400 hover:text-red-500 rounded-xl text-[0.65rem] font-black uppercase tracking-widest border border-slate-100 transition-all flex items-center gap-2 shadow-sm">
              {{ t('no_show') }}
            </button>
         </div>
      </div>

      <!-- Dashboard Tab Content -->
      <div v-if="currentTab === 'dashboard'" class="flex-1 overflow-y-auto bg-transparent z-30 relative custom-scrollbar">
        <div class="max-w-6xl mx-auto p-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          <!-- LEFT: COMMAND SECTION -->
          <div class="lg:col-span-2 space-y-8">
            
            <!-- HERO CARD: NOW SERVING -->
            <div class="bg-white/80 backdrop-blur-xl rounded-[3rem] p-10 shadow-2xl shadow-emerald-500/5 border border-white/60 flex flex-col items-center text-center relative overflow-hidden group hover:shadow-emerald-500/10 transition-shadow duration-500">
              <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-400"></div>
              
              <span class="text-[0.65rem] font-bold text-slate-400 uppercase tracking-[0.3em] mb-4">{{ t('serving_now') }}</span>
              
              <div class="relative mb-4">
                <span class="text-[10rem] font-black text-slate-900 tabular-nums leading-none tracking-tighter">
                  {{ String(currentNumber).padStart(2, '0') }}
                </span>
                <div class="absolute -top-4 -right-8 px-5 py-1.5 rounded-full text-[0.65rem] font-black uppercase tracking-widest animate-pulse transition-all duration-500 shadow-sm" 
                  :class="isPaused ? 'bg-rose-500 text-white shadow-rose-200' : 'bg-emerald-500 text-white shadow-emerald-200'">
                  {{ isPaused ? t('queue_is_paused') : 'ON AIR' }}
                </div>
              </div>

              <div class="flex items-center gap-8 mb-10">
                <div class="flex flex-col items-center">
                  <span class="text-[0.6rem] font-black text-slate-300 uppercase tracking-widest mb-1">{{ t('elapsed_time') }}</span>
                  <span class="text-2xl font-black text-slate-600 tabular-nums">{{ elapsedTime }}</span>
                </div>
                <div class="w-px h-8 bg-slate-100"></div>
                <div class="flex flex-col items-center">
                  <span class="text-[0.6rem] font-black text-slate-300 uppercase tracking-widest mb-1">Customer</span>
                  <span class="text-2xl font-black text-slate-600 italic">Guest</span>
                </div>
              </div>

              <!-- DYNAMIC ACTION TOGGLE -->
              <div class="w-full flex flex-col gap-4 mb-6">
                <!-- CALL NEXT BUTTON (Shown when NOT serving) -->
                <button 
                  v-if="!isTicketServing"
                  @click="nextNumber"
                  class="w-full h-28 bg-emerald-600 hover:bg-emerald-700 text-white rounded-[2rem] flex items-center justify-center gap-6 group transition-all active:scale-[0.98] shadow-2xl shadow-emerald-500/20"
                >
                  <span class="text-3xl font-black tracking-tight">{{ t('call_next') }}</span>
                  <div class="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center group-hover:bg-white/20 transition-colors">
                     <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" :class="locale === 'ar' ? 'rotate-180' : ''"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  </div>
                </button>

                <!-- DONE BUTTON (Shown when serving) -->
                <button 
                  v-else
                  @click="finishService"
                  class="w-full h-28 bg-black text-white rounded-full flex items-center justify-between px-10 group transition-all duration-300 active:scale-[0.98] shadow-[0_0_40px_-10px_rgba(16,185,129,0.5)] border-[3px] border-emerald-400 relative overflow-hidden hover:shadow-[0_0_60px_-10px_rgba(16,185,129,0.7)]"
                >
                  <!-- Subtle shine effect -->
                  <div class="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-500/10 to-transparent -translate-x-[150%] skew-x-12 group-hover:animate-shine transition-all duration-1000"></div>
                  
                  <span class="text-4xl font-black tracking-tight relative z-10">{{ t('done') }}</span>
                  
                  <div class="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/40 transform group-hover:scale-110 group-hover:rotate-3 transition-all duration-300 relative z-10">
                     <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                </button>
              </div>

              <!-- QUICK ACTIONS -->
              <div class="grid grid-cols-3 gap-4 w-full">
                <button @click="recall" class="h-16 bg-amber-50 hover:bg-amber-100 text-amber-600 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all border border-amber-100/50 active:scale-95">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M2 12a10 10 0 1 1 10 10"/><path d="m2 12 10 10"/></svg>
                  {{ t('recall') }}
                </button>
                <button @click="showFinishConfirmation = true" class="h-16 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all border border-rose-100/50">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 10v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V10"/><path d="M12 6V2"/><circle cx="12" cy="14" r="3"/></svg>
                  {{ t('finish_queue') }}
                </button>
                <button @click="manualAdd" class="h-16 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                  {{ t('add_manual') }}
                </button>
              </div>
            </div>

            <!-- PULSE METRICS -->
              <div class="grid grid-cols-2 gap-6">
                <!-- Predictive Finish -->
                <div class="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center gap-5 transition-transform hover:scale-[1.02] will-change-transform">
                  <div class="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-700">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/></svg>
                  </div>
                  <div>
                    <span class="text-[0.6rem] font-black text-slate-500 uppercase tracking-widest block mb-0.5">{{ t('estimated_closing') }}</span>
                    <span class="text-lg font-black text-slate-800">{{ metrics.expectedFinish }}</span>
                  </div>
                </div>
                <!-- Real-time Flux -->
                <div class="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center gap-5 transition-transform hover:scale-[1.02] will-change-transform">
                  <div class="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-700">
                    <svg v-if="metrics.trafficTrend === 'up'" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="text-rose-600"><path d="m19 12-7-7-7 7"/><path d="M12 19V5"/></svg>
                    <svg v-else-if="metrics.trafficTrend === 'down'" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="text-emerald-700"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
                    <svg v-else xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="text-slate-500"><path d="M5 12h14"/></svg>
                  </div>
                  <div>
                    <span class="text-[0.6rem] font-black text-slate-500 uppercase tracking-widest block mb-0.5">{{ t('traffic_trend') }}</span>
                    <span class="text-lg font-black text-slate-800">{{ metrics.recentFlux }} <span class="text-[0.6rem] uppercase ml-1 opacity-50">Flow</span></span>
                  </div>
                </div>
              </div>

          </div>

          <!-- RIGHT: UPCOMING TICKETS -->
          <div class="bg-white/70 backdrop-blur-xl rounded-[2.5rem] border border-white/60 shadow-lg shadow-slate-200/20 flex flex-col overflow-hidden h-fit max-h-[calc(100vh-180px)]">
             <div class="px-8 py-6 border-b border-slate-50 bg-slate-50/30 flex items-center justify-between">
                <h3 class="font-black text-slate-800 tracking-tight">{{ t('waiting_list') }}</h3>
                <span class="px-3 py-1 bg-white border border-slate-100 text-slate-400 rounded-full text-[0.6rem] font-black uppercase">{{ waitingCount }} People</span>
             </div>
             <div class="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
                <div v-for="ticket in waitingList" :key="ticket" class="p-5 bg-slate-50/50 hover:bg-slate-50 rounded-2xl border border-transparent hover:border-slate-100 transition-all flex items-center justify-between group">
                   <div class="flex items-center gap-4">
                      <div class="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center">
                        <span class="text-xl font-black text-slate-800 tabular-nums">#{{ String(ticket).padStart(2, '0') }}</span>
                      </div>
                      <div class="flex flex-col">
                        <span class="text-sm font-black text-slate-600 pr-2">Customer</span>
                        <span class="text-[0.65rem] font-bold text-slate-400 uppercase tracking-widest">Waiting</span>
                      </div>
                   </div>
                   <button @click="cancelledTickets.push(ticket)" class="p-2 text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                     <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                   </button>
                </div>
                <div v-if="waitingList.length === 0" class="py-20 text-center">
                   <p class="text-[0.65rem] font-bold text-slate-300 uppercase tracking-[0.2em]">{{ t('no_one_waiting') }}</p>
                </div>
             </div>
          </div>

        </div>
      </div>

      <!-- Reports Tab Content (Simple, Real Data, Incredible UI) -->
      <div v-else class="flex-1 overflow-y-auto bg-slate-50/50">
        <div class="max-w-4xl mx-auto p-12 space-y-12">
          
          <div class="flex flex-col md:flex-row justify-between items-end gap-6 border-b border-slate-200 pb-8">
             <div class="space-y-1">
                <h2 class="text-4xl font-black text-slate-900 tracking-tight">{{ t('reports') }}</h2>
                <div class="flex items-center gap-2">
                   <p class="text-[0.7rem] font-black text-slate-400 uppercase tracking-[0.4em]">Simple Data Overview</p>
                   <span class="w-1 h-1 bg-slate-300 rounded-full"></span>
                   <p class="text-[0.6rem] font-bold text-slate-400 uppercase tracking-widest">Updated {{ new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</p>
                </div>
             </div>
             <div class="flex items-center gap-3 bg-emerald-50 px-5 py-2.5 rounded-2xl border border-emerald-100">
                <div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                <span class="text-[0.7rem] font-black text-emerald-800 uppercase tracking-widest">System Online</span>
             </div>
          </div>

          <!-- Section 1: Today's Pulse (Large & Clear) -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
             <div class="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-xl shadow-slate-200/20 group transition-all hover:scale-[1.02]">
                <span class="text-[0.6rem] font-black text-slate-400 uppercase tracking-widest block mb-4">{{ t('today') }}</span>
                <div class="flex items-baseline gap-2">
                   <span class="text-6xl font-black text-slate-900">{{ stats.today }}</span>
                   <span class="text-xs font-bold text-slate-300 uppercase">Issued</span>
                </div>
                <div class="w-full h-1.5 bg-slate-50 mt-8 rounded-full overflow-hidden">
                   <div class="h-full bg-black" style="width: 100%"></div>
                </div>
             </div>

             <div class="bg-emerald-600 p-10 rounded-[3rem] shadow-xl shadow-emerald-500/30 group transition-all hover:scale-[1.02]">
                <span class="text-[0.6rem] font-black text-emerald-200 uppercase tracking-widest block mb-4">Served Today</span>
                <div class="flex items-baseline gap-2">
                   <span class="text-6xl font-black text-white">{{ metrics.todayServed }}</span>
                   <span class="text-xs font-bold text-emerald-300 uppercase">Complete</span>
                </div>
                <div class="w-full h-1.5 bg-white/20 mt-8 rounded-full overflow-hidden">
                   <div class="h-full bg-white" :style="{ width: metrics.completionRate }"></div>
                </div>
             </div>

             <div class="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-xl shadow-slate-200/20 group transition-all hover:scale-[1.02]">
                <span class="text-[0.6rem] font-black text-slate-400 uppercase tracking-widest block mb-4">Remaining</span>
                <div class="flex items-baseline gap-2">
                   <span class="text-6xl font-black text-slate-900">{{ waitingCount }}</span>
                   <span class="text-xs font-bold text-slate-300 uppercase">Waiting</span>
                </div>
                <div class="w-full h-1.5 bg-slate-50 mt-8 rounded-full overflow-hidden">
                   <div class="h-full bg-slate-300" :style="{ width: (waitingCount / (stats.today || 1) * 100) + '%' }"></div>
                </div>
             </div>
          </div>

          <!-- Section 2: Efficiency & Performance -->
          <div class="bg-white rounded-[3.5rem] border border-slate-100 shadow-2xl p-12 overflow-hidden relative">
             <div class="absolute top-0 right-0 p-12 opacity-[0.03]">
                <svg width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20V16"/></svg>
             </div>
             
             <div class="grid grid-cols-1 md:grid-cols-2 gap-12 relative z-10">
                <div class="space-y-6">
                   <h3 class="text-2xl font-black text-slate-800 pr-5 tracking-tight">Performance</h3>
                   <div class="space-y-8">
                      <div class="flex items-center justify-between">
                         <div class="flex flex-col">
                            <span class="text-md font-black text-slate-700">Completion Rate</span>
                            <span class="text-xs font-bold text-slate-400 uppercase">Daily Efficiency</span>
                         </div>
                         <span class="text-3xl font-black text-emerald-600">{{ metrics.completionRate }}</span>
                      </div>
                      <div class="flex items-center justify-between">
                         <div class="flex flex-col">
                            <span class="text-md font-black text-slate-700">Service Speed</span>
                            <span class="text-xs font-bold text-slate-400 uppercase">Avg wait time</span>
                         </div>
                         <span class="text-3xl font-black text-slate-800">{{ metrics.avgWait }}</span>
                      </div>
                   </div>
                </div>

                <div class="space-y-6">
                   <h3 class="text-2xl font-black text-slate-800 pr-5 tracking-tight">Historical Trends</h3>
                   <div class="space-y-4">
                      <div class="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                         <span class="text-sm font-black text-slate-600">This Week</span>
                         <span class="text-lg font-black text-slate-900">{{ stats.thisWeek }} <span class="text-[0.6rem] text-slate-400">Total</span></span>
                      </div>
                      <div class="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                         <span class="text-sm font-black text-slate-600">Last 30 Days</span>
                         <span class="text-lg font-black text-slate-900">{{ stats.last30Days }} <span class="text-[0.6rem] text-slate-400">Total</span></span>
                      </div>
                      <div class="flex items-center justify-between p-4 bg-black rounded-2xl">
                         <span class="text-sm font-black text-white">Full Lifetime</span>
                         <span class="text-lg font-black text-emerald-400">{{ stats.totalServed }} <span class="text-[0.6rem] text-emerald-600 uppercase">Served</span></span>
                      </div>
                   </div>
                </div>
             </div>
          </div>

          <!-- Section 3: Session Management -->
          <div class="flex justify-center pt-8">
             <button @click="showFinishConfirmation = true" class="group flex flex-col items-center gap-6">
                <div class="w-24 h-24 bg-red-50 text-red-500 rounded-full flex items-center justify-center transition-all group-hover:bg-red-500 group-hover:text-white shadow-xl shadow-red-500/5 group-hover:shadow-red-500/20 group-hover:scale-110 active:scale-95">
                   <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
                </div>
                <div class="text-center">
                   <span class="text-md font-black text-slate-800">{{ t('finish_queue') }}</span>
                   <p class="text-[0.6rem] font-bold text-slate-400 uppercase tracking-widest mt-1">End the current session</p>
                </div>
             </button>
          </div>

        </div>
      </div>

      <!-- Settings Modal -->
      <Transition name="fade">
        <div v-if="showSettings" class="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-md">
          <div class="bg-white w-full max-w-sm rounded-[2.5rem] p-10 shadow-2xl animate-scale-in">
            <h3 class="text-2xl font-black text-slate-800 mb-6">{{ t('settings') }}</h3>
            <div class="space-y-6">
              
              <!-- QR Code Section -->
              <div class="bg-slate-50 rounded-2xl p-6 flex flex-col items-center text-center">
                 <span class="text-[0.65rem] font-bold text-slate-400 uppercase tracking-widest mb-4">{{ t('customer_link') }}</span>
                 <div class="bg-white p-3 rounded-xl shadow-sm border border-slate-100 mb-4">
                    <img :src="`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(currentOrigin)}`" alt="Queue QR Code" class="w-40 h-40 mix-blend-multiply" />
                 </div>
                 <p class="text-xs text-slate-500 font-medium max-w-[200px]">{{ currentOrigin }}</p>
              </div>

              <div class="border-t border-slate-100 dark:border-slate-700 my-2"></div>

              <!-- Voice Control -->
              <div class="flex items-center justify-between bg-slate-50 p-4 rounded-xl">
                 <div class="flex flex-col">
                    <span class="text-sm font-black text-slate-800">{{ t('voice_calling') }}</span>
                    <span class="text-[0.6rem] font-bold text-slate-400 uppercase tracking-widest">{{ isVoiceEnabled ? t('voice_enabled') : t('voice_disabled') }}</span>
                 </div>
                 <button @click="isVoiceEnabled = !isVoiceEnabled" class="w-12 h-6 rounded-full transition-all relative border-2" :class="isVoiceEnabled ? 'bg-emerald-500 border-emerald-500' : 'bg-slate-200 border-slate-200'">
                    <div class="w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all shadow-sm" :class="isVoiceEnabled ? 'right-0.5' : 'left-0.5'"></div>
                 </button>
              </div>

              <div>
                <label class="text-[0.65rem] font-bold text-slate-400 uppercase tracking-widest pl-1 mb-2 block">{{ t('new_passcode') }}</label>
                <input v-model="newPasscode" type="password" maxlength="4" class="w-full h-14 bg-slate-50 border border-slate-100 rounded-xl px-4 font-bold outline-none focus:border-slate-300">
              </div>
              <div class="flex gap-3 pt-2">
                <button @click="updatePasscode" class="flex-1 h-14 bg-slate-900 text-white rounded-xl font-bold active:scale-95 transition-all text-sm uppercase tracking-widest">{{ t('save') }}</button>
                <button @click="showSettings = false" class="flex-1 h-14 bg-slate-100 text-slate-500 rounded-xl font-bold active:scale-95 transition-all text-sm uppercase tracking-widest">Back</button>
              </div>
            </div>
          </div>
        </div>
      </Transition>

      <!-- Finish Queue Confirmation Modal -->
      <Transition name="fade">
        <div v-if="showFinishConfirmation" class="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-xl">
          <div class="bg-white w-full max-w-sm rounded-[3rem] p-10 shadow-2xl text-center animate-scale-in border border-slate-100">
             <div class="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-6 text-rose-500">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
             </div>
             <h3 class="text-2xl font-black text-slate-800 mb-3">{{ t('finish_queue') }}</h3>
             <p class="text-slate-400 text-sm font-medium mb-10 leading-relaxed">{{ t('finish_desc') }}</p>
             <div class="flex flex-col gap-3">
                <button @click="finishQueue" class="w-full h-16 bg-rose-500 text-white rounded-2xl font-black text-lg active:scale-95 transition-all shadow-xl shadow-rose-200 uppercase tracking-widest">
                   {{ t('confirm_finish') }}
                </button>
                <button @click="showFinishConfirmation = false" class="w-full h-16 bg-slate-50 text-slate-500 rounded-2xl font-black text-lg active:scale-95 transition-all">
                   {{ t('cancel') }}
                </button>
             </div>
          </div>
        </div>
      </Transition>
    </div>

  </div>
</template>

<style scoped>
@keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }
@keyframes float-slow { 0%, 100% { transform: translate(0,0); } 33% { transform: translate(30px, -30px); } 66% { transform: translate(-20px, 20px); } }
@keyframes float-reverse { 0%, 100% { transform: translate(0,0); } 50% { transform: translate(-40px, 40px); } }
@keyframes shine { from { left: -100%; } to { left: 100%; } }

.animate-shake { animation: shake 0.2s ease-in-out 0s 2; }
.animate-scale-in { animation: scale-in 0.4s cubic-bezier(0.17, 0.67, 0.83, 0.67) forwards; }
.animate-float-slow { animation: float-slow 15s ease-in-out infinite; }
.animate-float-reverse { animation: float-reverse 20s ease-in-out infinite; }
.animate-shine { animation: shine 1.5s ease-out; }

@keyframes scale-in { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.custom-scrollbar::-webkit-scrollbar { width: 4px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: #f1f5f9; border-radius: 10px; }
.custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #e2e8f0; }
</style>
