<template>
  <div class="call-waiting">
    <div class="caller-info">
      <div class="caller-avatar">
        <img v-if="targetUserInfo.avatarURL" :src="targetUserInfo.avatarURL" :alt="displayName" />
        <div v-else class="avatar-fallback">{{ displayName?.[0]?.toUpperCase() || '?' }}</div>
      </div>
      <div class="caller-details">
        <h3>正在呼叫</h3>
        <p>{{ displayName }}</p>
        <div class="call-type-indicator">{{ callType === 'audio' ? '语音通话' : '视频通话' }}</div>
      </div>
    </div>
    
    <div class="waiting-controls">
      <button @click="cancelCall" class="cancel-btn">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M8.43445 12.6265C8.40888 12.6658 8.46336 13.037 8.45381 13.1428C8.43469 13.3543 8.44114 13.5264 8.40602 13.6715C8.24328 14.7412 7.53366 15.2879 5.71437 15.4497C4.58252 15.5543 3.85663 15.3068 3.4024 14.7319C3.08891 14.3045 2.98642 13.7342 3.01174 12.967C2.99573 12.9006 2.99239 12.4507 3.02751 12.3056C3.02369 10.4 7.03906 8.58585 11.9887 8.60976C16.8967 8.60665 20.9804 10.4191 21.0002 12.3909L20.9971 12.6688L20.994 12.9466C20.9911 13.9523 20.9178 14.5203 20.5023 14.9781C20.0867 15.4359 19.3642 15.6384 18.3857 15.5067C16.2946 15.2681 15.6485 14.6246 15.6064 13.1421C15.616 13.0363 15.6286 12.6527 15.5871 12.6257C15.5742 12.2815 14.196 11.9462 12.0345 11.9979C9.81551 11.9561 8.40554 12.2159 8.43445 12.6265Z" />
        </svg>
      </button>

    </div>
    
    <div class="waiting-timer">{{ waitingTime }}s</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, toRef } from 'vue'
import { useCallKit } from '../../composables/useCallKit'
import { useGlobalCallStore } from '../../store/globalCall'

interface CallWaitingProps {
  targetUser: string
  type: 'audio' | 'video'
}

const props = defineProps<CallWaitingProps>()
const globalCallStore = useGlobalCallStore()

const targetUserInfo = computed(() => {
  return globalCallStore.getUserInfo(props.targetUser)
})

const displayName = computed(() => {
  return targetUserInfo.value.nickname || props.targetUser
})

const { cancel: hangupCall } = useCallKit()

const emit = defineEmits<{
  cancel: []
}>()

const waitingTime = ref(0)
let waitingTimer: number | null = null

// 启动等待计时器
const startWaitingTimer = () => {
  waitingTime.value = 0
  waitingTimer = window.setInterval(() => {
    waitingTime.value++
  }, 1000)
}

// 停止等待计时器
const stopWaitingTimer = () => {
  if (waitingTimer) {
    clearInterval(waitingTimer)
    waitingTimer = null
  }
}

// 取消呼叫
const cancelCall = () => {
  stopWaitingTimer()
  hangupCall()
  emit('cancel')
}

const callType = toRef(props, 'type')

onMounted(() => {
  startWaitingTimer()
})

onUnmounted(() => {
  stopWaitingTimer()
})
</script>

<style scoped src="./styles/EasemobChatCallWaiting.css"></style>