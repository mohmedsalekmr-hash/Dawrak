<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { supabase } from '../supabase'

/** State */
const currentNumber = ref(0)
const lastIssued = ref(0)
const queueId = ref<number | null>(null)
const isLoading = ref(false)

/** Realtime */
onMounted(async () => {
    // Note: In a real app we would share this state management or use a store
    let { data } = await supabase
        .from('queues')
        .select('*')
        .limit(1)
        .maybeSingle()

    if (data) {
        queueId.value = data.id
        currentNumber.value = data.current_number ?? 0
        lastIssued.value = data.last_issued_number ?? 0
    }

    supabase
        .channel('admin-queues')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'queues' }, (payload) => {
            const newRow = payload.new as any
            if (queueId.value && newRow.id === queueId.value) {
                currentNumber.value = newRow.current_number ?? 0
                lastIssued.value = newRow.last_issued_number ?? 0
            }
        })
        .subscribe()
})

async function nextNumber() {
    if (!queueId.value) return
    isLoading.value = true
    
    // Optimistic update
    const next = currentNumber.value + 1
    
    const { error } = await supabase
        .from('queues')
        .update({ current_number: next })
        .eq('id', queueId.value)
        
    if (error) {
        console.error(error)
        alert('Error updating queue')
    }
    
    isLoading.value = false
}

async function resetQueue() {
    if (!queueId.value || !confirm('WARNNG: This will reset the queue to 0. Are you sure?')) return
    
    const { error } = await supabase
        .from('queues')
        .update({ current_number: 0, last_issued_number: 0 })
        .eq('id', queueId.value)

    if (error) alert('Error resetting queue')
}
</script>

<template>
    <div class="min-h-screen bg-gray-900 text-white p-8 font-sans" dir="rtl">
        <div class="max-w-md mx-auto">
            <h1 class="text-3xl font-bold mb-8 text-center">لوحة التحكم (Admin)</h1>
            
            <div class="bg-gray-800 rounded-2xl p-8 border border-gray-700 shadow-xl mb-8">
                <p class="text-gray-400 text-sm mb-2">الدور الحالي</p>
                <div class="text-8xl font-black text-white mb-4">{{ currentNumber }}</div>
                
                <div class="flex items-center justify-between text-gray-400 text-sm border-t border-gray-700 pt-4">
                    <span>آخر رقم تم سحبه:</span>
                    <span class="text-white font-bold text-xl">{{ lastIssued }}</span>
                </div>
                <div class="flex items-center justify-between text-gray-400 text-sm mt-2">
                    <span>في الانتظار:</span>
                    <span class="text-dignified-green font-bold text-xl">{{ Math.max(0, lastIssued - currentNumber) }}</span>
                </div>
            </div>
            
            <div class="space-y-4">
                <button 
                    @click="nextNumber"
                    :disabled="isLoading || currentNumber >= lastIssued"
                    class="w-full py-6 bg-dignified-green hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-2xl font-bold shadow-lg transition-all active:scale-95"
                >
                    التالي (Next) 🔔
                </button>
                
                <button 
                    @click="resetQueue"
                    class="w-full py-4 bg-red-900/50 hover:bg-red-900 text-red-200 rounded-xl text-sm font-medium border border-red-800 transition-colors"
                >
                    إعادة تعيين الدور (Reset)
                </button>
            </div>
        </div>
    </div>
</template>
