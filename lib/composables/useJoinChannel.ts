/**
 * 加入RTC频道组合式API - useJoinChannel
 * 
 * 职责：
 * 1. 封装加入RTC频道的逻辑
 * 2. 在信令确认后触发加入频道操作
 * 3. 处理单聊和群聊的加入逻辑
 */

import type { RtcService } from '../services/RtcService'
import type { IMicrophoneAudioTrack, ICameraVideoTrack } from 'agora-rtc-sdk-ng'
import { useCallStateStore } from '../store/callState'
import { useRtcChannelStore } from '../store/rtcChannel'
import { useSingleCallRtcStore } from '../store/singleCallRtc'
import { useCallTimerStore } from '../store/callTimer'
import { useChatClientStore } from '../store/chatClient'
import { CALL_TYPE } from '../types/callstate.types'
import { logger } from '../utils/logger'
export interface UseJoinChannelReturn {
  joinChannel: () => Promise<void>
  isJoining: boolean
}

/**
 * 加入RTC频道Hook
 */
export function useJoinChannel(): UseJoinChannelReturn {
  const callStateStore = useCallStateStore()
  const rtcChannelStore = useRtcChannelStore()
  const singleCallRtcStore = useSingleCallRtcStore()
  const callTimerStore = useCallTimerStore()
  const chatClientStore = useChatClientStore()
  
  let isJoining = false
  let accessToken: string | null = null
  let agoraAppId: string | null = null
  let agoraUid: number = 0
  let tokenExpireTime: number = 0 // Token 过期时间戳
  const TOKEN_REFRESH_BUFFER = 5 * 60 * 1000 // Token 过期前 5 分钟刷新
  
  /**
   * 获取 RTC AccessToken
   */
  const getAccessToken = async (): Promise<string | null> => {
    try {
      const chatClient = chatClientStore.getChatClient
      if (!chatClient) {
        logger.error('获取Token失败: ChatClient未初始化')
        return null
      }
      
      // 调用环信SDK的getRTCToken方法获取Agora Token
      // 参数 '*' 表示获取通用的RTC Token
      const res = await (chatClient as any).getRTCToken('*')
      
      // 从响应中提取必要信息
      if (!res?.data) {
        logger.error('获取Token失败: 响应数据为空')
        return null
      }
      
      agoraAppId = res.data.appId
      agoraUid = Number(res.data.RTCUId)
      const token = res.data.RTCToken

      // 计算 Token 过期时间（默认 24 小时，取服务端返回或兜底）
      const expireInSeconds = res.data.expireIn || res.data.expire_in || 86400
      tokenExpireTime = Date.now() + expireInSeconds * 1000

      logger.info('成功获取RTC Token', {
        appId: agoraAppId,
        uid: agoraUid,
        expireIn: expireInSeconds,
      })

      return token
    } catch (error: any) {
      logger.error('获取RTC Token失败:', error)
      return null
    }
  }
  
  /**
   * 加入RTC频道
   */
  const joinChannel = async (): Promise<void> => {
    // 从 store 获取 RtcService 实例
    const rtcService = rtcChannelStore.getRtcService()
    if (!rtcService) {
      logger.error('加入频道失败: RtcService未初始化')
      return
    }
    
    if (isJoining) {
      logger.warn('正在加入频道中,请勿重复调用')
      return
    }
    
    // 检查RTC客户端是否已经在连接/已连接状态
    const client = rtcService.getClient()
    if (client) {
      const connectionState = client.connectionState
      if (connectionState === 'CONNECTING' || connectionState === 'CONNECTED') {
        // 检查是否已经在目标频道中
        const currentCallState = callStateStore.getCallState
        if (client.channelName === currentCallState.channel) {
          logger.warn(`RTC客户端已在目标频道${currentCallState.channel}中,无需重复加入`)
          return
        }
        // 如果在其他频道，需要先离开
        logger.warn(`RTC客户端已在其他频道(${client.channelName})中，先离开当前频道`)
        await rtcService.leaveChannel()
      }
    }
    
    // 检查store中的连接状态（仅作为兜底，channel不同时不拦截）
    const currentCallState = callStateStore.getCallState
    if (rtcChannelStore.isConnected && rtcChannelStore.activeChannelId === currentCallState.channel) {
      logger.warn('已经在RTC频道中,无需重复加入')
      return
    }
    
    // 检查 Token 是否有效或即将过期
    const now = Date.now()
    const isTokenExpired = tokenExpireTime > 0 && now >= (tokenExpireTime - TOKEN_REFRESH_BUFFER)
    if (!accessToken || isTokenExpired) {
      if (isTokenExpired) {
        logger.info('Token 即将过期或已过期，重新获取 RTC Token...')
      } else {
        logger.info('Token不存在,开始获取RTC Token...')
      }
      accessToken = await getAccessToken()
      if (!accessToken) {
        logger.error('加入频道失败: 无法获取有效的RTC Token')
        return
      }
    }
    
    try {
      isJoining = true
      const callState = callStateStore.getCallState
      
      if (!callState.channel) {
        logger.error('加入频道失败: 频道名为空')
        return
      }
      
      logger.info('开始加入RTC频道...', { 
        channel: callState.channel,
        type: callState.type,
        hasToken: !!accessToken,
        agoraUid
      })
      
      // 加入频道,使用获取的token和uid，以及动态获取的appId
      const uid = await rtcService.joinChannel(
        callState.channel, 
        accessToken, 
        agoraUid,
        agoraAppId || undefined  // 传入动态获取的 appId
      )
      logger.rtc('joinChannelSuccess', {
        channel: callState.channel,
        uid,
        agoraUid,
        appId: agoraAppId,
      })
      
      // 创建并发布音视频轨道
      const tracks: (IMicrophoneAudioTrack | ICameraVideoTrack)[] = []
      
      // 创建音频轨道
      const audioTrack = await rtcService.createAudioTrack()
      tracks.push(audioTrack)
      logger.rtc('createAudioTrackSuccess', {})
      
      // 如果是视频通话,创建视频轨道
      if (callState.type === CALL_TYPE.VIDEO_1V1 || callState.type === CALL_TYPE.VIDEO_MULTI) {
        const videoTrack = await rtcService.createVideoTrack()
        tracks.push(videoTrack)
        logger.rtc('createVideoTrackSuccess', {})
      }
      
      // 发布轨道
      await rtcService.publishTracks(tracks)
      logger.rtc('publishTracksSuccess', {})
      
      // 更新store状态
      rtcChannelStore.isConnected = true
      rtcChannelStore.setActiveChannel(callState.channel)
      
      // 标记自己已加入RTC（确保 useParticipants 能正确识别当前用户状态）
      const currentUserId = chatClientStore.getChatClient?.user
      if (currentUserId) {
        singleCallRtcStore.markUserJoinedRtc(currentUserId)
      }

      // 🔑 关键修复：被叫方场景下，将主叫方加入 pending 列表
      // 这样当主叫方加入RTC时，RtcService 的 user-joined 事件能正确将 uid 映射到 callerUserId
      if (callState.callerUserId && callState.callerUserId !== currentUserId) {
        singleCallRtcStore.addPendingUserId(callState.callerUserId)
        logger.info('joinChannel: 已将主叫方加入 pending 列表:', callState.callerUserId)
      }

      // 启动通话计时
      callTimerStore.startCallTimer()
      logger.rtc('callTimerStarted', {})
      
    } catch (error) {
      logger.error('加入RTC频道失败:', error)
      throw error
    } finally {
      isJoining = false
    }
  }
  
  return {
    joinChannel,
    isJoining
  }
}
