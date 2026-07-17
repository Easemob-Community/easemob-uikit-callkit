/**
 * RTC 适配器抽象接口
 *
 * 注意：这是平台无关的接口定义。
 * 当前由 MpWeixinRtcAdapter 实现，未来 App 包可直接复用此接口。
 */

export type MediaType = 'audio' | 'video'

export interface JoinRtcParams {
  /** RTC 频道名 */
  channel: string
  /** RTC Token */
  token: string
  /** RTC UID */
  uid: number | string
  /** 声网 AppID */
  appId?: string
  /** 通话类型（小程序实现可据此配置 live-pusher） */
  callType?: 'audio' | 'video'
  /** 群聊时已知的参与者列表，用于提前注册 uid → userId 映射 */
  knownParticipants?: Array<{ uid: number | string; userId: string }>
}

export interface RtcAdapter {
  /** 加入 RTC 频道并发布本地媒体 */
  joinChannel(params: JoinRtcParams): Promise<void>

  /** 离开频道并释放资源 */
  leaveChannel(): Promise<void>

  /** 创建并发布本地轨道 */
  publishLocalTracks(types: ('audio' | 'video')[]): Promise<void>

  /** 取消发布本地轨道 */
  unpublishLocalTracks(types: ('audio' | 'video')[]): Promise<void>

  /** 订阅远程用户 */
  subscribeRemoteUser(userId: string, mediaType: 'audio' | 'video'): Promise<void>

  /** 取消订阅远程用户 */
  unsubscribeRemoteUser(userId: string, mediaType: 'audio' | 'video'): Promise<void>

  /** 设置麦克风开关 */
  setAudioEnabled(enabled: boolean): Promise<void>

  /** 设置摄像头开关 */
  setVideoEnabled(enabled: boolean): Promise<void>

  /** 切换前后摄像头（小程序视频通话） */
  switchCamera?(): Promise<void>
}
