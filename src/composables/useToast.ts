import { ref } from 'vue'

const isVisible = ref(false)
const message = ref('')
const type = ref<'success' | 'error' | 'info'>('info')
let timeout: any = null

export function useToast() {
    function show(msg: string, t: 'success' | 'error' | 'info' = 'info') {
        message.value = msg
        type.value = t
        isVisible.value = true

        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(() => {
            isVisible.value = false
        }, 4000)
    }

    return { isVisible, message, type, show }
}
