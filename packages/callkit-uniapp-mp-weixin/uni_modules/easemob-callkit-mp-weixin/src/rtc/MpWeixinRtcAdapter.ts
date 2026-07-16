import type { RtcAdapter, JoinRtcParams } from './RtcAdapter'
import { useCallState } from '../store/callState'

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

export interface MpWeixinRtcAdapterOptions {
  /**
   * 本地推流 URL 变化回调
   * SDK 通过 update-url 事件返回 live-pusher 的 url
   */
  onLocalStreamUrl?: (url: string) => void
  /**
   * 远端拉流 URL 变化回调
   * SDK 通过 update-url 事件返回 live-player 的 url
   */
  onRemoteStreamUrl?: (url: string, uid: string | number) => void
  /**
   * 远端用户加入/离开回调
   */
  onRemoteUserState?: (uid: string | number, joined: boolean) => void
  /**
   * 通用事件/错误回调
   */
  onEvent?: (type: string, payload?: any) => void
  /**
   * 本地音频/视频开关状态回调
   */
  onLocalMediaState?: (type: 'audio' | 'video', enabled: boolean) => void
}

/**
 * 声网小程序 SDK RTC 适配器
 */
export function createMpWeixinRtcAdapter(options: MpWeixinRtcAdapterOptions = {}): RtcAdapter {
  const SDK = AgoraMiniappSDK as any
  const { state } = useCallState()

  SDK.LOG?.setLogLevel?.(0)

  let client: any = null
  let currentChannel = ''
  let currentUid: string | number = ''
  let localPublished = false
  let joined = false

  const {
    onLocalStreamUrl,
    onRemoteStreamUrl,
    onRemoteUserState,
    onEvent,
    onLocalMediaState
  } = options

  function ensureClient() {
    if (!client) {
      client = new SDK.Client()
      bindClientEvents()
    }
    return client
  }

  function bindClientEvents() {
    if (!client) return

    client.on('stream-added', (evt: any) => {
      console.log('[MpWeixinRtcAdapter] stream-added', evt)
      const uid = evt?.uid
      if (uid != null) {
        client.subscribe(uid, () => {
          console.log('[MpWeixinRtcAdapter] subscribe success', uid)
          onRemoteUserState?.(uid, true)
        }, (err: any) => {
          console.error('[MpWeixinRtcAdapter] subscribe failed', uid, err)
        })
      }
    })

    client.on('stream-removed', (evt: any) => {
      console.log('[MpWeixinRtcAdapter] stream-removed', evt)
      const uid = evt?.uid
      if (uid != null) {
        client.unsubscribe(uid, () => {
          console.log('[MpWeixinRtcAdapter] unsubscribe success', uid)
          onRemoteUserState?.(uid, false)
        }, (err: any) => {
          console.error('[MpWeixinRtcAdapter] unsubscribe failed', uid, err)
        })
      }
    })

    client.on('update-url', (evt: any) => {
      console.log('[MpWeixinRtcAdapter] update-url', evt)
      // evt 中可能同时包含推流 url（pusher）和拉流 url（player）
      if (evt?.url) {
        // 推流 URL：用于 live-pusher
        state.localStreamUrl = evt.url
        onLocalStreamUrl?.(evt.url)
      }
      if (evt?.uid != null && evt?.playUrl) {
        // 拉流 URL：用于 live-player
        state.remoteUserId = String(evt.uid)
        state.remoteStreamUrl = evt.playUrl
        onRemoteStreamUrl?.(evt.playUrl, evt.uid)
      }
    })

    client.on('error', (err: any) => {
      console.error('[MpWeixinRtcAdapter] client error', err)
      onEvent?.('error', err)
    })

    client.on('exception', (evt: any) => {
      console.warn('[MpWeixinRtcAdapter] exception', evt)
      onEvent?.('exception', evt)
    })
  }

  return {
    async joinChannel(params: JoinRtcParams) {
      console.log('[MpWeixinRtcAdapter] joinChannel', params)
      const c = ensureClient()
      currentChannel = params.channel
      currentUid = params.uid

      return new Promise((resolve, reject) => {
        c.init(params.appId, () => {
          console.log('[MpWeixinRtcAdapter] client init success')
          c.setRole('broadcaster')
          c.join(params.token, params.channel, params.uid, () => {
            console.log('[MpWeixinRtcAdapter] join success')
            joined = true
            // 默认自动发布本地音视频
            c.publish(() => {
              console.log('[MpWeixinRtcAdapter] publish success')
              localPublished = true
              resolve()
            }, (err: any) => {
              console.error('[MpWeixinRtcAdapter] publish failed', err)
              reject(err)
            })
          }, (err: any) => {
            console.error('[MpWeixinRtcAdapter] join failed', err)
            reject(err)
          })
        }, (err: any) => {
          console.error('[MpWeixinRtcAdapter] client init failed', err)
          reject(err)
        })
      })
    },

    async leaveChannel() {
      console.log('[MpWeixinRtcAdapter] leaveChannel')
      if (!client) return

      if (localPublished) {
        await new Promise<void>((resolve) => {
          client.unpublish(() => {
            localPublished = false
            resolve()
          }, () => {
            resolve()
          })
        })
      }

      await new Promise<void>((resolve) => {
        client.leave(() => {
          joined = false
          resolve()
        }, () => {
          resolve()
        })
      })

      client = null
      currentChannel = ''
      currentUid = ''
      state.localStreamUrl = ''
      state.remoteStreamUrl = ''
      state.remoteUserId = ''
    },

    async publishLocalTracks(types: ('audio' | 'video')[]) {
      console.log('[MpWeixinRtcAdapter] publishLocalTracks', types)
      if (!client || localPublished) return
      return new Promise((resolve, reject) => {
        client.publish(() => {
          localPublished = true
          resolve()
        }, (err: any) => {
          reject(err)
        })
      })
    },

    async unpublishLocalTracks(types: ('audio' | 'video')[]) {
      console.log('[MpWeixinRtcAdapter] unpublishLocalTracks', types)
      if (!client || !localPublished) return
      return new Promise((resolve) => {
        client.unpublish(() => {
          localPublished = false
          resolve()
        }, () => {
          resolve()
        })
      })
    },

    async subscribeRemoteUser(userId: string, mediaType: 'audio' | 'video') {
      console.log('[MpWeixinRtcAdapter] subscribeRemoteUser', userId, mediaType)
      if (!client) return
      return new Promise((resolve, reject) => {
        client.subscribe(userId, () => {
          resolve()
        }, (err: any) => {
          reject(err)
        })
      })
    },

    async unsubscribeRemoteUser(userId: string, mediaType: 'audio' | 'video') {
      console.log('[MpWeixinRtcAdapter] unsubscribeRemoteUser', userId, mediaType)
      if (!client) return
      return new Promise((resolve) => {
        client.unsubscribe(userId, () => {
          resolve()
        }, () => {
          resolve()
        })
      })
    },

    async setAudioEnabled(enabled: boolean) {
      console.log('[MpWeixinRtcAdapter] setAudioEnabled', enabled)
      if (!client) return
      if (enabled) {
        client.unmuteLocal('audio')
      } else {
        client.muteLocal('audio')
      }
      state.audioEnabled = enabled
      onLocalMediaState?.('audio', enabled)
    },

    async setVideoEnabled(enabled: boolean) {
      console.log('[MpWeixinRtcAdapter] setVideoEnabled', enabled)
      if (!client) return
      if (enabled) {
        client.unmuteLocal('video')
      } else {
        client.muteLocal('video')
      }
      state.videoEnabled = enabled
      onLocalMediaState?.('video', enabled)
    },

    async switchCamera() {
      console.log('[MpWeixinRtcAdapter] switchCamera')
      onEvent?.('switchCamera', {})
    }
  }
}
