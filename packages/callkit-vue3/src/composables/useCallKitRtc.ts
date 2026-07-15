/**
 * useCallKitRtc
 *
 * 平台无关的 RTC 服务容器（模块级单例）。
 *
 * 阶段 4 改造后职责：
 * 1. 只管理 RtcService 实例生命周期（初始化 / 销毁）
 * 2. 提供模块级 onUserLeft 兜底回调注册点
 * 3. 不再保存任何 RTC 媒体状态（localStream / audioEnabled / videoEnabled / isConnected）
 *
 * 媒体状态由各业务领域自行订阅 RtcService 的 subscribe* API 维护：
 * - 单聊域：useCallKitCore
 * - 群聊域：GroupCallShell / useGroupCallViewModel
 */
import type { IAgoraRTCClient, IAgoraRTCRemoteUser } from 'agora-rtc-sdk-ng'
import { RtcService } from '../services/RtcService'
import { useChatClientStore } from '../store/chatClient'
import { logger } from '../utils/logger'

// RtcService 实例保存在模块级变量中，避免响应式污染
let _rtcServiceInstance: RtcService | null = null
// 模块级 onUserLeft 回调（由 useCallKitCore 注册，用于 RTC 兜底挂断）
let _onUserLeftHandler: ((userId: string) => void) | null = null

async function initializeRtcService(agoraAppId: string, agoraClient?: IAgoraRTCClient) {
  if (_rtcServiceInstance) {
    logger.warn('RTC服务已经初始化,无需重复初始化')
    return
  }

  try {
    logger.info('初始化RTC服务...')

    const service = new RtcService({
      appId: agoraAppId,
      client: agoraClient,
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
  }
}

function setOnUserLeftHandler(handler: ((userId: string) => void) | null) {
  _onUserLeftHandler = handler
}

export function useCallKitRtc() {
  return {
    // API
    getRtcService,
    initializeRtcService,
    destroyRtcService,
    setOnUserLeftHandler,
  }
}

function getRtcService(): RtcService | null {
  return _rtcServiceInstance
}
