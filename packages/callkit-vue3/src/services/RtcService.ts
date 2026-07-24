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

/**
 * 本地媒体输入状态（声网设备枚举 + 轨道活跃度检测）
 * null 表示"未检测/不适用"（例如轨道不存在或已关闭）
 */
export interface MediaInputStatus {
  /** 是否存在摄像头设备 */
  hasCamera: boolean | null
  /** 是否存在麦克风设备 */
  hasMicrophone: boolean | null
  /** 麦克风是否有实际输入（连续多次检测无音量变化才判 false，避免安静环境误报） */
  audioInputActive: boolean | null
  /** 摄像头是否有实际画面输入（连续多次检测无画面变化才判 false，避免静止画面误报） */
  videoInputActive: boolean | null
}

const DEFAULT_MEDIA_INPUT_STATUS: MediaInputStatus = {
  hasCamera: null,
  hasMicrophone: null,
  audioInputActive: null,
  videoInputActive: null,
}

/** 连续无输入检测次数达到该阈值才上报"无输入"（SDK 在安静/静止场景会误报 false） */
const MEDIA_INPUT_INACTIVE_THRESHOLD = 3

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

  // toggle 串行化队列：防止并发开关导致 track 重复创建/泄漏（double-toggle 竞态）
  private audioToggleQueue: Promise<unknown> = Promise.resolve()
  private videoToggleQueue: Promise<unknown> = Promise.resolve()
  // leaveChannel 多入口并发复用同一 Promise（幂等）
  private leaveChannelPromise: Promise<void> | null = null

  // 媒体输入监控（声网设备枚举 + 轨道活跃度检测）
  private mediaInputSubscribers = new Set<(status: MediaInputStatus) => void>()
  private mediaInputTimer: ReturnType<typeof setTimeout> | null = null
  // 监控代际：stop→start 重入时使旧 tick 链失效，防止两条监控链并行
  private mediaInputGeneration = 0
  private mediaInputStatus: MediaInputStatus = { ...DEFAULT_MEDIA_INPUT_STATUS }
  private audioInactiveCount = 0
  private videoInactiveCount = 0

  // 回调函数（构造函数传入的兼容订阅者）
  private onNetworkQualityChange?: (quality: any) => void
  private onUserJoined?: (user: IAgoraRTCRemoteUser) => void
  private onUserLeft?: (user: IAgoraRTCRemoteUser, reason: string) => void
  private onUserPublished?: (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => void
  private onUserUnpublished?: (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => void
  private onVolumeIndicator?: (volumes: any[]) => void

  // 媒体状态订阅者（支持多域独立订阅，避免全局单例状态污染）
  private audioEnabledSubscribers = new Set<(enabled: boolean) => void>()
  private videoEnabledSubscribers = new Set<(enabled: boolean) => void>()
  private localStreamSubscribers = new Set<(stream: MediaStream | null) => void>()

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

    // 将构造函数传入的回调作为首批订阅者，保持向后兼容
    if (config.onAudioEnabledChange) {
      this.audioEnabledSubscribers.add(config.onAudioEnabledChange)
    }
    if (config.onVideoEnabledChange) {
      this.videoEnabledSubscribers.add(config.onVideoEnabledChange)
    }
    if (config.onLocalStreamChange) {
      this.localStreamSubscribers.add(config.onLocalStreamChange)
    }
  }

  // ═════════════════════════════════════════════════
  // 媒体状态订阅 API（阶段 4：支持多域独立订阅，替代全局状态池）
  // ═════════════════════════════════════════════════

  /**
   * 订阅本地音频开关状态变化
   * 返回取消订阅函数
   */
  subscribeAudioEnabledChange(callback: (enabled: boolean) => void): () => void {
    this.audioEnabledSubscribers.add(callback)
    callback(this.isAudioEnabled)
    return () => {
      this.audioEnabledSubscribers.delete(callback)
    }
  }

  /**
   * 订阅本地视频开关状态变化
   * 返回取消订阅函数
   */
  subscribeVideoEnabledChange(callback: (enabled: boolean) => void): () => void {
    this.videoEnabledSubscribers.add(callback)
    callback(this.isVideoEnabled)
    return () => {
      this.videoEnabledSubscribers.delete(callback)
    }
  }

  /**
   * 订阅本地视频流变化
   * 返回取消订阅函数
   */
  subscribeLocalStreamChange(callback: (stream: MediaStream | null) => void): () => void {
    this.localStreamSubscribers.add(callback)
    callback(this.localVideoStream)
    return () => {
      this.localStreamSubscribers.delete(callback)
    }
  }

  private notifyAudioEnabledChange(enabled: boolean): void {
    this.audioEnabledSubscribers.forEach((cb) => cb(enabled))
  }

  private notifyVideoEnabledChange(enabled: boolean): void {
    this.videoEnabledSubscribers.forEach((cb) => cb(enabled))
  }

  private notifyLocalStreamChange(stream: MediaStream | null): void {
    this.localStreamSubscribers.forEach((cb) => cb(stream))
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
   * 离开频道（幂等 + 串行化：多入口并发调用复用同一 Promise，
   * 避免对同一 client 重复 unpublish/leave 被 Agora 抛错）
   */
  async leaveChannel(): Promise<void> {
    if (this.leaveChannelPromise) {
      return this.leaveChannelPromise
    }
    this.leaveChannelPromise = this.doLeaveChannel().finally(() => {
      this.leaveChannelPromise = null
    })
    return this.leaveChannelPromise
  }

  private async doLeaveChannel(): Promise<void> {
    if (!this.client) return

    // 等待在途 toggle 执行完，避免 leave 与排队的 toggle 并发操作 track
    await Promise.allSettled([this.audioToggleQueue, this.videoToggleQueue])

    this.isActive = false
    this.stopMediaInputMonitor()

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
    } finally {
      // 复位媒体开关标志并广播：跨通话不残留
      // （此前不复位导致下一通话监控前提失效、订阅者拿到陈旧值、join 窗口 toggle 被覆盖）
      this.isAudioEnabled = true
      this.isVideoEnabled = true
      this.notifyAudioEnabledChange(true)
      this.notifyVideoEnabledChange(true)
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
      // 建轨后按当前开关标志应用并广播真实值：
      // 1) 标志必须可信（此前只 notify(true) 不置位，跨通话残留导致监控/订阅拿到陈旧值）
      // 2) join 窗口内用户的 toggle（track 未创建时只写标志）不被建轨覆盖
      if (!this.isAudioEnabled) {
        await track.setEnabled(false)
      }
      this.notifyAudioEnabledChange(this.isAudioEnabled)
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
      // 同 createAudioTrack：按当前标志应用并广播真实值
      if (!this.isVideoEnabled) {
        await track.setEnabled(false)
      }
      this.notifyVideoEnabledChange(this.isVideoEnabled)
      this.localVideoStream = new MediaStream([this.localVideoTrack.getMediaStreamTrack()])
      this.notifyLocalStreamChange(this.localVideoStream)
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
   * 切换音频状态（串行化：并发的 toggle 请求排队执行，防止 track 状态竞争）
   */
  async toggleAudio(enabled: boolean): Promise<boolean> {
    const run = this.audioToggleQueue.then(() => this.doToggleAudio(enabled))
    // 队列本身永不 reject，保证后续 toggle 不受前一次失败影响
    this.audioToggleQueue = run.catch(() => {})
    return run
  }

  private async doToggleAudio(enabled: boolean): Promise<boolean> {
    try {
      // 通话已结束（leave 后队列里残留的 toggle）：不再创建/操作 track
      if (!this.isActive) {
        logger.debug('[RtcService] toggleAudio 跳过：RTC 已离开频道')
        return this.isAudioEnabled
      }
      if (!this.localAudioTrack) {
        if (enabled) {
          // 先置标志再建轨：createAudioTrack 内会按 isAudioEnabled 应用 setEnabled，
          // 若标志仍为 false，新建 track 会被置 disabled，publish 抛 TRACK_IS_DISABLED
          this.isAudioEnabled = true
          try {
            await this.createAudioTrack()
          } catch (createError) {
            this.isAudioEnabled = false
            throw createError
          }
          if (this.client && this.client.connectionState === 'CONNECTED') {
            await this.client.publish([this.localAudioTrack!])
          }
        } else {
          logger.debug('[RtcService] toggleAudio 跳过：本地音频轨不存在，重复关闭请求')
        }
        this.isAudioEnabled = enabled
        this.notifyAudioEnabledChange(enabled)
        return enabled
      }

      await this.localAudioTrack.setEnabled(enabled)
      this.isAudioEnabled = enabled
      this.notifyAudioEnabledChange(enabled)
      logger.rtc('toggleAudio', { enabled })
      return enabled
    } catch (error) {
      logger.error('Failed to toggle audio:', error)
      return this.isAudioEnabled
    }
  }

  /**
   * 切换视频状态（串行化：并发的 toggle 请求排队执行，防止 track 重复创建/泄漏）
   */
  async toggleVideo(enabled: boolean): Promise<boolean> {
    const run = this.videoToggleQueue.then(() => this.doToggleVideo(enabled))
    this.videoToggleQueue = run.catch(() => {})
    return run
  }

  private async doToggleVideo(enabled: boolean): Promise<boolean> {
    try {
      // 通话已结束（leave 后队列里残留的 toggle）：不再创建/操作 track
      if (!this.isActive) {
        logger.debug('[RtcService] toggleVideo 跳过：RTC 已离开频道')
        return this.isVideoEnabled
      }
      if (!this.localVideoTrack) {
        if (enabled) {
          // 先置标志再建轨：createVideoTrack 内会按 isVideoEnabled 应用 setEnabled，
          // 若标志仍为 false，新建 track 会被 setEnabled(false)（声网会直接终结底层
          // MediaStreamTrack），随后 publish 抛 TRACK_IS_DISABLED，视频永远无法恢复
          this.isVideoEnabled = true
          try {
            await this.createVideoTrack()
          } catch (createError) {
            this.isVideoEnabled = false
            throw createError
          }
          if (this.client && this.client.connectionState === 'CONNECTED') {
            const publishedTracks = this.client.localTracks
            const isVideoPublished = publishedTracks.some(track => track.trackMediaType === 'video')
            if (!isVideoPublished && this.localVideoTrack) {
              await this.client.publish([this.localVideoTrack])
              logger.info('Video track published')
            }
          }
        } else {
          // 此前该分支静默 return（且在 rtc 日志之前），曾导致"状态源打架"问题完全隐形，必须留日志
          logger.debug('[RtcService] toggleVideo 跳过：本地视频轨已为空，重复关闭请求')
        }
        this.isVideoEnabled = enabled
        this.notifyVideoEnabledChange(enabled)
        return enabled
      }

      if (enabled) {
        if (this.localVideoTrack.getMediaStreamTrack()?.readyState !== 'live') {
          // track 已死（设备掉线/被系统回收）：必须先销毁引用再重建，
          // 否则 createVideoTrack 的缓存早退（if (this.localVideoTrack) return）会原样返回死 track
          try {
            this.localVideoTrack.close()
          } catch (closeError) {
            logger.warn('[RtcService] 关闭死视频轨失败:', closeError)
          }
          this.localVideoTrack = null
          this.localVideoStream = null

          // 同上方开启路径：先置标志再建轨，避免新 track 被按旧标志 setEnabled(false)
          this.isVideoEnabled = true
          try {
            await this.createVideoTrack()
          } catch (createError) {
            this.isVideoEnabled = false
            throw createError
          }
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
            this.notifyLocalStreamChange(this.localVideoStream)
            logger.info('Local video stream updated after recreating track')
          }
        } else {
          await this.localVideoTrack.setEnabled(true)
        }
        this.isVideoEnabled = true
        this.notifyVideoEnabledChange(true)
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
        this.notifyLocalStreamChange(null)
        this.isVideoEnabled = false
        this.notifyVideoEnabledChange(false)
      }

      logger.rtc('toggleVideo', { enabled })
      return this.isVideoEnabled
    } catch (error) {
      logger.error('Failed to toggle video:', error)
      return this.isVideoEnabled
    }
  }

  // ═════════════════════════════════════════════════
  // 媒体输入监控（声网设备枚举 + 轨道活跃度检测）
  // ═════════════════════════════════════════════════

  /**
   * 检测本机是否存在摄像头/麦克风输入设备
   * 结果同步进 mediaInputStatus 并广播
   */
  async checkMediaInputDevices(): Promise<{ hasCamera: boolean; hasMicrophone: boolean }> {
    let hasCamera = false
    let hasMicrophone = false
    try {
      const cameras = await AgoraRTC.getCameras()
      hasCamera = cameras.length > 0
      logger.info('[RtcService] 摄像头设备枚举:', cameras.map((d) => d.label || d.deviceId))
    } catch (error) {
      logger.warn('[RtcService] 枚举摄像头设备失败:', error)
    }
    try {
      const microphones = await AgoraRTC.getMicrophones()
      hasMicrophone = microphones.length > 0
      logger.info('[RtcService] 麦克风设备枚举:', microphones.map((d) => d.label || d.deviceId))
    } catch (error) {
      logger.warn('[RtcService] 枚举麦克风设备失败:', error)
    }
    if (!hasCamera) {
      logger.warn('[RtcService] ⚠️ 未检测到摄像头输入设备')
    }
    if (!hasMicrophone) {
      logger.warn('[RtcService] ⚠️ 未检测到麦克风输入设备')
    }
    this.updateMediaInputStatus({ hasCamera, hasMicrophone })
    return { hasCamera, hasMicrophone }
  }

  /**
   * 订阅本地媒体输入状态变化
   * 返回取消订阅函数
   */
  subscribeMediaInputStatus(callback: (status: MediaInputStatus) => void): () => void {
    this.mediaInputSubscribers.add(callback)
    callback({ ...this.mediaInputStatus })
    return () => {
      this.mediaInputSubscribers.delete(callback)
    }
  }

  /**
   * 启动媒体输入监控：先枚举设备，随后周期性检测本地轨道是否真实有输入
   * 在 joinChannel 成功后调用；重复调用幂等
   */
  startMediaInputMonitor(intervalMs: number = 6000): void {
    if (this.mediaInputTimer) {
      return
    }
    logger.info('[RtcService] 启动媒体输入监控 | interval=', intervalMs)
    const generation = ++this.mediaInputGeneration
    this.checkMediaInputDevices().catch(() => {})

    const tick = async () => {
      // 代际失效（stop 后又有新 start）：本链不再继续，防止两条监控链并行
      if (generation !== this.mediaInputGeneration) return
      await this.runMediaInputCheck()
      if (generation === this.mediaInputGeneration && this.mediaInputTimer !== null) {
        this.mediaInputTimer = setTimeout(tick, intervalMs)
      }
    }
    // 首轮立即执行，后续串行间隔执行（await 完再排下一轮，避免检测重叠）
    this.mediaInputTimer = setTimeout(tick, 0)
  }

  /**
   * 停止媒体输入监控并重置状态（leaveChannel / destroy 时调用）
   */
  stopMediaInputMonitor(): void {
    // 代际递增：使任何在途 tick 醒来后不再排期
    this.mediaInputGeneration++
    if (this.mediaInputTimer) {
      clearTimeout(this.mediaInputTimer)
      this.mediaInputTimer = null
      logger.info('[RtcService] 停止媒体输入监控')
    }
    this.audioInactiveCount = 0
    this.videoInactiveCount = 0
    this.updateMediaInputStatus({ ...DEFAULT_MEDIA_INPUT_STATUS })
  }

  /**
   * 周期性检测本地音视频轨道是否真实有输入
   * 注意：checkAudioTrackIsActive 在安静环境、checkVideoTrackIsActive 在静止画面下
   * 都会返回 false（SDK 限制），因此连续 MEDIA_INPUT_INACTIVE_THRESHOLD 次无输入才上报
   */
  private async runMediaInputCheck(): Promise<void> {
    // ── 音频 ──
    if (this.localAudioTrack && this.isAudioEnabled) {
      try {
        const active = await AgoraRTC.checkAudioTrackIsActive(this.localAudioTrack, 3000)
        this.audioInactiveCount = active ? 0 : this.audioInactiveCount + 1
        if (active) {
          this.updateMediaInputStatus({ audioInputActive: true })
        } else if (this.audioInactiveCount >= MEDIA_INPUT_INACTIVE_THRESHOLD) {
          logger.warn('[RtcService] ⚠️ 麦克风连续多次无输入，请检查设备 | count=', this.audioInactiveCount)
          this.updateMediaInputStatus({ audioInputActive: false })
        }
      } catch (error) {
        logger.warn('[RtcService] 麦克风输入检测失败:', error)
      }
    } else {
      this.audioInactiveCount = 0
      this.updateMediaInputStatus({ audioInputActive: null })
    }

    // ── 视频 ──
    if (this.localVideoTrack && this.isVideoEnabled) {
      try {
        const active = await AgoraRTC.checkVideoTrackIsActive(this.localVideoTrack, 3000)
        this.videoInactiveCount = active ? 0 : this.videoInactiveCount + 1
        if (active) {
          this.updateMediaInputStatus({ videoInputActive: true })
        } else if (this.videoInactiveCount >= MEDIA_INPUT_INACTIVE_THRESHOLD) {
          logger.warn('[RtcService] ⚠️ 摄像头连续多次无画面输入，请检查设备 | count=', this.videoInactiveCount)
          this.updateMediaInputStatus({ videoInputActive: false })
        }
      } catch (error) {
        logger.warn('[RtcService] 摄像头输入检测失败:', error)
      }
    } else {
      this.videoInactiveCount = 0
      this.updateMediaInputStatus({ videoInputActive: null })
    }
  }

  private updateMediaInputStatus(partial: Partial<MediaInputStatus>): void {
    const next: MediaInputStatus = { ...this.mediaInputStatus, ...partial }
    const changed = (Object.keys(next) as (keyof MediaInputStatus)[]).some(
      (key) => next[key] !== this.mediaInputStatus[key]
    )
    if (!changed) return
    this.mediaInputStatus = next
    logger.debug('[RtcService] 媒体输入状态更新:', { ...next })
    this.mediaInputSubscribers.forEach((cb) => cb({ ...next }))
  }

  /**
   * 切换摄像头设备（与 toggle 共用串行队列，避免 setDevice 作用于正在被 close/重建的 track）
   */
  async switchCamera(deviceId: string): Promise<boolean> {
    const run = this.videoToggleQueue.then(() => this.doSwitchCamera(deviceId))
    this.videoToggleQueue = run.catch(() => {})
    return run
  }

  private async doSwitchCamera(deviceId: string): Promise<boolean> {
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
   * 切换麦克风设备（与 toggle 共用串行队列）
   */
  async switchMicrophone(deviceId: string): Promise<boolean> {
    const run = this.audioToggleQueue.then(() => this.doSwitchMicrophone(deviceId))
    this.audioToggleQueue = run.catch(() => {})
    return run
  }

  private async doSwitchMicrophone(deviceId: string): Promise<boolean> {
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

    this.notifyLocalStreamChange(null)
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
    // leaveChannel 失败不得阻断后续清理（监听/订阅者/标志必须复位）
    try {
      await this.leaveChannel()
    } catch (error) {
      logger.error('Failed to leave channel during destroy:', error)
    }

    try {
      if (this.client) {
        this.client.removeAllListeners()
        this.client = null
      }

      this.isAudioEnabled = true
      this.isVideoEnabled = true
      this.currentCameraDeviceId = null
      this.audioEnabledSubscribers.clear()
      this.videoEnabledSubscribers.clear()
      this.localStreamSubscribers.clear()
      this.mediaInputSubscribers.clear()
      logger.rtc('destroy', {})
    } catch (error) {
      logger.error('Failed to destroy RtcService:', error)
    }
  }
}
