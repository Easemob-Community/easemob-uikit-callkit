<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import {
  CallKitCore,
  CALL_STATUS,
  CALL_TYPE,
  type CallKitEvent,
  type RtcReport,
} from '@easemob/callkit-core'

const props = defineProps<{
  imClient: any
  sdk?: any
}>()

const core = new CallKitCore({
  imClient: props.imClient,
  userProfile: {
    userId: props.imClient.user || props.imClient.context?.userId || '',
  },
  onEvent: (event: CallKitEvent) => {
    logEvent(event)
    if (event.type === 'shouldJoinRtc') {
      console.log('[TestHarness] shouldJoinRtc', event.payload)
    }
  },
})

const targetUserId = ref('')
const groupId = ref('')
const participants = ref('')
const logs = ref<string[]>([])
const currentStatus = ref(CALL_STATUS.IDLE)

function logEvent(event: CallKitEvent) {
  const payload = event.payload as any
  logs.value.unshift(
    `${new Date().toLocaleTimeString()} [${event.type}] ${JSON.stringify(payload).slice(0, 200)}`
  )
  if (logs.value.length > 100) logs.value.pop()
  currentStatus.value = core.getSingleCallState().status
}

async function inviteSingleCall(callType: CALL_TYPE) {
  if (!targetUserId.value) return
  await core.inviteCall({
    calleeUserId: targetUserId.value,
    callType,
  })
  currentStatus.value = core.getSingleCallState().status
}

async function inviteGroupCall(callType: CALL_TYPE) {
  if (!groupId.value || !participants.value) return
  const participantIds = participants.value.split(',').map((s) => s.trim()).filter(Boolean)
  await core.inviteGroupCall({
    groupId: groupId.value,
    participantIds,
    callType,
  })
  currentStatus.value = core.getSingleCallState().status
}

async function acceptCall() {
  await core.answerCall({ callId: core.getCurrentCallId(), result: 'accept' })
  currentStatus.value = core.getSingleCallState().status
}

async function rejectCall() {
  await core.answerCall({ callId: core.getCurrentCallId(), result: 'refuse' })
  currentStatus.value = core.getSingleCallState().status
}

async function hangupCall() {
  await core.hangup()
  currentStatus.value = core.getSingleCallState().status
}

function reportRtcJoined() {
  core.reportRtcEvent({ type: 'rtcJoined', payload: {} } as RtcReport)
}

function reportRtcLeft() {
  core.reportRtcEvent({ type: 'rtcLeft', payload: {} } as RtcReport)
}

onUnmounted(() => {
  core.destroy().catch(() => {})
})
</script>

<template>
  <div class="test-harness">
    <div class="status-bar">
      当前状态: <strong>{{ currentStatus }}</strong> |
      callId: <code>{{ core.getCurrentCallId() || '-' }}</code>
    </div>

    <div class="section">
      <h3>单聊测试</h3>
      <input v-model="targetUserId" placeholder="对方用户ID" class="input" />
      <button @click="inviteSingleCall(CALL_TYPE.AUDIO_1V1)">发起语音</button>
      <button @click="inviteSingleCall(CALL_TYPE.VIDEO_1V1)">发起视频</button>
    </div>

    <div class="section">
      <h3>群聊测试</h3>
      <input v-model="groupId" placeholder="群ID" class="input" />
      <input v-model="participants" placeholder="被邀请成员，逗号分隔" class="input" />
      <button @click="inviteGroupCall(CALL_TYPE.AUDIO_MULTI)">发起群语音</button>
      <button @click="inviteGroupCall(CALL_TYPE.VIDEO_MULTI)">发起群视频</button>
    </div>

    <div class="section">
      <h3>通话控制</h3>
      <button @click="acceptCall" :disabled="!core.canAccept()">接受</button>
      <button @click="rejectCall" :disabled="!core.canReject()">拒绝</button>
      <button @click="hangupCall" :disabled="!core.canHangup()">挂断</button>
      <button @click="reportRtcJoined">模拟 RTC 加入</button>
      <button @click="reportRtcLeft">模拟 RTC 离开</button>
    </div>

    <div class="section">
      <h3>事件日志</h3>
      <div class="logs">
        <div v-for="(log, idx) in logs" :key="idx" class="log-line">{{ log }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.test-harness {
  padding: 16px;
}
.status-bar {
  margin-bottom: 16px;
  padding: 12px;
  background: #e3f2fd;
  border-radius: 4px;
}
.section {
  margin-bottom: 20px;
  padding: 16px;
  border: 1px solid #ddd;
  border-radius: 8px;
}
.section h3 {
  margin-top: 0;
}
.input {
  display: block;
  width: 100%;
  max-width: 400px;
  margin-bottom: 8px;
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
button {
  margin-right: 8px;
  margin-bottom: 8px;
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  background: #4a90d9;
  color: #fff;
  cursor: pointer;
}
button:disabled {
  background: #ccc;
  cursor: not-allowed;
}
.logs {
  max-height: 400px;
  overflow-y: auto;
  background: #f5f5f5;
  padding: 8px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
}
.log-line {
  margin-bottom: 4px;
  word-break: break-all;
}
</style>
