/**
 * RtcAdapter — Vue3 层对 @easemob-community/callkit-core 的 RTC 适配器实现
 *
 * 职责：
 * 1. 将 core 的 shouldJoinRtc / shouldPublishTracks / localAudioChanged / localVideoChanged
 *    等指令转换为对 Agora RtcService 的具体操作。
 * 2. 管理本地轨道创建、发布、订阅等生命周期。
 * 3. 不持有业务状态，所有状态通过 getCoreCallState / getCurrentUserId 实时读取。
 */
import type { RtcAdapter } from '@easemob-community/callkit-core'
import { CALL_TYPE } from '@easemob-community/callkit-core'
import { useRtcChannelStore } from '../store/rtcChannel'
import { useCallTimerStore } from '../store/callTimer'
import { useChatClientStore } from '../store/chatClient'
import { logger } from '../utils/logger'

export interface CoreCallStateLike {
  type: CALL_TYPE
  callerUserId: string
  calleeUserId: string
}

export interface CreateRtcAdapterOptions {
  getCoreCallState: () => CoreCallStateLike
  getCurrentUserId: () => string
}

export function createRtcAdapter(options: CreateRtcAdapterOptions): RtcAdapter {
  return {
    joinChannel: async ({ channel, token, uid, appId }) => {
      const rtcChannelStore = useRtcChannelStore()
      const callTimerStore = useCallTimerStore()
      const rtcService = rtcChannelStore.getRtcService()
      if (!rtcService) {
        logger.error('[RtcAdapter] RtcService 未初始化')
        throw new Error('RtcService 未初始化')
      }

      // 预注册 pendingUserId（在 joinChannel 之前，确保 user-joined 事件能正确匹配）
      const coreCallState = options.getCoreCallState()
      const currentUserId = options.getCurrentUserId()
      if (
        coreCallState.callerUserId &&
        coreCallState.callerUserId !== currentUserId
      ) {
        rtcService.addPendingUserId(coreCallState.callerUserId)
        logger.info('[RtcAdapter] 已将主叫方加入 pending 列表:', coreCallState.callerUserId)
      }

      // 1. 加入 RTC 频道
      await rtcService.joinChannel(channel, token, uid as number, appId)
      logger.info('[RtcAdapter] joinChannel 成功', { channel, uid })

      // 2. 自动创建并发布本地轨道
      const tracks: any[] = []

      const audioTrack = await rtcService.createAudioTrack()
      tracks.push(audioTrack)
      logger.rtc('createAudioTrackSuccess', {})

      if (
        coreCallState.type === CALL_TYPE.VIDEO_1V1 ||
        coreCallState.type === CALL_TYPE.VIDEO_MULTI
      ) {
        const videoTrack = await rtcService.createVideoTrack()
        tracks.push(videoTrack)
        logger.rtc('createVideoTrackSuccess', {})
      }

      if (tracks.length > 0) {
        await rtcService.publishTracks(tracks)
        logger.rtc('publishTracksSuccess', {})
      }

      // 3. 更新 store 状态
      rtcChannelStore.setConnected(true)

      // 4. 标记自己已加入 RTC
      if (currentUserId) {
        rtcService.markUserJoinedRtc(currentUserId)
      }

      // 5. 启动通话计时
      callTimerStore.startCallTimer()
      logger.rtc('callTimerStarted', {})
    },

    leaveChannel: async () => {
      const rtcChannelStore = useRtcChannelStore()
      const rtcService = rtcChannelStore.getRtcService()
      if (rtcService) {
        await rtcService.leaveChannel()
      }
    },

    publishLocalTracks: async (types) => {
      const rtcChannelStore = useRtcChannelStore()
      const rtcService = rtcChannelStore.getRtcService()
      if (!rtcService) return
      const tracks: any[] = []
      if (types.includes('audio')) {
        tracks.push(await rtcService.createAudioTrack())
      }
      if (types.includes('video')) {
        tracks.push(await rtcService.createVideoTrack())
      }
      if (tracks.length > 0) {
        await rtcService.publishTracks(tracks)
      }
    },

    unpublishLocalTracks: async (types) => {
      const rtcChannelStore = useRtcChannelStore()
      const rtcService = rtcChannelStore.getRtcService()
      if (!rtcService) return
      const tracks: any[] = []
      if (types.includes('audio')) {
        const t = rtcService.getLocalAudioTrack()
        if (t) tracks.push(t)
      }
      if (types.includes('video')) {
        const t = rtcService.getLocalVideoTrack()
        if (t) tracks.push(t)
      }
      if (tracks.length > 0) {
        await rtcService.unpublishTracks(tracks)
      }
    },

    subscribeRemoteUser: async (userId, mediaType) => {
      const rtcChannelStore = useRtcChannelStore()
      const rtcService = rtcChannelStore.getRtcService()
      if (rtcService) {
        await rtcService.subscribeRemoteUser(userId, mediaType)
      }
    },

    unsubscribeRemoteUser: async (userId, mediaType) => {
      const rtcChannelStore = useRtcChannelStore()
      const rtcService = rtcChannelStore.getRtcService()
      if (rtcService) {
        await rtcService.unsubscribeRemoteUser(userId, mediaType)
      }
    },

    setAudioEnabled: async (enabled) => {
      const rtcChannelStore = useRtcChannelStore()
      const rtcService = rtcChannelStore.getRtcService()
      if (rtcService) {
        await rtcService.toggleAudio(enabled)
      }
    },

    setVideoEnabled: async (enabled) => {
      const rtcChannelStore = useRtcChannelStore()
      const rtcService = rtcChannelStore.getRtcService()
      if (rtcService) {
        await rtcService.toggleVideo(enabled)
      }
    },
  }
}
