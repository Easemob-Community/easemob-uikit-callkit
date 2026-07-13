/**
 * RTC服务 - RtcService
 * 
 * 职责：
 * 1. 封装所有与音视频相关的WebRTC操作
 * 2. 管理音视频设备的访问和控制
 * 3. 处理音视频流的发布和订阅
 * 4. 提供音视频质量控制
 * 
 * 功能范围：
 * - 初始化WebRTC连接
 * - 管理本地音视频流
 * - 发布和订阅远程流
 * - 处理音视频设备切换
 * - 网络质量监控
 */

import AgoraRTC, {
  type IAgoraRTCClient,
  type IAgoraRTCRemoteUser,
  type ICameraVideoTrack,
  type IMicrophoneAudioTrack,
  type IRemoteAudioTrack,
  type IRemoteVideoTrack,
  type VideoEncoderConfigurationPreset,
} from 'agora-rtc-sdk-ng'
import { logger } from '../utils/logger'

export interface RtcServiceConfig {
  appId: string
  client?: IAgoraRTCClient // 外部传入的 Agora 客户端实例
  encoderConfig?: VideoEncoderConfigurationPreset
  onNetworkQualityChange?: (quality: any) => void
  onUserJoined?: (userId: string) => void
  onUserLeft?: (userId: string) => void
  onUserPublished?: (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => void
  onUserUnpublished?: (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => void
  onVolumeIndicator?: (volumes: any[]) => void
  chatClient?: any // 环信客户端实例，用于获取userId映射

  // 状态同步回调（替代直接写入 rtcChannelStore）
  onAudioEnabledChange?: (enabled: boolean) => void
  onVideoEnabledChange?: (enabled: boolean) => void
  onLocalStreamChange?: (stream: MediaStream | null) => void
}

export class RtcService {
  private client: IAgoraRTCClient | null = null
  private appId: string = ''
  private agoraUid: number | string = 0
  private localVideoTrack: ICameraVideoTrack | null = null
  private localAudioTrack: IMicrophoneAudioTrack | null = null
  private remoteVideoTracks: Map<string, IRemoteVideoTrack> = new Map()
  private remoteAudioTracks: Map<string, IRemoteAudioTrack> = new Map()
  private localVideoStream: MediaStream | null = null
  private currentCameraDeviceId: string | null = null
  private encoderConfig: VideoEncoderConfigurationPreset = '720p'
  private isAudioEnabled: boolean = true
  private isVideoEnabled: boolean = true
  private chatClient: any = null // 环信客户端实例
  private autoSubscribe: boolean = true // 是否自动订阅远程用户
  private isActive: boolean = false // 标记当前是否处于活跃通话中，防止 leaveChannel 后延迟的 track 创建

  // 内部 UID 映射和用户状态管理（替代 singleCallRtcStore）
  private uidToUserIdMap = new Map<string, string>()
  private joinedRtcUsers = new Set<string>()
  private leftUsers = new Set<string>()
  private pendingUserIds = new Set<string>()

  // 回调函数
  private onNetworkQualityChange?: (quality: any) => void
  private onUserJoined?: (userId: string) => void
  private onUserLeft?: (userId: string) => void
  private onUserPublished?: (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => void
  private onUserUnpublished?: (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => void
  private onVolumeIndicator?: (volumes: any[]) => void

  // 状态同步回调
  private onAudioEnabledChange?: (enabled: boolean) => void
  private onVideoEnabledChange?: (enabled: boolean) => void
  private onLocalStreamChange?: (stream: MediaStream | null) => void

  constructor(config: RtcServiceConfig) {
    this.appId = config.appId
    this.client = config.client || null
    this.encoderConfig = config.encoderConfig || '720p'
    this.chatClient = config.chatClient
    this.onNetworkQualityChange = config.onNetworkQualityChange
    this.onUserJoined = config.onUserJoined
    this.onUserLeft = config.onUserLeft
    this.onUserPublished = config.onUserPublished
    this.onUserUnpublished = config.onUserUnpublished
    this.onVolumeIndicator = config.onVolumeIndicator
    this.onAudioEnabledChange = config.onAudioEnabledChange
    this.onVideoEnabledChange = config.onVideoEnabledChange
    this.onLocalStreamChange = config.onLocalStreamChange
  }

  /**
   * 初始化RTC客户端
   */
  async initialize(): Promise<void> {
    try {
      AgoraRTC.setLogLevel(4)
      if (this.client) {
        // 使用外部传入的 client 实例，仅添加事件监听
        this.client.setClientRole('host')
        this.addEventListeners()
        logger.info('RtcService initialized with external client')
      } else {
        this.client = AgoraRTC.createClient({ mode: 'live', codec: 'h264' })
        this.client.setClientRole('host')
        this.addEventListeners()
        logger.info('RtcService initialized with new client')
      }
    } catch (error) {
      logger.error('RtcService initialization failed:', error)
      throw error
    }
  }

  /**
   * 更新 appId（支持动态更新）
   */
  setAppId(appId: string): void {
    this.appId = appId
    logger.debug('RtcService: appId 已更新为', appId)
  }

  /**
   * 设置是否自动订阅远程用户
   */
  setAutoSubscribe(enabled: boolean): void {
    this.autoSubscribe = enabled
    logger.debug('RtcService: 自动订阅已', enabled ? '开启' : '关闭')
  }

  /**
   * 加入频道
   */
  async joinChannel(
    channelName: string,
    token: string | null,
    uid: number | string,
    appId?: string  // 支持传入动态 appId
  ): Promise<number | string> {
    if (!this.client) {
      throw new Error('RTC client not initialized')
    }

    // 如果传入了 appId，更新本地 appId
    if (appId) {
      this.setAppId(appId)
    }

    try {
      this.isActive = true

      // Agora SDK 要求 uid 必须为 number 类型，此处做防御性转换
      const numericUid = typeof uid === 'string' ? Number(uid) : uid
      this.agoraUid = await this.client.join(
        this.appId,
        channelName,
        token,
        numericUid
      )
      
      logger.rtc('joinChannel', { channelName, uid: this.agoraUid, appId: this.appId })
      return this.agoraUid
    } catch (error) {
      this.isActive = false
      logger.error('Failed to join channel:', error)
      throw error
    }
  }

  /**
   * 离开频道
   */
  async leaveChannel(): Promise<void> {
    if (!this.client) return

    // 标记为非活跃，阻止延迟完成的 track 创建设置无效状态
    this.isActive = false

    try {
      // 取消发布
      if (this.localAudioTrack || this.localVideoTrack) {
        const tracks: any[] = []
        if (this.localAudioTrack) tracks.push(this.localAudioTrack)
        if (this.localVideoTrack) tracks.push(this.localVideoTrack)
        
        if (tracks.length > 0 && this.client.connectionState === 'CONNECTED') {
          await this.client.unpublish(tracks)
        }
      }

      // 关闭本地轨道
      await this.closeLocalTracks()

      // 离开频道
      if (this.client.connectionState === 'CONNECTED') {
        await this.client.leave()
      }

      logger.rtc('leaveChannel', {})
    } catch (error) {
      logger.error('Failed to leave channel:', error)
      throw error
    } finally {
      // 恢复自动订阅默认值，避免影响后续单聊等旧流程
      this.autoSubscribe = true
      logger.debug('RtcService: 自动订阅已重置为开启')
    }
  }

  /**
   * 创建本地音频轨道
   */
  async createAudioTrack(): Promise<IMicrophoneAudioTrack> {
    try {
      if (this.localAudioTrack) {
        return this.localAudioTrack
      }

      const track = await AgoraRTC.createMicrophoneAudioTrack()
      // 如果 leaveChannel 在此期间被调用，丢弃该 track 并抛出错误
      if (!this.isActive) {
        track.close()
        throw new Error('RtcService became inactive during audio track creation')
      }
      this.localAudioTrack = track
      this.onAudioEnabledChange?.(true)
      
      logger.rtc('createAudioTrack', {})
      return this.localAudioTrack
    } catch (error) {
      logger.error('Failed to create audio track:', error)
      throw error
    }
  }

  /**
   * 创建本地视频轨道
   */
  async createVideoTrack(): Promise<ICameraVideoTrack> {
    try {
      if (this.localVideoTrack) {
        return this.localVideoTrack
      }

      const config = this.encoderConfig
        ? { encoderConfig: this.encoderConfig }
        : undefined
      
      const track = await AgoraRTC.createCameraVideoTrack(config)
      // 如果 leaveChannel 在此期间被调用，丢弃该 track 并抛出错误
      if (!this.isActive) {
        track.close()
        throw new Error('RtcService became inactive during video track creation')
      }
      this.localVideoTrack = track
      this.onVideoEnabledChange?.(true)

      // 创建本地视频流
      this.localVideoStream = new MediaStream([
        this.localVideoTrack.getMediaStreamTrack()
      ])
      this.onLocalStreamChange?.(this.localVideoStream)
      
      logger.rtc('createVideoTrack', {})
      return this.localVideoTrack
    } catch (error) {
      logger.error('Failed to create video track:', error)
      throw error
    }
  }

  /**
   * 发布本地轨道
   */
  async publishTracks(tracks: any[]): Promise<void> {
    if (!this.client) {
      throw new Error('RTC client not initialized')
    }
    if (!this.isActive) {
      throw new Error('RtcService is not active, cannot publish tracks')
    }
    if (this.client.connectionState !== 'CONNECTED') {
      throw new Error(`RTC client not connected (state: ${this.client.connectionState}), cannot publish tracks`)
    }

    try {
      await this.client.publish(tracks)
      logger.rtc('publishTracks', {})
    } catch (error) {
      logger.error('Failed to publish tracks:', error)
      throw error
    }
  }

  /**
   * 切换音频状态
   */
  async toggleAudio(enabled: boolean): Promise<boolean> {
    try {
      if (!this.localAudioTrack) {
        if (enabled) {
          await this.createAudioTrack()
          if (this.client && this.client.connectionState === 'CONNECTED') {
            await this.client.publish([this.localAudioTrack!])
          }
        }
        this.isAudioEnabled = enabled
        this.onAudioEnabledChange?.(enabled)
        return enabled
      }

      await this.localAudioTrack.setEnabled(enabled)
      this.isAudioEnabled = enabled
      this.onAudioEnabledChange?.(enabled)
      
      logger.rtc('toggleAudio', { enabled })
      return enabled
    } catch (error) {
      logger.error('Failed to toggle audio:', error)
      return this.isAudioEnabled
    }
  }

  /**
   * 切换视频状态
   */
  async toggleVideo(enabled: boolean): Promise<boolean> {
    try {
      if (!this.localVideoTrack) {
        if (enabled) {
          await this.createVideoTrack()
          if (this.client && this.client.connectionState === 'CONNECTED') {
            // 检查轨道是否已发布，避免重复发布
            const publishedTracks = this.client.localTracks
            const isVideoPublished = publishedTracks.some(
              track => track.trackMediaType === 'video'
            )
            if (!isVideoPublished && this.localVideoTrack) {
              await this.client.publish([this.localVideoTrack])
              logger.info('Video track published')
            }
          }
        }
        this.isVideoEnabled = enabled
        this.onVideoEnabledChange?.(enabled)
        return enabled
      }

      if (enabled) {
        // 重新开启视频：先检查是否需要重新创建轨道
        if (!this.localVideoTrack || this.localVideoTrack.getMediaStreamTrack()?.readyState !== 'live') {
          // 轨道已被销毁或不可用，重新创建
          await this.createVideoTrack()
          if (this.client && this.client.connectionState === 'CONNECTED') {
            const publishedTracks = this.client.localTracks
            const isVideoPublished = publishedTracks.some(
              track => track.trackMediaType === 'video'
            )
            if (!isVideoPublished && this.localVideoTrack) {
              await this.client.publish([this.localVideoTrack])
              logger.info('Video track re-published')
            }
          }
          
          // 重新创建后更新本地视频流
          if (this.localVideoTrack) {
            this.localVideoStream = new MediaStream([
              this.localVideoTrack.getMediaStreamTrack()
            ])
            this.onLocalStreamChange?.(this.localVideoStream)
            logger.info('Local video stream updated after recreating track')
          }
        } else {
          // 轨道仍然有效，只需开启
          await this.localVideoTrack.setEnabled(true)
        }
        this.isVideoEnabled = true
        this.onVideoEnabledChange?.(true)
      } else {
        // 关闭视频时先取消发布，再关闭轨道
        if (this.client && this.client.connectionState === 'CONNECTED' && this.localVideoTrack) {
          try {
            await this.client.unpublish([this.localVideoTrack])
            logger.info('Video track unpublished')
          } catch (unpublishError) {
            logger.warn('Failed to unpublish video track:', unpublishError)
          }
        }
        
        // 停止并清理轨道
        const mediaStreamTrack = this.localVideoTrack.getMediaStreamTrack()
        if (mediaStreamTrack) {
          mediaStreamTrack.stop()
        }
        this.localVideoTrack.close()
        this.localVideoTrack = null
        this.localVideoStream = null
        this.onLocalStreamChange?.(null)
        this.isVideoEnabled = false
        this.onVideoEnabledChange?.(false)
      }
      
      logger.rtc('toggleVideo', { enabled })
      return this.isVideoEnabled
    } catch (error) {
      logger.error('Failed to toggle video:', error)
      return this.isVideoEnabled
    }
  }

  /**
   * 切换摄像头设备
   */
  async switchCamera(deviceId: string): Promise<boolean> {
    if (!this.localVideoTrack || !this.localVideoTrack.enabled) {
      logger.warn('Cannot switch camera: video track not available or disabled')
      return false
    }

    try {
      await this.localVideoTrack.setDevice(deviceId)
      this.currentCameraDeviceId = deviceId
      
      logger.info('Camera switched to:', deviceId)
      return true
    } catch (error) {
      logger.error('Failed to switch camera:', error)
      return false
    }
  }

  /**
   * 切换麦克风设备
   */
  async switchMicrophone(deviceId: string): Promise<boolean> {
    if (!this.localAudioTrack || !this.localAudioTrack.enabled) {
      logger.warn('Cannot switch microphone: audio track not available or disabled')
      return false
    }

    try {
      await this.localAudioTrack.setDevice(deviceId)
      
      logger.info('Microphone switched to:', deviceId)
      return true
    } catch (error) {
      logger.error('Failed to switch microphone:', error)
      return false
    }
  }

  /**
   * 订阅远程用户
   * 支持传入 IAgoraRTCRemoteUser 对象或 uid（number/string）
   * 当传入 uid 时，SDK 内部会通过 remoteUsers 查找对应的 RemoteUser 实例，
   * 避免事件回调中的 user 对象与 SDK 内部实例引用不一致导致 INVALID_REMOTE_USER
   */
  async subscribeRemoteUser(
    userOrUid: IAgoraRTCRemoteUser | number | string,
    mediaType: 'audio' | 'video'
  ): Promise<void> {
    if (!this.client) {
      throw new Error('RTC client not initialized')
    }

    // 前置校验：确认用户仍在 remoteUsers 列表中且已发布指定媒体
    const uid = typeof userOrUid === 'object' ? userOrUid.uid : userOrUid
    const uidStr = uid.toString()
    const remoteUser = this.client.remoteUsers.find(
      u => u.uid.toString() === uidStr
    )
    if (!remoteUser) {
      logger.warn('[RtcService] 订阅跳过：远程用户不在列表中', { uid: uidStr, mediaType })
      return
    }
    const hasPublished = mediaType === 'video'
      ? remoteUser.hasVideo
      : remoteUser.hasAudio
    if (!hasPublished) {
      logger.warn('[RtcService] 订阅跳过：远程用户未发布指定媒体', { uid: uidStr, mediaType })
      return
    }

    try {
      await this.client.subscribe(userOrUid as any, mediaType)
      
      // 订阅成功后，从 remoteUsers 中获取最新的 RemoteUser 对象以读取 track
      const subscribedUser = this.client.remoteUsers.find(
        u => u.uid.toString() === uidStr
      )
      
      if (mediaType === 'video' && subscribedUser?.videoTrack) {
        this.remoteVideoTracks.set(uidStr, subscribedUser.videoTrack)
      } else if (mediaType === 'audio' && subscribedUser?.audioTrack) {
        this.remoteAudioTracks.set(uidStr, subscribedUser.audioTrack)
        subscribedUser.audioTrack.play()
      }
      
      logger.info('Subscribed to remote user:', { uid: uidStr, mediaType })
    } catch (error: any) {
      const errorMessage = error?.message || String(error)
      // INVALID_REMOTE_USER / REMOTE_USER_IS_NOT_PUBLISHED 为可预期的时序错误，降级为 warn
      if (errorMessage.includes('INVALID_REMOTE_USER') || errorMessage.includes('REMOTE_USER_IS_NOT_PUBLISHED')) {
        logger.warn('[RtcService] 订阅远程用户时遇到预期错误（用户可能已离开或未发布）:', { uid: uidStr, mediaType, error: errorMessage })
        return
      }
      logger.error('Failed to subscribe remote user:', error)
      throw error
    }
  }

  /**
   * 获取本地视频流
   */
  getLocalVideoStream(): MediaStream | null {
    if (this.localVideoStream) {
      return this.localVideoStream
    }

    if (this.localVideoTrack) {
      this.localVideoStream = new MediaStream([
        this.localVideoTrack.getMediaStreamTrack()
      ])
      return this.localVideoStream
    }

    return null
  }

  /**
   * 获取远程视频轨道（通过userId）
   */
  getRemoteVideoTrack(userId: string): IRemoteVideoTrack | null {
    // 先查找Map中是否直接存在该key(兼容旧代码可能直接使用UID)
    if (this.remoteVideoTracks.has(userId)) {
      return this.remoteVideoTracks.get(userId) || null
    }
    
    // 尝试通过userId查找UID，然后查找轨道
    // 遍历内部 uidToUserIdMap 找到对应的UID
    for (const [uid, mappedUserId] of this.uidToUserIdMap.entries()) {
      if (mappedUserId === userId) {
        const track = this.remoteVideoTracks.get(uid)
        if (track) {
          return track
        }
      }
    }
    
    return null
  }

  /**
   * 获取远程音频轨道（通过userId）
   */
  getRemoteAudioTrack(userId: string): IRemoteAudioTrack | null {
    // 先查找Map中是否直接存在该key(兼容旧代码可能直接使用UID)
    if (this.remoteAudioTracks.has(userId)) {
      return this.remoteAudioTracks.get(userId) || null
    }
    
    // 尝试通过userId查找UID，然后查找轨道
    for (const [uid, mappedUserId] of this.uidToUserIdMap.entries()) {
      if (mappedUserId === userId) {
        const track = this.remoteAudioTracks.get(uid)
        if (track) {
          return track
        }
      }
    }
    
    return null
  }

  /**
   * 获取本地视频轨道
   */
  getLocalVideoTrack(): ICameraVideoTrack | null {
    return this.localVideoTrack
  }

  getLocalAudioTrack(): IMicrophoneAudioTrack | null {
    return this.localAudioTrack
  }

  /**
   * 检查音频是否静音
   */
  isMuted(): boolean {
    return !this.isAudioEnabled
  }

  /**
   * 检查摄像头是否开启
   */
  isCameraEnabled(): boolean {
    return this.isVideoEnabled
  }

  /**
   * 获取RTC客户端
   */
  getClient(): IAgoraRTCClient | null {
    return this.client
  }

  /**
   * 关闭本地轨道
   */
  private async closeLocalTracks(): Promise<void> {
    if (this.localAudioTrack) {
      const mediaStreamTrack = this.localAudioTrack.getMediaStreamTrack()
      if (mediaStreamTrack && mediaStreamTrack.readyState === 'live') {
        mediaStreamTrack.stop()
      }
      this.localAudioTrack.close()
      this.localAudioTrack = null
    }

    if (this.localVideoTrack) {
      const mediaStreamTrack = this.localVideoTrack.getMediaStreamTrack()
      if (mediaStreamTrack) {
        mediaStreamTrack.stop()
      }
      this.localVideoTrack.close()
      this.localVideoTrack = null
    }

    if (this.localVideoStream) {
      this.localVideoStream.getTracks().forEach(track => track.stop())
      this.localVideoStream = null
    }

    this.onLocalStreamChange?.(null)
  }

  /**
   * 添加事件监听
   */
  private addEventListeners(): void {
    if (!this.client) return

    // 用户加入
    this.client.on('user-joined', async (user: IAgoraRTCRemoteUser) => {
      // 获取userId映射
      let userId = this.uidToUserIdMap.get(user.uid.toString())

      // 1. 先检查是否有待加入的userId（从 answerCall 信令添加）
      if (!userId) {
        const pendingUserId = this.popPendingUserId()
        if (pendingUserId) {
          userId = pendingUserId
          this.uidToUserIdMap.set(user.uid.toString(), userId)
          logger.info('User-joined: 使用待加入列表匹配 userId:', { uid: user.uid, userId })
        }
      }

      // 2. 如果还没有，尝试通过环信API获取映射
      if (!userId && this.chatClient) {
        try {
          const res = await this.chatClient.getUserIdByRTCUIds([user.uid])
          userId = res.data[user.uid]
          if (userId) {
            this.uidToUserIdMap.set(user.uid.toString(), userId)
            logger.info('User-joined: 通过API获取userId映射:', { uid: user.uid, userId })
          } else {
            logger.warn('User-joined: API返回的userId为空:', user.uid)
          }
        } catch (error) {
          logger.error('获取userId映射失败:', error)
        }
      }

      // 标记用户已加入RTC
      if (userId) {
        this.markUserJoinedRtc(userId)
        logger.info('[RTC DEBUG] 用户已标记为加入RTC:', { uid: user.uid, userId })
      } else {
        logger.warn('User-joined: 未能获取userId映射，使用uid作为默认值:', user.uid)
      }

      logger.rtc('userJoined', { uid: user.uid, userId })
      this.onUserJoined?.(userId || user.uid.toString())
    })

    // 用户离开
    this.client.on('user-left', (user: IAgoraRTCRemoteUser, reason: string) => {
      // 获取userId
      const userId = this.uidToUserIdMap.get(user.uid.toString())
      logger.rtc('userLeft', { uid: user.uid, userId, reason })

      // 清理远程轨道
      this.remoteVideoTracks.delete(user.uid.toString())
      this.remoteAudioTracks.delete(user.uid.toString())

      // 标记用户已离开RTC
      if (userId) {
        this.markUserLeftRtc(userId)
      }

      this.onUserLeft?.(userId || user.uid.toString())
    })

    // 用户发布 - 自动订阅远程用户
    this.client.on('user-published', async (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => {
      // 获取userId映射
      let userId = this.uidToUserIdMap.get(user.uid.toString())
      if (!userId && this.chatClient) {
        try {
          const res = await this.chatClient.getUserIdByRTCUIds([user.uid])
          userId = res.data[user.uid]
          if (userId) {
            this.uidToUserIdMap.set(user.uid.toString(), userId)
            this.markUserJoinedRtc(userId)
            logger.info('[RTC DEBUG] user-published 时标记用户加入:', { uid: user.uid, userId, mediaType })
          }
        } catch (error) {
          logger.error('获取userId映射失败:', error)
        }
      }
      
      logger.rtc('userPublished', { uid: user.uid, userId, mediaType })

      // 自动订阅远程用户（可被上层关闭，由上层统一处理订阅逻辑）
      if (this.autoSubscribe) {
        try {
          await this.subscribeRemoteUser(user.uid, mediaType)
          logger.info('自动订阅远程用户成功:', { uid: user.uid, userId, mediaType })
        } catch (error: any) {
          // subscribeRemoteUser 内部已处理 INVALID_REMOTE_USER / REMOTE_USER_IS_NOT_PUBLISHED
          // 此处仅记录，避免抛出异常打断后续事件处理
          logger.warn('[RtcService] 自动订阅远程用户失败（已内部降级）:', { uid: user.uid, mediaType, error: error?.message || String(error) })
        }
      }
      
      // 触发回调
      this.onUserPublished?.(user, mediaType)
    })

    // 用户取消发布
    this.client.on('user-unpublished', (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => {
      const userId = this.uidToUserIdMap.get(user.uid.toString())
      logger.rtc('userUnpublished', { uid: user.uid, userId, mediaType })
      
      if (mediaType === 'video') {
        this.remoteVideoTracks.delete(user.uid.toString())
      } else if (mediaType === 'audio') {
        this.remoteAudioTracks.delete(user.uid.toString())
      }
      
      this.onUserUnpublished?.(user, mediaType)
    })

    // 网络质量
    this.client.on('network-quality', (quality: any) => {
      this.onNetworkQualityChange?.(quality)
    })

    // 音量指示器
    this.client.on('volume-indicator', (volumes: any[]) => {
      this.onVolumeIndicator?.(volumes)
    })
  }

  /**
   * 取消发布本地轨道
   */
  async unpublishTracks(tracks: any[]): Promise<void> {
    if (!this.client) {
      throw new Error('RTC client not initialized')
    }
    try {
      await this.client.unpublish(tracks)
      logger.rtc('unpublishTracks', {})
    } catch (error) {
      logger.error('Failed to unpublish tracks:', error)
      throw error
    }
  }

  /**
   * 取消订阅远程用户
   */
  async unsubscribeRemoteUser(
    userOrUid: IAgoraRTCRemoteUser | number | string,
    mediaType: 'audio' | 'video'
  ): Promise<void> {
    if (!this.client) {
      throw new Error('RTC client not initialized')
    }
    try {
      await this.client.unsubscribe(userOrUid as any, mediaType)
      const uid = typeof userOrUid === 'object' ? userOrUid.uid : userOrUid
      if (mediaType === 'video') {
        this.remoteVideoTracks.delete(uid.toString())
      } else {
        this.remoteAudioTracks.delete(uid.toString())
      }
      logger.info('Unsubscribed remote user:', { uid, mediaType })
    } catch (error) {
      logger.error('Failed to unsubscribe remote user:', error)
      throw error
    }
  }

  // ─── 用户状态管理（替代 singleCallRtcStore）───

  /**
   * 添加 UID 到 userId 的映射
   */
  setUidToUserIdMapping(uid: string, userId: string) {
    this.uidToUserIdMap.set(uid, userId)
    logger.debug('RTC UID映射已更新:', { uid, userId })
  }

  /**
   * 根据 userId 获取 UID
   */
  getUidByUserId(userId: string): string | null {
    for (const [uid, mappedUserId] of this.uidToUserIdMap.entries()) {
      if (mappedUserId === userId) {
        return uid
      }
    }
    return null
  }

  /**
   * 标记用户已加入 RTC 频道
   */
  markUserJoinedRtc(userId: string) {
    this.joinedRtcUsers.add(userId)
    if (this.leftUsers.has(userId)) {
      this.leftUsers.delete(userId)
      logger.debug('用户重新加入RTC，从leftUsers中移除:', userId)
    }
    logger.debug('用户已加入RTC频道:', userId)
  }

  /**
   * 标记用户离开 RTC 频道
   */
  markUserLeftRtc(userId: string) {
    this.joinedRtcUsers.delete(userId)
    this.leftUsers.add(userId)
    logger.debug('用户已离开RTC频道并标记为leftUser:', userId)
  }

  /**
   * 检查用户是否已加入 RTC 频道
   */
  isUserInRtc(userId: string): boolean {
    return this.joinedRtcUsers.has(userId)
  }

  /**
   * 检查用户是否已明确离开
   */
  hasUserLeft(userId: string): boolean {
    return this.leftUsers.has(userId)
  }

  /**
   * 添加待加入 RTC 的 userId
   */
  addPendingUserId(userId: string) {
    this.pendingUserIds.add(userId)
    logger.debug('用户已标记为待加入RTC:', userId)
  }

  /**
   * 获取第一个待加入的 userId 并移除
   */
  popPendingUserId(): string | null {
    const iter = this.pendingUserIds.values()
    const first = iter.next()
    if (!first.done) {
      const userId = first.value
      this.pendingUserIds.delete(userId)
      logger.debug('从待加入列表中取出userId:', userId)
      return userId
    }
    return null
  }

  /**
   * 重置所有用户状态
   */
  resetUserState() {
    this.uidToUserIdMap.clear()
    this.joinedRtcUsers.clear()
    this.pendingUserIds.clear()
    this.leftUsers.clear()
    logger.debug('RtcService 用户状态已重置')
  }

  // ─── 销毁 ───

  /**
   * 销毁RTC服务
   */
  async destroy(): Promise<void> {
    try {
      await this.leaveChannel()

      // 清理并停止所有远程轨道
      this.remoteVideoTracks.forEach((track, userId) => {
        try {
          track.stop()
          logger.debug('远程视频轨道已停止:', userId)
        } catch (error) {
          logger.warn('停止远程视频轨道失败:', error)
        }
      })
      this.remoteVideoTracks.clear()

      this.remoteAudioTracks.forEach((track, userId) => {
        try {
          track.stop()
          logger.debug('远程音频轨道已停止:', userId)
        } catch (error) {
          logger.warn('停止远程音频轨道失败:', error)
        }
      })
      this.remoteAudioTracks.clear()

      if (this.client) {
        this.client.removeAllListeners()
        this.client = null
      }

      // 重置状态标志
      this.isAudioEnabled = true
      this.isVideoEnabled = true
      this.agoraUid = 0
      this.currentCameraDeviceId = null
      this.resetUserState()

      logger.rtc('destroy', {})
    } catch (error) {
      logger.error('Failed to destroy RtcService:', error)
    }
  }
}