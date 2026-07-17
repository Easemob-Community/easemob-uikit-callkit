import { reactive } from 'vue'

type CallStatus = 'idle' | 'inviting' | 'ringing' | 'in_call' | 'ended'

export interface UserInfo {
  nickname?: string
  avatarURL?: string
}

export interface CallState {
  status: CallStatus
  /** 当前登录用户 ID（初始化时写入，通话结束不重置） */
  localUserId: string
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
  /** 当前远端用户 ID（单聊，环信 userId） */
  remoteUserId: string
  /** 当前远端用户 Agora RTC UID（单聊） */
  remoteUid: string
  /** 用户资料映射表（userId → UserInfo） */
  userInfoMap: Record<string, UserInfo>
}

const state = reactive<CallState>({
  status: 'idle',
  localUserId: '',
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
  remoteUserId: '',
  remoteUid: '',
  userInfoMap: {}
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
  state.remoteUid = ''
  // userInfoMap 跨通话保留，不重置
}
