import type { IAgoraRTCRemoteUser, IRemoteVideoTrack, IRemoteAudioTrack } from 'agora-rtc-sdk-ng'
import type { RtcService } from '../../../services/RtcService'
import { useGroupCallStore } from '../viewModel/GroupCallStore'
import { useGlobalCallStore } from '../../../store/globalCall'
import { useChatClientStore } from '../../../store/chatClient'
import { logger } from '../../../utils/logger'

/**
 * RtcMediaBridge
 * 职责：监听 Agora 事件，订阅远程流，并将 track 写入 GroupCallStore
 * 不处理 UI，不处理信令，只做纯粹的 RTC -> Store 桥接
 */
export class RtcMediaBridge {
  private rtcService: RtcService
  private store: ReturnType<typeof useGroupCallStore>
  private client: any

  constructor(rtcService: RtcService) {
    this.rtcService = rtcService
    this.store = useGroupCallStore()
    this.client = rtcService.getClient()
    // 关闭 RtcService 内部自动订阅，由本桥接器统一处理订阅逻辑，避免重复订阅导致 INVALID_REMOTE_USER 错误
    this.rtcService.setAutoSubscribe(false)
    this.bindEvents()
  }

  destroy() {
    this.unbindEvents()
    // 恢复 RtcService 自动订阅，避免影响单聊等旧流程
    this.rtcService.setAutoSubscribe(true)
  }

  private bindEvents() {
    if (!this.client) {
      logger.error('[RtcMediaBridge] RTC client 为空，无法绑定事件')
      return
    }

    this.client.on('user-joined', this.handleUserJoined)
    this.client.on('user-left', this.handleUserLeft)
    this.client.on('user-published', this.handleUserPublished)
    this.client.on('user-unpublished', this.handleUserUnpublished)
    this.client.on('volume-indicator', this.handleVolumeIndicator)

    // 启用音量检测（如果方法存在）
    try {
      if (typeof this.client.enableAudioVolumeIndicator === 'function') {
        this.client.enableAudioVolumeIndicator()
        logger.info('[RtcMediaBridge] 已启用音量检测')
      }
    } catch (e) {
      logger.warn('[RtcMediaBridge] 启用音量检测失败', e)
    }
  }

  private unbindEvents() {
    if (!this.client) return
    this.client.off('user-joined', this.handleUserJoined)
    this.client.off('user-left', this.handleUserLeft)
    this.client.off('user-published', this.handleUserPublished)
    this.client.off('user-unpublished', this.handleUserUnpublished)
    this.client.off('volume-indicator', this.handleVolumeIndicator)
  }

  private handleUserJoined = async (user: IAgoraRTCRemoteUser) => {
    const uid = user.uid.toString()
    logger.info('[RtcMediaBridge] user-joined', uid)

    // 1. 查 GroupCallStore 已建立的映射
    let userId = this.store.uidToUserIdMap.get(uid)

    // 2. 兜底：尝试 API
    if (!userId) {
      const fetched = await this.fetchUserIdByUid(uid)
      if (fetched) {
        userId = fetched
        this.store.setUidMapping(uid, userId)
      }
    }

    if (userId) {
      // 如果存在临时占位，迁移数据
      const tempUserId = `__pending_${uid}`
      const tempParticipant = this.store.participants.get(tempUserId)
      if (tempParticipant) {
        this.migrateTempParticipant(tempUserId, userId)
      } else {
        // 确保参与者存在：RTC 回调驱动，不再依赖邀请信令中的 invitedMembers
        this.ensureRemoteParticipant(userId, uid)
        this.store.setParticipantState(userId, 'joinedRtc')
      }
      // 解析成功后，尝试用 GlobalCallStore 的资料更新参与者
      this.enrichParticipantProfile(userId)
    } else {
      // 创建临时未知用户占位，等后续解析
      logger.warn('[RtcMediaBridge] 无法解析 uid，创建临时占位', uid)
      const tempUserId = `__pending_${uid}`
      this.store.setUidMapping(uid, tempUserId)
      this.store.addParticipant({
        userId: tempUserId,
        nickname: '未知用户',
        state: 'joinedRtc',
        isLocal: false,
        videoTrack: null,
        audioTrack: null,
        localStream: null,
        isMuted: false,
        isCameraOn: false,
        isSpeaking: false,
      })
    }
  }

  private handleUserLeft = (user: IAgoraRTCRemoteUser) => {
    const uid = user.uid.toString()
    let userId = this.store.uidToUserIdMap.get(uid)
    logger.info('[RtcMediaBridge] user-left', { uid, userId })
    if (userId) {
      this.store.setParticipantState(userId, 'left')
      setTimeout(() => this.store.removeParticipant(userId), 2000)
    }
  }

  private handleUserPublished = async (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => {
    // Agora 频道内 uid 为 int 类型，保持原始 number 类型用于订阅，避免 SDK 内部引用不匹配导致 INVALID_REMOTE_USER
    const uid = user.uid
    const uidStr = uid.toString()
    logger.info('[RtcMediaBridge] user-published', { uid, mediaType })

    // 主动订阅远程用户流（RtcService 自动订阅已关闭，由桥接器统一负责订阅）
    // 传入 uid 而非 user 对象：SDK 事件回调中的 user 对象可能与内部 _users 数组引用不一致，
    // 传入 uid 可让 SDK 通过 remoteUsers.find(t => t.uid === uid) 正确定位 RemoteUser 实例
    try {
      await this.rtcService.subscribeRemoteUser(uid, mediaType)
      logger.info('[RtcMediaBridge] 订阅成功', { uid, mediaType })
    } catch (error: any) {
      // INVALID_REMOTE_USER 通常意味着用户已不在频道，不阻断流程
      if (error?.message?.includes('INVALID_REMOTE_USER')) {
        logger.debug(`[RtcMediaBridge] 订阅${mediaType}被跳过，用户可能已不在频道或已被订阅`, { uid })
      } else {
        logger.error('[RtcMediaBridge] 订阅失败', { uid, mediaType, error })
        return
      }
    }

    let userId = this.store.uidToUserIdMap.get(uidStr)

    // 兜底：尝试 API（可能 publish 比 joined 先到）
    if (!userId) {
      const fetched = await this.fetchUserIdByUid(uidStr)
      if (fetched) {
        userId = fetched
        this.store.setUidMapping(uidStr, userId)
      }
    }

    if (!userId) {
      logger.warn('[RtcMediaBridge] publish 后仍无法解析 uid', uid)
      return
    }

    // 如果当前解析出来的是临时 userId，且后续已获取真实映射，执行迁移
    if (userId.startsWith('__pending_')) {
      const realUserId = await this.fetchUserIdByUid(uidStr)
      if (realUserId) {
        this.migrateTempParticipant(userId, realUserId)
        userId = realUserId
      }
    }

    // 确保参与者存在：publish 可能比 joined 先到，或邀请信令未携带 invitedMembers
    this.ensureRemoteParticipant(userId, uidStr)

    // 写入 track：优先从 SDK remoteUsers 中获取最新实例（事件回调的 user 对象可能与内部实例不同引用）
    const remoteUser = this.client.remoteUsers?.find(
      (u: any) => u.uid.toString() === uidStr
    )
    if (mediaType === 'video') {
      const track = remoteUser?.videoTrack
        || this.rtcService.getRemoteVideoTrack(userId)
        || null
      this.store.setVideoTrack(userId, track as IRemoteVideoTrack)
    } else {
      const track = remoteUser?.audioTrack
        || this.rtcService.getRemoteAudioTrack(userId)
        || null
      this.store.setAudioTrack(userId, track as IRemoteAudioTrack)
    }
  }

  private handleUserUnpublished = (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => {
    const uid = user.uid.toString()
    let userId = this.store.uidToUserIdMap.get(uid)
    logger.info('[RtcMediaBridge] user-unpublished', { uid, userId, mediaType })
    if (!userId) return

    if (mediaType === 'video') {
      this.store.setVideoTrack(userId, null)
    } else {
      this.store.setAudioTrack(userId, null)
    }
  }

  private handleVolumeIndicator = (volumes: any[]) => {
    // 批量更新说话状态
    const speakingIds = volumes.filter(v => v.level > 0).map(v => {
      const uid = v.uid.toString()
      return this.store.uidToUserIdMap.get(uid)
    }).filter(Boolean) as string[]

    this.store.activeParticipants.forEach(p => {
      const isSpeaking = speakingIds.includes(p.userId)
      if (p.isSpeaking !== isSpeaking) {
        this.store.setSpeakingState(p.userId, isSpeaking)
      }
    })
  }

  private migrateTempParticipant(tempUserId: string, realUserId: string) {
    const temp = this.store.participants.get(tempUserId)
    if (!temp) return

    logger.info('[RtcMediaBridge] 迁移临时参与者到真实 userId', { tempUserId, realUserId })

    // 从 GlobalCallStore 查询真实用户资料
    const globalCallStore = useGlobalCallStore()
    const userInfo = globalCallStore.getUserInfo(realUserId)
    const nickname = userInfo.nickname || (temp.nickname === '未知用户' ? realUserId : temp.nickname)
    const avatarUrl = userInfo.avatarURL || temp.avatarUrl

    this.store.addParticipant({
      userId: realUserId,
      nickname,
      avatarUrl,
      state: temp.state,
      isLocal: temp.isLocal,
      videoTrack: temp.videoTrack,
      audioTrack: temp.audioTrack,
      localStream: temp.localStream,
      uid: temp.uid,
      isMuted: temp.isMuted,
      isCameraOn: temp.isCameraOn,
      isSpeaking: temp.isSpeaking,
      joinedAt: temp.joinedAt,
    })

    this.store.removeParticipant(tempUserId)
  }

  /**
   * 用 GlobalCallStore 中的资料丰富参与者信息
   */
  private enrichParticipantProfile(userId: string) {
    const globalCallStore = useGlobalCallStore()
    const userInfo = globalCallStore.getUserInfo(userId)
    if (userInfo.nickname || userInfo.avatarURL) {
      this.store.updateParticipantProfile(userId, {
        nickname: userInfo.nickname,
        avatarUrl: userInfo.avatarURL,
      })
    }
  }

  /**
   * 确保远程参与者已存在于 GroupCallStore
   * RTC 回调驱动：不依赖邀请信令中的 invitedMembers，
   * 当用户加入 RTC 频道时通过 getUserIdByRTCUIds 解析 userId 后动态创建
   */
  private ensureRemoteParticipant(userId: string, uid: string) {
    if (this.store.participants.has(userId)) return

    const globalCallStore = useGlobalCallStore()
    const userInfo = globalCallStore.getUserInfo(userId)
    logger.info('[RtcMediaBridge] 动态创建参与者（邀请信令未预填充）', { userId, uid })
    this.store.addParticipant({
      userId,
      nickname: userInfo.nickname || userId,
      avatarUrl: userInfo.avatarURL,
      state: 'joinedRtc',
      isLocal: false,
      videoTrack: null,
      audioTrack: null,
      localStream: null,
      isMuted: false,
      isCameraOn: false,
      isSpeaking: false,
    })
  }

  private async fetchUserIdByUid(uid: string): Promise<string | null> {
    try {
      const chatClient = useChatClientStore().getChatClient
      if (!chatClient || typeof chatClient.getUserIdByRTCUIds !== 'function') {
        return null
      }
      const res = await (chatClient as any).getUserIdByRTCUIds([uid])
      const userId = res?.data?.[uid]
      if (userId) {
        logger.info('[RtcMediaBridge] 通过 API 获取 userId 映射成功', { uid, userId })
      }
      return userId || null
    } catch (error) {
      logger.warn('[RtcMediaBridge] 通过 API 获取 userId 映射失败', { uid, error })
      return null
    }
  }
}
