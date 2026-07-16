import type { RtcAdapter, JoinRtcParams } from './RtcAdapter'

// 声网小程序 SDK 为 UMD 包，vendor 到插件内使用。
// 注意：HBuilderX 从 .ts 文件导入 .js 时去掉扩展名更稳定。
import * as AgoraMiniappSDK from './vendor/agora-miniapp-sdk'

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
