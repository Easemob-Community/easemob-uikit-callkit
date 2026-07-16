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
  uid: number
  /** 声网 AppID */
  appId: string
  /** 通话类型 */
  callType: 'audio' | 'video'
}

export interface RtcAdapter {
  /** 加入 RTC 频道并发布本地媒体 */
  joinChannel(params: JoinRtcParams): Promise<void>

  /** 离开频道并释放资源 */
  leaveChannel(): Promise<void>

  /** 设置麦克风开关 */
  setAudioEnabled(enabled: boolean): Promise<void>

  /** 设置摄像头开关 */
  setVideoEnabled(enabled: boolean): Promise<void>

  /** 切换前后摄像头（小程序视频通话） */
  switchCamera?(): Promise<void>
}
