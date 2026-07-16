import type { RtcAdapter, JoinRtcParams } from './RtcAdapter'

/**
 * 声网小程序 SDK 为 UMD 包，vendor 到插件内使用。
 *
 * 注意：
 * 1. HBuilderX 对 ES module 方式导入本地 .js UMD 包支持不佳，使用 require 更稳定。
 * 2. require 的相对路径必须指向插件 static/ 目录，因为 HBuilderX 只会把 static/
 *    下的文件原样复制到小程序输出包；放在 src/vendor/ 下仅被动态 require 引用时
 *    不会被复制到输出目录，导致运行时"module is not defined"。
 */
declare const require: (path: string) => any
const AgoraMiniappSDK = require('../../static/agora-miniapp-sdk.js')

/**
 * 声网小程序 SDK RTC 适配器
 *
 * TODO: 接入 agora-miniapp-sdk，实现 join/leave/publish/unpublish 等能力
 */
export function createMpWeixinRtcAdapter(): RtcAdapter {
  const SDK = AgoraMiniappSDK as any

  // 设置日志级别（开发期可设为 0 查看详细日志）
  SDK.LOG?.setLogLevel?.(0)

  let client: any = null

  return {
    async joinChannel(params: JoinRtcParams) {
      console.log('[MpWeixinRtcAdapter] joinChannel', params)

      // TODO: 实现声网小程序 SDK 的加入频道逻辑
      // 1. createClient({ mode: 'live', codec: 'h264' })
      // 2. client.join(appId, channel, token, uid)
      // 3. 创建 live-pusher url 并发布

      client = null
    },

    async leaveChannel() {
      console.log('[MpWeixinRtcAdapter] leaveChannel')
      if (!client) return

      // TODO: unpublish + leave + destroy
      client = null
    },

    async publishLocalTracks(types: ('audio' | 'video')[]) {
      console.log('[MpWeixinRtcAdapter] publishLocalTracks', types)
      // TODO: 发布本地音频/视频轨道
    },

    async unpublishLocalTracks(types: ('audio' | 'video')[]) {
      console.log('[MpWeixinRtcAdapter] unpublishLocalTracks', types)
      // TODO: 取消发布本地音频/视频轨道
    },

    async subscribeRemoteUser(userId: string, mediaType: 'audio' | 'video') {
      console.log('[MpWeixinRtcAdapter] subscribeRemoteUser', userId, mediaType)
      // TODO: 订阅远端用户音频/视频
    },

    async unsubscribeRemoteUser(userId: string, mediaType: 'audio' | 'video') {
      console.log('[MpWeixinRtcAdapter] unsubscribeRemoteUser', userId, mediaType)
      // TODO: 取消订阅远端用户音频/视频
    },

    async setAudioEnabled(enabled: boolean) {
      console.log('[MpWeixinRtcAdapter] setAudioEnabled', enabled)
      // TODO: 控制 live-pusher enable-mic
    },

    async setVideoEnabled(enabled: boolean) {
      console.log('[MpWeixinRtcAdapter] setVideoEnabled', enabled)
      // TODO: 控制 live-pusher enable-camera
    },

    async switchCamera() {
      console.log('[MpWeixinRtcAdapter] switchCamera')
      // TODO: live-pusher switchCamera
    }
  }
}
