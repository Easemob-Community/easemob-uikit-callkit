/**
 * RTC服务 - RtcService
 *
 * 职责：
 * 1. 封装所有与音视频相关的 WebRTC 原子操作
 * 2. 管理本地音视频轨道生命周期
 * 3. 将 Agora SDK 事件通过回调传出，不保存任何业务状态
 *
 * 设计原则：
 * - 不维护 uid → userId 映射
 * - 不维护参与者加入/离开状态
 * - 本地媒体轨道生命周期由本类管理
 * - 远程流订阅策略默认自动，但可由上层关闭
 */

import AgoraRTC, {
  type IAgoraRTCClient,
  type IAgoraRTCRemoteUser,
  type ICameraVideoTrack,
  type IMicrophoneAudioTrack,
  type IRemoteVideoTrack,
  type IRemoteAudioTrack,
  type VideoEncoderConfigurationPreset,
} from 'agora-rtc-sdk-ng'
import { logger } from '../utils/logger'

export interface RtcServiceConfig {
  appId: string
  client?: IAgoraRTCClient
  encoderConfig?: VideoEncoderConfigurationPreset
  onNetworkQualityChange?: (quality: any) => void
  onUserJoined?: (user: IAgoraRTCRemoteUser) => void
  onUserLeft?: (user: IAgoraRTCRemoteUser, reason: string) => void
  onUserPublished?: (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => void
  onUserUnpublished?: (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => void
  onVolumeIndicator?: (volumes: any[]) => void
  onAudioEnabledChange?: (enabled: boolean) => void
  onVideoEnabledChange?: (enabled: boolean) => void
  onLocalStreamChange?: (stream: MediaStream | null) => void
}

export class RtcService {
  private client: IAgoraRTCClient | null = null
  private appId: string = ''
  private encoderConfig: VideoEncoderConfigurationPreset = '720p'
  private localVideoTrack: ICameraVideoTrack | null = null
  private localAudioTrack: IMicrophoneAudioTrack | null = null
  private localVideoStream: MediaStream | null = null
  private currentCameraDeviceId: string | null = null
  private isAudioEnabled: boolean = true
  private isVideoEnabled: boolean = true
  private isActive: boolean = false
  private autoSubscribe: boolean = true // 是否自动订阅远程用户（单聊等旧流程依赖，默认开启）

  // 回调函数
  private onNetworkQualityChange?: (quality: any) => void
  private onUserJoined?: (user: IAgoraRTCRemoteUser) => void
  private onUserLeft?: (user: IAgoraRTCRemoteUser, reason: string) => void
  private onUserPublished?: (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => void
  private onUserUnpublished?: (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => void
  private onVolumeIndicator?: (volumes: any[]) => void
  private onAudioEnabledChange?: (enabled: boolean) => void
  private onVideoEnabledChange?: (enabled: boolean) => void
  private onLocalStreamChange?: (stream: MediaStream | null) => void

  constructor(config: RtcServiceConfig) {
    this.appId = config.appId
    this.client = config.client || null
    this.encoderConfig = config.encoderConfig || '720p'
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
    appId?: string
  ): Promise<number | string> {
    if (!this.client) {
      throw new Error('RTC client not initialized')
    }

    if (appId) {
      this.setAppId(appId)
    }

    try {
      this.isActive = true
      const numericUid = typeof uid === 'string' ? Number(uid) : uid
      const joinedUid = await this.client.join(this.appId, channelName, token, numericUid)
      logger.rtc('joinChannel', { channelName, uid: joinedUid, appId: this.appId })
      return joinedUid
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

    this.isActive = false

    try {
      if (this.localAudioTrack || this.localVideoTrack) {
        const tracks: any[] = []
        if (this.localAudioTrack) tracks.push(this.localAudioTrack)
        if (this.localVideoTrack) tracks.push(this.localVideoTrack)
        if (tracks.length > 0 && this.client.connectionState === 'CONNECTED') {
          await this.client.unpublish(tracks)
        }
      }

      await this.closeLocalTracks()

      if (this.client.connectionState === 'CONNECTED') {
        await this.client.leave()
      }

      logger.rtc('leaveChannel', {})
    } catch (error) {
      logger.error('Failed to leave channel:', error)
      throw error
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

      const config = this.encoderConfig ? { encoderConfig: this.encoderConfig } : undefined
      const track = await AgoraRTC.createCameraVideoTrack(config)
      if (!this.isActive) {
        track.close()
        throw new Error('RtcService became inactive during video track creation')
      }
      this.localVideoTrack = track
      this.onVideoEnabledChange?.(true)
      this.localVideoStream = new MediaStream([this.localVideoTrack.getMediaStreamTrack()])
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
            const publishedTracks = this.client.localTracks
            const isVideoPublished = publishedTracks.some(track => track.trackMediaType === 'video')
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
        if (!this.localVideoTrack || this.localVideoTrack.getMediaStreamTrack()?.readyState !== 'live') {
          await this.createVideoTrack()
          if (this.client && this.client.connectionState === 'CONNECTED') {
            const publishedTracks = this.client.localTracks
            const isVideoPublished = publishedTracks.some(track => track.trackMediaType === 'video')
            if (!isVideoPublished && this.localVideoTrack) {
              await this.client.publish([this.localVideoTrack])
              logger.info('Video track re-published')
            }
          }
          if (this.localVideoTrack) {
            this.localVideoStream = new MediaStream([this.localVideoTrack.getMediaStreamTrack()])
            this.onLocalStreamChange?.(this.localVideoStream)
            logger.info('Local video stream updated after recreating track')
          }
        } else {
          await this.localVideoTrack.setEnabled(true)
        }
        this.isVideoEnabled = true
        this.onVideoEnabledChange?.(true)
      } else {
        if (this.client && this.client.connectionState === 'CONNECTED' && this.localVideoTrack) {
          try {
            await this.client.unpublish([this.localVideoTrack])
            logger.info('Video track unpublished')
          } catch (unpublishError) {
            logger.warn('Failed to unpublish video track:', unpublishError)
          }
        }

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
   */
  async subscribeRemoteUser(
    userOrUid: IAgoraRTCRemoteUser | number | string,
    mediaType: 'audio' | 'video'
  ): Promise<void> {
    if (!this.client) {
      throw new Error('RTC client not initialized')
    }

    const uid = typeof userOrUid === 'object' ? userOrUid.uid : userOrUid
    const uidStr = uid.toString()
    const remoteUser = this.client.remoteUsers.find(u => u.uid.toString() === uidStr)
    if (!remoteUser) {
      logger.warn('[RtcService] 订阅跳过：远程用户不在列表中', { uid: uidStr, mediaType })
      return
    }

    const hasPublished = mediaType === 'video' ? remoteUser.hasVideo : remoteUser.hasAudio
    if (!hasPublished) {
      logger.warn('[RtcService] 订阅跳过：远程用户未发布指定媒体', { uid: uidStr, mediaType })
      return
    }

    try {
      await this.client.subscribe(userOrUid as any, mediaType)
      const subscribedUser = this.client.remoteUsers.find(u => u.uid.toString() === uidStr)
      if (mediaType === 'audio' && subscribedUser?.audioTrack) {
        subscribedUser.audioTrack.play()
      }
      logger.info('Subscribed to remote user:', { uid: uidStr, mediaType })
    } catch (error: any) {
      const errorMessage = error?.message || String(error)
      if (errorMessage.includes('INVALID_REMOTE_USER') || errorMessage.includes('REMOTE_USER_IS_NOT_PUBLISHED')) {
        logger.warn('[RtcService] 订阅远程用户时遇到预期错误:', { uid: uidStr, mediaType, error: errorMessage })
        return
      }
      logger.error('Failed to subscribe remote user:', error)
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
      logger.info('Unsubscribed remote user:', { uid, mediaType })
    } catch (error) {
      logger.error('Failed to unsubscribe remote user:', error)
      throw error
    }
  }

  /**
   * 获取本地视频流
   */
  getLocalVideoStream(): MediaStream | null {
    if (this.localVideoStream) return this.localVideoStream
    if (this.localVideoTrack) {
      this.localVideoStream = new MediaStream([this.localVideoTrack.getMediaStreamTrack()])
      return this.localVideoStream
    }
    return null
  }

  /**
   * 获取本地视频轨道
   */
  getLocalVideoTrack(): ICameraVideoTrack | null {
    return this.localVideoTrack
  }

  /**
   * 获取本地音频轨道
   */
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
   * 获取远程视频轨道（通过 uid）
   */
  getRemoteVideoTrack(uid: string | number): IRemoteVideoTrack | null {
    if (!this.client) return null
    const uidStr = uid.toString()
    const remoteUser = this.client.remoteUsers.find(u => u.uid.toString() === uidStr)
    return remoteUser?.videoTrack || null
  }

  /**
   * 获取远程音频轨道（通过 uid）
   */
  getRemoteAudioTrack(uid: string | number): IRemoteAudioTrack | null {
    if (!this.client) return null
    const uidStr = uid.toString()
    const remoteUser = this.client.remoteUsers.find(u => u.uid.toString() === uidStr)
    return remoteUser?.audioTrack || null
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

    this.client.on('user-joined', (user: IAgoraRTCRemoteUser) => {
      logger.rtc('userJoined', { uid: user.uid })
      this.onUserJoined?.(user)
    })

    this.client.on('user-left', (user: IAgoraRTCRemoteUser, reason: string) => {
      logger.rtc('userLeft', { uid: user.uid, reason })
      this.onUserLeft?.(user, reason)
    })

    this.client.on('user-published', async (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => {
      logger.rtc('userPublished', { uid: user.uid, mediaType })

      if (this.autoSubscribe) {
        try {
          await this.subscribeRemoteUser(user.uid, mediaType)
          logger.info('自动订阅远程用户成功:', { uid: user.uid, mediaType })
        } catch (error: any) {
          logger.warn('[RtcService] 自动订阅远程用户失败:', { uid: user.uid, mediaType, error: error?.message || String(error) })
        }
      }

      this.onUserPublished?.(user, mediaType)
    })

    this.client.on('user-unpublished', (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => {
      logger.rtc('userUnpublished', { uid: user.uid, mediaType })
      this.onUserUnpublished?.(user, mediaType)
    })

    this.client.on('network-quality', (quality: any) => {
      this.onNetworkQualityChange?.(quality)
    })

    this.client.on('volume-indicator', (volumes: any[]) => {
      this.onVolumeIndicator?.(volumes)
    })
  }

  /**
   * 销毁RTC服务
   */
  async destroy(): Promise<void> {
    try {
      await this.leaveChannel()

      if (this.client) {
        this.client.removeAllListeners()
        this.client = null
      }

      this.isAudioEnabled = true
      this.isVideoEnabled = true
      this.currentCameraDeviceId = null
      logger.rtc('destroy', {})
    } catch (error) {
      logger.error('Failed to destroy RtcService:', error)
    }
  }
}
