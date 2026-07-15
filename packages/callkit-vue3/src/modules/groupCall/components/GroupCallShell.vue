<template>
  <div ref="shellRef" class="gcall-shell" :class="{ 'is-dragging': isDragging }" :style="shellStyle">
    <!-- Header（拖拽触发区） -->
    <div class="gcall-header" :class="{ hidden: isClearScreen }" @mousedown="startDrag">
      <div class="gcall-header-left">
        <span class="gcall-title">{{ groupName || '群组通话' }}</span>
        <span class="gcall-duration">{{ formattedDuration }}</span>
      </div>
      <div class="gcall-header-right">
        <button class="gcall-header-btn" title="添加成员" @click="showAddMember = true">
          <CallKitIcon name="person-add-fill" :width="20" :height="20" />
        </button>
      </div>
    </div>

    <!-- Video Grid / Content -->
    <div class="gcall-content" @click="handleClearScreen">
      <VideoGrid
        :participants="participants"
        :selected-id="selectedParticipantId"
        @select="handleSelectParticipant"
      />

      <!-- 清屏提示 -->
      <div class="gcall-clear-hint" :class="{ show: isClearScreen }">
        点击画面恢复 controls
      </div>
    </div>

    <!-- Controls -->
    <div class="gcall-controls" :class="{ hidden: isClearScreen }">
      <!-- 静音 -->
      <div class="gcall-control-group">
        <button
          class="gcall-control-btn"
          :class="{ active: localParticipant?.isMuted }"
          @click="toggleMute"
        >
          <CallKitIcon
            :name="localParticipant?.isMuted ? 'mic-slash' : 'mic-on'"
            :width="20"
            :height="20"
          />
        </button>
        <span class="gcall-control-label">
          {{ localParticipant?.isMuted ? '取消静音' : '静音' }}
        </span>
      </div>

      <!-- 摄像头 -->
      <div class="gcall-control-group">
        <button
          class="gcall-control-btn"
          :class="{ 'disabled-state': !localParticipant?.isCameraOn }"
          @click="toggleCamera"
        >
          <CallKitIcon
            :name="localParticipant?.isCameraOn ? 'video-camera' : 'video-camera-xmark'"
            :width="20"
            :height="20"
          />
        </button>
        <span class="gcall-control-label">
          {{ localParticipant?.isCameraOn ? '关闭摄像头' : '开启摄像头' }}
        </span>
      </div>

      <!-- 挂断 -->
      <div class="gcall-control-group">
        <button class="gcall-control-btn hangup" @click="handleHangup">
          <CallKitIcon name="phone-hang" :width="20" :height="20" />
        </button>
        <span class="gcall-control-label">挂断</span>
      </div>
    </div>

    <!-- Add Member Modal -->
    <EasemobChatGroupMemberList
      v-if="showAddMember"
      :group-id="groupId"
      :members="groupMembers"
      :existing-user-ids="existingUserIds"
      :inviting-user-ids="invitingUserIds"
      @close="showAddMember = false"
      @invite="handleInviteMembers"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import VideoGrid from './VideoGrid.vue'
import CallKitIcon from './CallKitIcon.vue'
import EasemobChatGroupMemberList from '../../../components/multiCall/EasemobChatGroupMemberList.vue'
import { useGroupCallViewModel } from '../viewModel/useGroupCallViewModel'
import { useCallKitRtc } from '../../../composables/useCallKitRtc'
import { useDraggable } from '../../../composables/useDraggable'
import type { RtcService } from '../../../services/RtcService'
import { logger } from '../../../utils/logger'

export interface GroupCallShellProps {
  groupId: string
  groupName?: string
  currentUserId: string
  currentNickname?: string
  currentAvatarUrl?: string
  rtcService?: RtcService | null
  groupMembers?: Array<{ userId: string; userName: string; avatar?: string }>
}

const props = defineProps<GroupCallShellProps>()
const emit = defineEmits<{
  hangup: []
  addParticipant: []
}>()

const vm = useGroupCallViewModel()
const rtc = useCallKitRtc()
const showAddMember = ref(false)
const isClearScreen = ref(false)

/* ========== 拖拽 + 居中定位 ========== */
const SHELL_WIDTH = 800
const SHELL_HEIGHT = 600
const {
  elementRef: shellRef,
  isDragging,
  hasDragged,
  style: draggableStyle,
  startDrag,
} = useDraggable({
  centered: true,
  width: SHELL_WIDTH,
  height: SHELL_HEIGHT,
  boundary: true,
  boundaryPadding: 10,
})

const shellStyle = computed(() => {
  return {
    ...(draggableStyle.value as Record<string, any>),
    width: `${SHELL_WIDTH}px`,
    height: `${SHELL_HEIGHT}px`,
    maxWidth: '90vw',
    maxHeight: '90vh',
    zIndex: 1000,
  }
})

// 防御性取值：确保 participants 始终是纯数组（避免 Pinia computed 解包不一致导致传入 ComputedRef）
const participants = computed(() => {
  const val = vm.participants.value
  return Array.isArray(val) ? val : []
})
const localParticipant = computed(() => vm.localParticipant.value)
const selectedParticipantId = computed(() => vm.selectedParticipantId.value)

const existingUserIds = computed(() => participants.value.map((p) => p.userId))
const invitingUserIds = computed(() =>
  participants.value.filter((p) => p.state === 'invited').map((p) => p.userId)
)

/* ========== 本地通话计时器（自管，不依赖 ViewModel） ========== */
const callStartTime = ref<number>(0)
const timerTick = ref(0)
let _durationTimer: ReturnType<typeof setInterval> | null = null

function startDurationTimer() {
  if (_durationTimer) clearInterval(_durationTimer)
  callStartTime.value = Date.now()
  timerTick.value = 0
  _durationTimer = setInterval(() => {
    timerTick.value++
  }, 1000)
}

function stopDurationTimer() {
  if (_durationTimer) {
    clearInterval(_durationTimer)
    _durationTimer = null
  }
  callStartTime.value = 0
  timerTick.value = 0
}

const formattedDuration = computed(() => {
  timerTick.value // 强制依赖，让 computed 每秒刷新
  if (!callStartTime.value) return '00:00'
  const total = Math.floor((Date.now() - callStartTime.value) / 1000)
  const m = Math.floor(total / 60)
    .toString()
    .padStart(2, '0')
  const s = (total % 60).toString().padStart(2, '0')
  return `${m}:${s}`
})

// 清屏：点击 content 区域切换
function handleClearScreen() {
  isClearScreen.value = !isClearScreen.value
}

// 选择参与者（进入主视频模式）
function handleSelectParticipant(userId: string | null) {
  vm.selectParticipant(userId)
}

// 暴露给父组件的初始化方法
defineExpose({
  startSession: (payload: {
    sessionId: string
    callType: 'video' | 'audio'
  }) => {
    vm.startSession({
      sessionId: payload.sessionId,
      groupId: props.groupId,
      callType: payload.callType,
      localUserId: props.currentUserId,
      localNickname: props.currentNickname || props.currentUserId,
      localAvatarUrl: props.currentAvatarUrl,
    })
    startDurationTimer()
  },

  addRemoteParticipant: vm.addRemoteParticipant,
  markRemoteAccepted: vm.markRemoteAccepted,
  bindRtcService: vm.bindRtcService,
  unbindRtcService: vm.unbindRtcService,
  sendInvite: vm.sendInvite,
})

// 监听 RTC Service 绑定
watch(
  () => props.rtcService,
  (svc) => {
    if (svc) {
      vm.bindRtcService(svc)
      // RtcService 传入后，如果 localStream 已存在，补同步本地 videoTrack
      const localTrack = svc.getLocalVideoTrack?.()
      if (localTrack && rtc.localStream.value) {
        vm.setLocalVideoTrack(localTrack)
      }
    } else {
      vm.unbindRtcService()
    }
  },
  { immediate: true }
)

// 同步本地视频流
watch(
  () => rtc.localStream.value,
  (stream) => {
    if (stream) {
      logger.info('[GroupCallShell] 检测到本地视频流更新')
      vm.setLocalStream(stream)
      // 同步本地 videoTrack 到 store，让 ParticipantTile 可用 Agora track.play() 播放
      const localTrack = props.rtcService?.getLocalVideoTrack?.()
      if (localTrack) {
        vm.setLocalVideoTrack(localTrack)
      }
    }
  },
  { immediate: true }
)

async function toggleMute() {
  if (!props.rtcService) return
  const target = !localParticipant.value?.isMuted
  try {
    const actual = await props.rtcService.toggleAudio(!target)
    vm.setLocalMute(!actual)
  } catch (e) {
    logger.error('[GroupCallShell] 切换静音失败', e)
  }
}

async function toggleCamera() {
  if (!props.rtcService) return
  const target = !localParticipant.value?.isCameraOn
  try {
    const actual = await props.rtcService.toggleVideo(target)
    vm.setLocalCamera(actual)
  } catch (e) {
    logger.error('[GroupCallShell] 切换摄像头失败', e)
  }
}

async function handleHangup() {
  await vm.hangup()
  stopDurationTimer()
  emit('hangup')
}

// 组件卸载时清理计时器与 RTC 绑定，避免内存泄漏与重复监听
onUnmounted(() => {
  stopDurationTimer()
  vm.unbindRtcService()
})

async function handleInviteMembers(userIds: string[]) {
  try {
    const message = '邀请你加入音视频通话'
    await vm.sendInvite(userIds, props.groupId, message)
    showAddMember.value = false
  } catch (error) {
    logger.error('[GroupCallShell] 邀请成员失败', error)
  }
}
</script>

<style scoped src="./GroupCallShell.css"></style>
