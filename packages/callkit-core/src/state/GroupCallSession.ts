import type { Logger } from '../utils/logger'
import { getLogger } from '../utils/logger'

/**
 * 群聊参与者
 */
export interface GroupParticipant {
  userId: string
  nickname: string
  avatarUrl?: string
  state: 'invited' | 'accepted' | 'joinedRtc' | 'left'
  isLocal: boolean
  isMuted: boolean
  isCameraOn: boolean
  isSpeaking: boolean
}

/**
 * 群聊会话状态
 */
export interface GroupSessionState {
  sessionId: string
  groupId: string
  groupName: string
  callType: 'audio' | 'video'
  status: 'inviting' | 'inCall' | 'ended'
  callerUserId: string
  startTime: number
}

/**
 * 群聊会话管理
 *
 * 职责：
 * 1. 管理群聊通话的会话元数据
 * 2. 维护参与者集合及其状态流转
 * 3. 不执行副作用，只维护内存状态
 */
export class GroupCallSession {
  private session: GroupSessionState | null = null
  private participants = new Map<string, GroupParticipant>()
  // left 后延迟移除的定时器（userId → timer），防止重进成员被误杀
  private pendingRemoveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private logger: Logger

  constructor(logger?: Logger) {
    this.logger = logger || getLogger()
  }

  /**
   * 初始化会话
   */
  init(params: {
    sessionId: string
    groupId: string
    groupName: string
    callType: 'audio' | 'video'
    callerUserId: string
  }): void {
    this.session = {
      ...params,
      status: 'inviting',
      startTime: Date.now(),
    }
    this.participants.clear()
    this.logger.info('[GroupCallSession] 初始化', params)
  }

  /**
   * 添加参与者
   */
  addParticipant(info: GroupParticipant): void {
    this.participants.set(info.userId, { ...info })
    this.logger.info('[GroupCallSession] 添加参与者', { userId: info.userId, state: info.state })
  }

  /**
   * 移除参与者
   */
  removeParticipant(userId: string): boolean {
    const removed = this.participants.delete(userId)
    if (removed) {
      this.logger.info('[GroupCallSession] 移除参与者', { userId })
    }
    return removed
  }

  /**
   * 延迟移除已离开参与者（left 后 2 秒）
   * - 新 left 先取消同 userId 的旧 timer
   * - 真正移除前校验当前 state 仍为 'left'，防止误杀重进成员
   */
  scheduleRemoveParticipant(userId: string, delayMs = 2000): void {
    const existing = this.pendingRemoveTimers.get(userId)
    if (existing) {
      clearTimeout(existing)
      this.pendingRemoveTimers.delete(userId)
    }
    const timer = setTimeout(() => {
      this.pendingRemoveTimers.delete(userId)
      const p = this.participants.get(userId)
      if (p && p.state === 'left') {
        this.removeParticipant(userId)
      }
    }, delayMs)
    this.pendingRemoveTimers.set(userId, timer)
  }

  /**
   * 标记参与者状态
   */
  setParticipantState(userId: string, state: GroupParticipant['state']): boolean {
    const p = this.participants.get(userId)
    if (!p) return false
    p.state = state
    this.logger.info('[GroupCallSession] 更新参与者状态', { userId, state })
    return true
  }

  /**
   * 标记已接受
   */
  markAccepted(userId: string): boolean {
    return this.setParticipantState(userId, 'accepted')
  }

  /**
   * 标记已加入 RTC
   */
  markJoinedRtc(userId: string): boolean {
    const ok = this.setParticipantState(userId, 'joinedRtc')
    if (ok && this.session && this.session.status === 'inviting') {
      this.session.status = 'inCall'
    }
    return ok
  }

  /**
   * 标记已离开 RTC
   */
  markLeftRtc(userId: string): boolean {
    return this.setParticipantState(userId, 'left')
  }

  /**
   * 标记音频静音状态
   */
  markAudioMuted(userId: string, muted: boolean): boolean {
    const p = this.participants.get(userId)
    if (!p) return false
    p.isMuted = muted
    this.logger.info('[GroupCallSession] 更新音频状态', { userId, muted })
    return true
  }

  /**
   * 标记视频开关状态
   */
  markVideoOn(userId: string, on: boolean): boolean {
    const p = this.participants.get(userId)
    if (!p) return false
    p.isCameraOn = on
    this.logger.info('[GroupCallSession] 更新视频状态', { userId, on })
    return true
  }

  /**
   * 获取参与者
   */
  getParticipant(userId: string): Readonly<GroupParticipant> | undefined {
    const p = this.participants.get(userId)
    return p ? Object.freeze({ ...p }) : undefined
  }

  /**
   * 获取所有参与者
   */
  getAllParticipants(): Readonly<GroupParticipant>[] {
    return Array.from(this.participants.values()).map((p) => Object.freeze({ ...p }))
  }

  /**
   * 获取当前在线参与者（未离开）
   */
  getActiveParticipants(): Readonly<GroupParticipant>[] {
    return this.getAllParticipants().filter((p) => p.state !== 'left')
  }

  /**
   * 获取会话快照
   */
  getSnapshot(): Readonly<GroupSessionState> | null {
    return this.session ? Object.freeze({ ...this.session }) : null
  }

  /**
   * 结束会话
   */
  end(): void {
    if (this.session) {
      this.session.status = 'ended'
    }
    this.logger.info('[GroupCallSession] 会话结束')
  }

  /**
   * 销毁会话
   */
  destroy(): void {
    this.pendingRemoveTimers.forEach((timer) => clearTimeout(timer))
    this.pendingRemoveTimers.clear()
    this.session = null
    this.participants.clear()
    this.logger.info('[GroupCallSession] 已销毁')
  }
}
