import { reactive } from 'vue'

type CallStatus = 'idle' | 'inviting' | 'ringing' | 'in_call' | 'ended'

export interface CallState {
  status: CallStatus
  callType: 'audio' | 'video'
  targetUserId: string
  channel: string
  callId: string
  isCaller: boolean
  duration: number
  audioEnabled: boolean
  videoEnabled: boolean
  /** 本地 live-pusher 推流 URL */
  localStreamUrl: string
  /** 远端 live-player 拉流 URL */
  remoteStreamUrl: string
  /** 当前远端用户 ID（单聊） */
  remoteUserId: string
}

const state = reactive<CallState>({
  status: 'idle',
  callType: 'audio',
  targetUserId: '',
  channel: '',
  callId: '',
  isCaller: false,
  duration: 0,
  audioEnabled: true,
  videoEnabled: true,
  localStreamUrl: '',
  remoteStreamUrl: '',
  remoteUserId: ''
})

let durationTimer: ReturnType<typeof setInterval> | null = null

function startDurationTimer() {
  stopDurationTimer()
  state.duration = 0
  durationTimer = setInterval(() => {
    state.duration++
  }, 1000)
}

function stopDurationTimer() {
  if (durationTimer) {
    clearInterval(durationTimer)
    durationTimer = null
  }
}

export function useCallState() {
  return {
    state,
    startDurationTimer,
    stopDurationTimer
  }
}

export function resetCallState() {
  stopDurationTimer()
  state.status = 'idle'
  state.callType = 'audio'
  state.targetUserId = ''
  state.channel = ''
  state.callId = ''
  state.isCaller = false
  state.duration = 0
  state.audioEnabled = true
  state.videoEnabled = true
  state.localStreamUrl = ''
  state.remoteStreamUrl = ''
  state.remoteUserId = ''
}
