/**
 * useCallKitRtc
 *
 * 平台无关的 RTC 管理组合式函数（模块级单例）。
 * 用于替代 Pinia 的 rtcChannelStore，避免把 RtcService 实例和 RTC 媒体状态
 * 放入全局 Store，从而支持阶段 4 的“领域化”拆分。
 *
 * 注意：当前仍是单聊/群聊共用同一份 RTC 状态，阶段 4 后续会进一步把单聊/群聊
 * 各自的 RTC 状态拆到各自领域。
 */
import { computed, type Ref, reactive, readonly } from 'vue'
import type { IAgoraRTCClient, IAgoraRTCRemoteUser } from 'agora-rtc-sdk-ng'
import { RtcService } from '../services/RtcService'
import { useChatClientStore } from '../store/chatClient'
import { logger } from '../utils/logger'

// RtcService 实例保存在模块级变量中，避免响应式污染
let _rtcServiceInstance: RtcService | null = null
// 模块级 onUserLeft 回调（由 useCallKitCore 注册，用于 RTC 兜底挂断）
let _onUserLeftHandler: ((userId: string) => void) | null = null

interface RtcState {
  isConnected: boolean
  localStream: MediaStream | null
  audioEnabled: boolean
  videoEnabled: boolean
  agoraAppId: string | null
}

const _state = reactive<RtcState>({
  isConnected: false,
  localStream: null,
  audioEnabled: true,
  videoEnabled: true,
  agoraAppId: null,
})

function setConnected(connected: boolean) {
  _state.isConnected = connected
}

function setLocalStream(stream: MediaStream | null) {
  _state.localStream = stream
}

function setAudioEnabled(enabled: boolean) {
  _state.audioEnabled = enabled
}

function setVideoEnabled(enabled: boolean) {
  _state.videoEnabled = enabled
}

async function initializeRtcService(agoraAppId: string, agoraClient?: IAgoraRTCClient) {
  if (_rtcServiceInstance) {
    logger.warn('RTC服务已经初始化,无需重复初始化')
    return
  }

  try {
    logger.info('初始化RTC服务...')
    _state.agoraAppId = agoraAppId

    const service = new RtcService({
      appId: agoraAppId,
      client: agoraClient,
      onAudioEnabledChange: (enabled) => setAudioEnabled(enabled),
      onVideoEnabledChange: (enabled) => setVideoEnabled(enabled),
      onLocalStreamChange: (stream) => setLocalStream(stream),
      onUserLeft: async (user: IAgoraRTCRemoteUser, reason: string) => {
        logger.info('[useCallKitRtc] RTC 用户离开:', user.uid, reason)
        let userId: string = user.uid.toString()
        const chatClient = useChatClientStore().getChatClient
        if (chatClient && typeof chatClient.getUserIdByRTCUIds === 'function') {
          try {
            const res = await (chatClient as any).getUserIdByRTCUIds([user.uid])
            userId = res?.data?.[user.uid] || userId
          } catch (e) {
            logger.debug('[useCallKitRtc] 获取 userId 映射失败，使用 uid', e)
          }
        }
        _onUserLeftHandler?.(userId)
      },
    })
    await service.initialize()
    _rtcServiceInstance = service
    logger.info('RTC服务初始化成功')
  } catch (error) {
    logger.error('RTC服务初始化失败:', error)
    throw error
  }
}

async function destroyRtcService() {
  if (_rtcServiceInstance) {
    logger.info('销毁RTC服务...')
    await _rtcServiceInstance.destroy()
    _rtcServiceInstance = null
    _state.agoraAppId = null
  }
}

function setOnUserLeftHandler(handler: ((userId: string) => void) | null) {
  _onUserLeftHandler = handler
}

function reset() {
  if (_state.localStream) {
    _state.localStream.getTracks().forEach((track) => {
      track.stop()
      logger.debug('本地轨道已停止:', track.kind)
    })
  }

  _state.isConnected = false
  _state.localStream = null
  _state.audioEnabled = true
  _state.videoEnabled = true
}

export function useCallKitRtc() {
  return {
    // 响应式状态（只读，避免组件直接写入）
    isConnected: readonly(computed(() => _state.isConnected)) as Readonly<Ref<boolean>>,
    localStream: readonly(computed(() => _state.localStream)) as Readonly<Ref<MediaStream | null>>,
    audioEnabled: readonly(computed(() => _state.audioEnabled)) as Readonly<Ref<boolean>>,
    videoEnabled: readonly(computed(() => _state.videoEnabled)) as Readonly<Ref<boolean>>,
    agoraAppId: readonly(computed(() => _state.agoraAppId)) as Readonly<Ref<string | null>>,

    // API
    getRtcService,
    initializeRtcService,
    destroyRtcService,
    setConnected,
    setLocalStream,
    setAudioEnabled,
    setVideoEnabled,
    setOnUserLeftHandler,
    reset,
  }
}

function getRtcService(): RtcService | null {
  return _rtcServiceInstance
}
