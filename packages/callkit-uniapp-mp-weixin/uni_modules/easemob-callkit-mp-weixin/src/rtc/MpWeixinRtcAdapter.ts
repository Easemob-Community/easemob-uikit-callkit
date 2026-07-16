import type { RtcAdapter, JoinRtcParams } from './RtcAdapter'

/**
 * 声网小程序 SDK RTC 适配器
 *
 * TODO: 接入 agora-miniapp-sdk，实现 join/leave/publish/unpublish 等能力
 */
export function createMpWeixinRtcAdapter(): RtcAdapter {
  return {
    async joinChannel(params: JoinRtcParams) {
      console.log('[MpWeixinRtcAdapter] joinChannel', params)
      // TODO: createClient + join + publish
    },

    async leaveChannel() {
      console.log('[MpWeixinRtcAdapter] leaveChannel')
      // TODO: unpublish + leave + destroy
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
