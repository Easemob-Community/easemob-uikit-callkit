import { reactive } from 'vue'

export interface GroupParticipant {
  userId: string
  uid: string | number
  streamUrl: string
  state: 'invited' | 'accepted' | 'joinedRtc' | 'left'
  isMuted: boolean
  isCameraOn: boolean
  nickname: string
  avatarURL: string
  isLocal: boolean
  isSpeaking: boolean
}

export interface GroupCallSession {
  groupId: string
  groupName: string
  callType: 'audio' | 'video'
  startTime: number | null
  /** 主叫方用户 ID（被叫响铃页展示"xxx 邀请你加入"） */
  callerUserId?: string
}

export interface GroupCallState {
  session: GroupCallSession | null
  participants: GroupParticipant[]
  invitedParticipants: GroupParticipant[]
  callStatus: 'idle' | 'ringing' | 'in_call' | 'ended'
}

const state = reactive<GroupCallState>({
  session: null,
  participants: [],
  invitedParticipants: [],
  callStatus: 'idle'
})

let inviteTimeoutTimer: ReturnType<typeof setTimeout> | null = null
const INVITE_TIMEOUT_MS = 30000

function startInviteTimeout(onTimeout: () => void) {
  stopInviteTimeout()
  inviteTimeoutTimer = setTimeout(() => {
    onTimeout()
  }, INVITE_TIMEOUT_MS)
}

function stopInviteTimeout() {
  if (inviteTimeoutTimer) {
    clearTimeout(inviteTimeoutTimer)
    inviteTimeoutTimer = null
  }
}

function findParticipantIndex(userId: string): number {
  return state.participants.findIndex((p) => p.userId === userId)
}

function upsertParticipant(participant: Partial<GroupParticipant> & { userId: string }) {
  const index = findParticipantIndex(participant.userId)
  if (index >= 0) {
    state.participants[index] = {
      ...state.participants[index],
      ...participant
    }
  } else {
    state.participants.push({
      uid: '',
      streamUrl: '',
      state: 'invited',
      isMuted: false,
      isCameraOn: false,
      nickname: participant.userId,
      avatarURL: '',
      isLocal: false,
      isSpeaking: false,
      ...participant
    } as GroupParticipant)
  }
}

function removeParticipant(userId: string) {
  const index = findParticipantIndex(userId)
  if (index >= 0) {
    state.participants.splice(index, 1)
  }
}

function updateParticipantState(userId: string, updates: Partial<GroupParticipant>) {
  const index = findParticipantIndex(userId)
  if (index >= 0) {
    state.participants[index] = {
      ...state.participants[index],
      ...updates
    }
  }
}

export function useGroupCallState() {
  return {
    state,
    startInviteTimeout,
    stopInviteTimeout,
    upsertParticipant,
    removeParticipant,
    updateParticipantState
  }
}

export function resetGroupCallState() {
  stopInviteTimeout()
  state.session = null
  state.participants = []
  state.invitedParticipants = []
  state.callStatus = 'idle'
}
