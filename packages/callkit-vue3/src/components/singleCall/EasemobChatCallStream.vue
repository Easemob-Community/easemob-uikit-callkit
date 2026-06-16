<template>
  <div class="call-stream-container" :class="{ 'is-audio': props.type === 'audio' }">
    <!-- 远程视频 - 全屏背景 -->
    <div class="remote-video-container">
      <!-- 只有视频通话才显示远程视频元素 -->
      <video v-if="props.type === 'video'" ref="remoteVideo" class="remote-video" autoplay></video>
      
      <!-- 占位符：视频通话等待视频流 或 语音通话显示对方信息 -->
      <div v-if="props.type === 'audio' || !hasRemoteVideo" class="remote-placeholder">
        <div class="avatar-placeholder">
          <svg class="user-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M8 8.90816C8 9.63672 8.16477 10.3145 8.4943 10.9414C8.83953 11.5683 9.30245 12.0681 9.88305 12.4409C10.4637 12.8136 11.0992 13 11.7896 13C12.4801 13 13.1156 12.8136 13.6962 12.4409C14.2768 12.0681 14.7319 11.5683 15.0615 10.9414C15.4067 10.3145 15.5793 9.63672 15.5793 8.90816V7.09184C15.5793 6.34633 15.4067 5.66012 15.0615 5.03321C14.7319 4.40631 14.2768 3.91495 13.6962 3.55913C13.1156 3.18638 12.4801 3 11.7896 3C11.0992 3 10.4637 3.18638 9.88305 3.55913C9.30245 3.91495 8.83953 4.40631 8.4943 5.03321C8.16477 5.66012 8 6.34633 8 7.09184V8.90816ZM12 14C13.4313 14 14.7194 14.1986 15.8644 14.5957C16.8286 14.9267 17.6648 15.3901 18.3729 15.9858C18.9605 16.4657 19.4124 16.987 19.7288 17.5496C19.9096 17.8972 20 18.3522 20 18.9149C20 19.4775 19.8117 19.9657 19.435 20.3794C19.0734 20.7931 18.629 21 18.1017 21H5.89831C5.371 21 4.91902 20.7931 4.54237 20.3794C4.18079 19.9657 4 19.4775 4 18.9149C4 18.3522 4.0904 17.8972 4.27119 17.5496C4.58757 16.987 5.03955 16.4657 5.62712 15.9858C6.33522 15.3901 7.17137 14.9267 8.13559 14.5957C9.2806 14.1986 10.5687 14 12 14Z" />
          </svg>
        </div>
        <p class="remote-name">{{ remoteUserName || '对方' }}</p>
        <!-- 只有视频通话才显示"连接中"，语音通话显示通话时长 -->
        <p v-if="props.type === 'video'" class="connecting-text">连接中...</p>
        <p v-else class="call-status-text">语音通话中</p>
      </div>
    </div>

    <!-- 本地视频 - 悬浮小窗 -->
    <div v-if="props.type === 'video'" class="local-video-container">
      <video ref="localVideo" class="local-video" autoplay muted></video>
      <div v-if="!isVideoEnabled" class="local-video-disabled">
        <svg class="camera-off-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 3L21 21M16 16V19C16 19.5523 15.5523 20 15 20H5C4.44772 20 4 19.5523 4 19V9C4 8.44772 4.44772 8 5 8H8M21 15V9L17 13M17 13V7C17 6.44772 16.5523 6 16 6H10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>

    <!-- 通话信息栏 -->
    <CallInfoBar :duration="callDuration" />

    <!-- 控制按钮 -->
    <CallControls 
      :is-muted="isMuted"
      :is-video-enabled="isVideoEnabled"
      :show-video="props.type === 'video'"
      @toggle-mute="toggleMute"
      @toggle-video="toggleVideo"
      @end-call="endCall"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import type { IAgoraRTCRemoteUser } from 'agora-rtc-sdk-ng'
import { useRtcChannelStore } from '../../store/rtcChannel'
import { useCallTimerStore } from '../../store/callTimer'
import { useGlobalCallStore } from '../../store/globalCall'
import { useCallKit } from '../../composables/useCallKit'
import { useCallKitCore } from '../../composables/useCallKitCore'
import { logger } from '../../utils/logger'
import CallInfoBar from './CallInfoBar.vue'
import CallControls from './CallControls.vue'

interface CallStreamProps {
  type: 'audio' | 'video'
}

const props = defineProps<CallStreamProps>()

const emit = defineEmits<{
  ended: []
}>()

// 从 core 获取状态和从 store 获取 RtcService 实例
const { callState: coreCallState } = useCallKitCore()
const rtcChannelStore = useRtcChannelStore()
const callTimerStore = useCallTimerStore()
const globalCallStore = useGlobalCallStore()
const rtcService = computed(() => rtcChannelStore.getRtcService())

const localVideo = ref<HTMLVideoElement>()
const remoteVideo = ref<HTMLVideoElement>()

// 使用 store 状态确保响应式
const isMuted = computed(() => !rtcChannelStore.audioEnabled)
const isVideoEnabled = computed(() => rtcChannelStore.videoEnabled)

// 通话时长（从 store 获取格式化后的字符串）
const callDuration = computed(() => callTimerStore.formattedCallDuration)

// 远程用户信息
const remoteUserName = computed(() => {
  const remoteUserId = coreCallState.calleeUserId || coreCallState.callerUserId
  if (remoteUserId) {
    const userInfo = globalCallStore.getUserInfo(remoteUserId)
    return userInfo.nickname || remoteUserId
  }
  return ''
})

// 是否有远程视频
const hasRemoteVideo = ref(false)
// 重试计数
const retryCount = ref(0)
const MAX_RETRY = 5

// 切换静音
const toggleMute = async () => {
  if (!rtcService.value) {
    logger.warn('切换静音失败: RtcService未初始化')
    return
  }
  
  try {
    // 修复：传入当前状态的反转值（即目标开启/关闭状态）
    const targetState = !rtcChannelStore.audioEnabled
    await rtcService.value.toggleAudio(targetState)
    logger.info(`切换静音状态成功: ${targetState ? '取消静音' : '静音'}`)
  } catch (error) {
    logger.error('切换静音失败:', error)
  }
}

// 切换视频
const toggleVideo = async () => {
  if (!rtcService.value) {
    logger.warn('切换视频失败: RtcService未初始化')
    return
  }
  
  try {
    // 修复：传入当前状态的反转值
    const targetState = !rtcChannelStore.videoEnabled
    await rtcService.value.toggleVideo(targetState)
    logger.info('切换视频状态成功:', targetState)
  } catch (error) {
    logger.error('切换视频失败:', error)
  }
}

// 结束通话
const endCall = async () => {
  try {
    logger.info('用户点击挂断按钮，开始挂断流程')
    
    // 调用 CallService 发送挂断信令并清理资源
    const { hangup } = useCallKit()
    await hangup()
    
    logger.info('挂断流程完成')
  } catch (error) {
    logger.error('挂断失败:', error)
  } finally {
    // 发送 ended 事件通知父组件
    emit('ended')
  }
}

// 设置远程视频播放
const playRemoteVideo = async (userId: string) => {
  if (!rtcService.value || !remoteVideo.value) {
    logger.warn('播放远程视频失败：rtcService或remoteVideo元素不存在')
    return
  }

  // 获取RTC客户端
  const client = rtcService.value.getClient()
  if (!client || !client.remoteUsers || client.remoteUsers.length === 0) {
    logger.warn('播放远程视频失败：未找到远程用户', { userId })
    return
  }

  // 根据 userId 匹配远程用户（支持 1v1 和未来多人）
  const remoteUser = client.remoteUsers.find(
    (u) => u.uid.toString() === userId || u.uid === Number(userId)
  ) || client.remoteUsers[0]
  if (!remoteUser) {
    logger.warn('播放远程视频失败：远程用户列表为空')
    return
  }

  // 使用uid获取远程视频轨道
  const uidStr = remoteUser.uid.toString()
  let remoteVideoTrack = rtcService.value.getRemoteVideoTrack(uidStr)

  // 兜底：若 RtcService 未自动订阅，主动订阅一次
  if (!remoteVideoTrack && retryCount.value === 0) {
    try {
      await rtcService.value.subscribeRemoteUser(remoteUser.uid, 'video')
      logger.info('CallStream 兜底订阅远程视频成功', { uid: remoteUser.uid })
      // 订阅完成后重新获取 track
      remoteVideoTrack = rtcService.value.getRemoteVideoTrack(uidStr)
    } catch (e) {
      logger.warn('CallStream 兜底订阅远程视频失败', e)
    }
  }

  if (remoteVideoTrack) {
    try {
      remoteVideoTrack.play(remoteVideo.value)
      hasRemoteVideo.value = true
      retryCount.value = 0 // 重置重试计数
      logger.info('远程视频开始播放', { userId, uid: remoteUser.uid })
    } catch (error) {
      logger.error('播放远程视频失败', error)
    }
  } else {
    // 有限次数重试
    if (retryCount.value < MAX_RETRY) {
      retryCount.value++
      logger.warn(`播放远程视频失败：未找到远程视频轨道，重试 ${retryCount.value}/${MAX_RETRY}`, { userId, uid: remoteUser.uid })
      setTimeout(() => {
        playRemoteVideo(userId)
      }, 500)
    } else {
      logger.error(`播放远程视频失败：重试${MAX_RETRY}次后仍未找到远程视频轨道`, { userId, uid: remoteUser.uid })
    }
  }
}

// 播放本地视频
const playLocalVideo = () => {
  if (!rtcService.value || !localVideo.value) {
    return
  }
  
  // 如果不是视频通话,不需要播放本地视频
  if (props.type !== 'video') {
    return
  }
  
  // 获取本地视频轨道
  const client = rtcService.value.getClient()
  if (!client) {
    return
  }
  
  // 从 RtcService 获取本地视频流
  const localStream = rtcService.value.getLocalVideoStream()
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0]
    if (videoTrack && videoTrack.readyState === 'live') {
      localVideo.value.srcObject = localStream
      logger.info('本地视频开始播放')
    }
  }
}

// RTC 事件处理器引用（用于组件卸载时解绑）
let userPublishedHandler: ((user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => void) | null = null
let userUnpublishedHandler: ((user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => void) | null = null

onMounted(() => {
  // 不在这里加入频道，因为 callkit-core 已经处理了加入频道的逻辑
  // 这里只需要设置本地视频播放和监听远程用户事件
  logger.info('EasemobChatCallStream mounted, 等待RTC连接就绪')
  
  // 如果RTC已经连接，立即播放本地视频
  if (rtcChannelStore.isConnected) {
    playLocalVideo()
  }
  
  // 监听RTC连接状态变化
  const stopWatch = rtcChannelStore.$subscribe((mutation, state) => {
    if (state.isConnected && !localVideo.value?.srcObject) {
      playLocalVideo()
    }
  })
  
  // 监听 localStream 的变化，当视频轨道重新创建时自动更新播放
  const stopLocalStreamWatch = watch(
    () => rtcChannelStore.localStream,
    (newStream) => {
      if (newStream && localVideo.value && props.type === 'video') {
        const videoTrack = newStream.getVideoTracks()[0]
        if (videoTrack && videoTrack.readyState === 'live') {
          // 检查是否是新的流，避免重复设置
          const currentStream = localVideo.value.srcObject as MediaStream | null
          if (!currentStream || currentStream.id !== newStream.id) {
            localVideo.value.srcObject = newStream
            logger.info('本地视频流更新，重新播放', { streamId: newStream.id })
          }
        }
      } else if (!newStream && localVideo.value) {
        // 视频流被清空，清除播放
        localVideo.value.srcObject = null
        logger.info('本地视频流已清空')
      }
    },
    { immediate: false } // 不立即执行，等待组件挂载后
  )
  
  // 监听RTC事件 - 监听远程用户发布媒体
  if (rtcService.value) {
    const client = rtcService.value.getClient()
    if (client) {
      // RtcService 已经自动订阅了远程用户，这里只需要播放视频
      userPublishedHandler = async (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => {
        logger.info('组件收到远程用户发布媒体:', { uid: user.uid, mediaType })
        
        // 如果是视频，等待订阅完成后播放远程视频
        if (mediaType === 'video') {
          // 延迟一小段时间确保订阅完成
          setTimeout(() => {
            playRemoteVideo(user.uid.toString())
          }, 100)
        }
      }
      
      // 监听远程用户取消发布
      userUnpublishedHandler = (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => {
        if (mediaType === 'video') {
          hasRemoteVideo.value = false
        }
      }

      client.on('user-published', userPublishedHandler)
      client.on('user-unpublished', userUnpublishedHandler)
    }
  }
  
  // 监听窗口展开事件，重新播放远程视频
  const handleWindowExpanded = () => {
    logger.info('收到窗口展开事件，重新播放远程视频')
    // 重置重试计数
    retryCount.value = 0
    // 延迟确保DOM已更新
    setTimeout(() => {
      if (props.type === 'video' && rtcService.value) {
        // 获取远程用户ID并重新播放
        const remoteUserId = coreCallState.calleeUserId || coreCallState.callerUserId
        if (remoteUserId) {
          playRemoteVideo(remoteUserId)
        }
      }
    }, 200)
  }
  
  window.addEventListener('callkit:window-expanded', handleWindowExpanded)
  
  // 组件卸载时清理监听
  onUnmounted(() => {
    if (stopWatch) {
      stopWatch()
    }
    stopLocalStreamWatch()
    window.removeEventListener('callkit:window-expanded', handleWindowExpanded)

    if (rtcService.value && userPublishedHandler && userUnpublishedHandler) {
      const client = rtcService.value.getClient()
      if (client) {
        client.off('user-published', userPublishedHandler)
        client.off('user-unpublished', userUnpublishedHandler)
      }
    }
  })
})

// onUnmounted 时不主动离开频道，由 CallService 统一管理
// 这样避免重复离开频道的操作
onUnmounted(() => {
  // 不调用 stopCallTimer，由 CallService 统一管理
})
</script>

<style scoped src="./styles/EasemobChatCallStream.css"></style>