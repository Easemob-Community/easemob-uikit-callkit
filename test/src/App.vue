<template>
  <div id="app">
    <div class="header">
      <h1>Easemob Chat CallKit Vue3 演示</h1>
      <div class="mode-indicator" :class="importMode">
        <span class="mode-label">测试环境</span>
        <span class="mode-value">{{ importModeText }}</span>
        <span class="mode-desc">{{ importModeDesc }}</span>
      </div>
    </div>

    <!-- 使用Provider包裹应用 - 设置日志级别为 INFO -->
    <EasemobChatCallKitProvider :chat-client="chatClient" :agora-client="agoraClient" :init-config="{ inviteTimeout: 30000, logLevel: LogLevel.INFO }">
      <!-- 通话邀请通知 -->
      <InvitationNotification />
      
      <div class="demo-section">
        <h2>功能演示</h2>

        <!-- 登录表单 -->
        <div class="login-section">
          <h3>登录</h3>
          <div class="login-form">
            <input v-model="loginUserId" placeholder="输入用户ID" class="input-field" />
            <input v-model="loginPassword" type="password" placeholder="输入密码" class="input-field" />
            <div class="button-group">
              <button @click="handleLogin" class="btn login-btn">登录</button>
              <button @click="handleResetState" class="btn reset-btn">重置状态</button>
            </div>
          </div>
        </div>

        <!-- 单人通话演示 -->
        <div class="call-demo">
          <h3>单人通话</h3>
          <input v-model="targetUserId" placeholder="输入目标用户ID" class="input-field" />
          <div class="button-group">
            <button @click="startCall('audio')" class="btn audio-btn">
              语音通话
            </button>
            <button @click="startCall('video')" class="btn video-btn">
              视频通话
            </button>
          </div>

          <!-- 单人通话组件：自动根据 store 状态显示/隐藏，无需 v-if -->
          <EasemobChatSingleCall :target-user="targetUserId" :type="singleCallType"
            @call-started="handleSingleCallStart" @call-ended="handleSingleCallEnd" />
        </div>

        <!-- 群组通话演示 -->
        <div class="call-demo">
          <h3>群组通话</h3>
          <input v-model="groupId" placeholder="输入群组ID" class="input-field" />
          <input v-model="groupMembers" placeholder="输入成员ID（逗号分隔）" class="input-field" />
          <input v-model="groupName" placeholder="群组名称（可选）" class="input-field" />
          <input v-model="groupAvatar" placeholder="群组头像 URL（可选）" class="input-field" />
          <div class="button-group">
            <button @click="startMultiCall('audio')" class="btn audio-btn">
              群组语音
            </button>
            <button @click="startMultiCall('video')" class="btn video-btn">
              群组视频
            </button>
          </div>

          <!-- 群组通话组件：autoShow 默认开启，自动根据 store 状态显示/隐藏，无需 v-if -->
          <EasemobChatMultiCall 
            :group-id="groupId" 
            :group-name="groupName"
            :group-avatar="groupAvatar"
            :type="multiCallType" 
            :current-user-id="chatClient?.user"
          />
        </div>

        <!-- IDB 日志调试 -->
        <div class="event-log-section">
          <h3>🗃️ IDB 日志调试</h3>
          <div class="idb-stats" v-if="idbStats.total > 0">
            <span>总日志: {{ idbStats.total }} 条</span>
            <span>通话数: {{ idbStats.sessions }} 通</span>
            <span>当前 callId: {{ callStateStore.getCallState.callId || '无' }}</span>
          </div>
          <div class="button-group">
            <button @click="handleExportRecentSession" class="btn export-log-btn">📥 预览最近通话</button>
            <button @click="handleExportAllLogs" class="btn export-log-btn">📥 预览全部日志</button>
            <button @click="handleDownloadLogs" class="btn export-log-btn">⬇️ 下载当前通话(JSON)</button>
            <button @click="handleDownloadTextLogs" class="btn export-log-btn">⬇️ 下载全部(.log)</button>
            <button @click="handleRefreshStats" class="btn export-log-btn">🔄 刷新统计</button>
            <button @click="handleClearIDBLogs" class="btn clear-log-btn">🗑️ 清空 IDB</button>
          </div>
          <pre v-if="idbLogContent" class="idb-log-preview">{{ idbLogContent }}</pre>
        </div>

        <!-- 事件日志展示 -->
        <div class="event-log-section" v-if="eventLogs.length > 0">
          <h3>📡 CallKit 事件日志</h3>
          <div class="event-log-list">
            <div v-for="(log, index) in eventLogs" :key="index" class="event-log-item" :class="log.type">
              <span class="event-time">{{ log.time }}</span>
              <span class="event-type">{{ log.type }}</span>
              <span class="event-detail">{{ log.detail }}</span>
            </div>
          </div>
          <button @click="eventLogs = []" class="btn clear-log-btn">清空日志</button>
        </div>

        <div class="status-display" v-if="currentCallInfo">
          <p>{{ currentCallInfo }}</p>
          <button @click="handleEndCall" class="btn end-call-btn">
            结束通话
          </button>
        </div>
      </div>
    </EasemobChatCallKitProvider>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed, onUnmounted } from 'vue'
import SDK from 'easemob-websdk'
import AgoraRTC from 'agora-rtc-sdk-ng'
import { 
  CALL_STATUS, 
  CALL_TYPE, 
  LogLevel,
  Logger,
  useCallKit, 
  useCallKitEvents,
  useCallStateStore,
  EasemobChatCallKitProvider,
  InvitationNotification, 
  EasemobChatSingleCall, 
  EasemobChatMultiCall 
} from 'easemob-chat-callkit-vue3'

// 启用 IndexedDB 日志持久化
Logger.getInstance({ enableIDB: true, idbRetentionDays: 3 })
// 引入模式检测
// @ts-ignore
const importMode = (typeof __CALLKIT_TEST_MODE__ !== 'undefined' ? __CALLKIT_TEST_MODE__ : 'unknown') as string
const importModeText = computed(() => {
  switch (importMode) {
    case 'source':
      return '🛠️ 本地开发模式'
    case 'tgz':
      return '📦 生产环境模式'
    default:
      return '❓ 未知模式'
  }
})
const importModeDesc = computed(() => {
  switch (importMode) {
    case 'source':
      return '直接引用 lib/ 源码，修改即生效'
    case 'tgz':
      return '使用打包后的 npm 包，模拟真实用户场景'
    default:
      return ''
  }
})

// 状态管理
const targetUserId = ref('')
const groupId = ref('')
const groupMembers = ref('')
const groupName = ref('')
const groupAvatar = ref('')
const singleCallType = ref<'audio' | 'video'>('video')
const multiCallType = ref<'audio' | 'video'>('video')
const currentCallInfo = ref('')

// 事件日志
const eventLogs = ref<Array<{ time: string; type: string; detail: string }>>([])
const maxLogs = 20

function pushEventLog(type: string, detail: string) {
  const now = new Date()
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
  eventLogs.value.unshift({ time, type, detail })
  if (eventLogs.value.length > maxLogs) {
    eventLogs.value.pop()
  }
}

// 使用 useCallKitEvents 订阅通话生命周期事件
const { onCallStarted, onCallEnded, onIncomingCall, onCallCanceled, onCallRefused, onCallTimeout, onCallBusy, onStatusChanged } = useCallKitEvents()

const unbindStatusChanged = onStatusChanged((e) => {
  pushEventLog('statusChanged', `${e.from} → ${e.to}`)
})

const unbindIncomingCall = onIncomingCall((e) => {
  const caller = e.callerUserId
  const callType = e.type === CALL_TYPE.VIDEO_1V1 || e.type === CALL_TYPE.VIDEO_MULTI ? '视频' : '语音'
  pushEventLog('incomingCall', `${caller} 发起${callType}通话`)
})

const unbindCallStarted = onCallStarted((e) => {
  pushEventLog('callStarted', `通话接通 isCaller=${e.isCaller} callId=${e.callId}`)
})

const unbindCallEnded = onCallEnded((e) => {
  const durationSec = Math.round(e.duration / 1000)
  pushEventLog('callEnded', `原因: ${e.reason} 时长: ${durationSec}s`)
})

const unbindCallCanceled = onCallCanceled((e) => {
  pushEventLog('callCanceled', e.isRemote ? '对方取消' : '本地取消')
})

const unbindCallRefused = onCallRefused((e) => {
  pushEventLog('callRefused', e.isRemote ? '对方拒绝' : '本地拒绝')
})

const unbindCallTimeout = onCallTimeout(() => {
  pushEventLog('callTimeout', '通话邀请超时')
})

const unbindCallBusy = onCallBusy(() => {
  pushEventLog('callBusy', '对方忙线')
})

onUnmounted(() => {
  unbindStatusChanged()
  unbindIncomingCall()
  unbindCallStarted()
  unbindCallEnded()
  unbindCallCanceled()
  unbindCallRefused()
  unbindCallTimeout()
  unbindCallBusy()
})

// 登录相关状态
const loginUserId = ref('pfh')
const loginPassword = ref('1')

// Agora 客户端实例（外部创建传入，推荐方式）
const agoraClient = AgoraRTC.createClient({ mode: 'live', codec: 'h264' })

// 环信客户端实例
const chatClient = ref()

// 初始化环信客户端
onMounted(() => {
  SDK.logger.disableAll()
  const connection = new SDK.connection({
    appKey: 'easemob-demo#support', // 替换为你的环信 AppKey
    isFixedDeviceId: false
  })
  chatClient.value = connection
})

// 监听通话状态变化，更新提示信息
const callStateStore = useCallStateStore()
watch(
  () => callStateStore.getCallStatus,
  (newStatus) => {
    if (newStatus === CALL_STATUS.IN_CALL) {
      const callType = callStateStore.getCallState.type
      const isAudio = callType === CALL_TYPE.AUDIO_1V1 || callType === CALL_TYPE.AUDIO_MULTI
      const target = callStateStore.getCallState.calleeUserId || ''
      currentCallInfo.value = `${isAudio ? '语音' : '视频'}通话: ${target}`
    } else if (newStatus === CALL_STATUS.IDLE) {
      currentCallInfo.value = ''
    }
  }
)

// 方法
const { call, groupCall, hangup } = useCallKit()

/**
 * 通过环信 SDK fetchUserInfoById 获取当前登录用户的最新昵称和头像
 * 失败时回退：nickname 使用 userId，avatarURL 为空
 */
const fetchCurrentUserInfo = async (): Promise<{ nickname: string; avatarURL: string }> => {
  const client = chatClient.value
  const userId = client?.user || ''
  if (!client || !userId) {
    return { nickname: userId, avatarURL: '' }
  }
  try {
    const response = await client.fetchUserInfoById([userId], ['nickname', 'avatarurl'])
    const data = response?.data || {}
    const info = data[userId]
    return {
      nickname: info?.nickname || userId,
      avatarURL: info?.avatarurl || '',
    }
  } catch (err) {
    console.warn('[App] fetchCurrentUserInfo 失败，使用 userId 回退:', err)
    return { nickname: userId, avatarURL: '' }
  }
}

const startCall = async (type: 'audio' | 'video') => {
  if (!targetUserId.value) {
    alert('请输入目标用户ID')
    return
  }
  if (!chatClient.value) {
    alert('环信客户端未初始化')
    return
  }

  singleCallType.value = type
  currentCallInfo.value = `单人${type === 'audio' ? '语音' : '视频'}通话: ${targetUserId.value}`

  // 每次呼叫前，从环信服务端获取当前用户的最新昵称和头像
  const userInfo = await fetchCurrentUserInfo()

  const params = {
    targetId: targetUserId.value,
    type: type,
    msg: 'Hello, this is a call from Easemob Chat CallKit!',
    userInfo,
  }
  await call(params)
}

const startMultiCall = async (type: 'audio' | 'video') => {
  if (!groupId.value) {
    alert('请输入群组ID')
    return
  }
  if (groupMembers.value.length === 0) {
    alert('请输入至少一个群组成员ID')
    return
  }
  if (!chatClient.value) {
    alert('环信客户端未初始化')
    return
  }

  multiCallType.value = type
  const members = groupMembers.value.split(',').map((id) => id.trim()).filter((id) => id.length > 0)

  // 每次呼叫前，从环信服务端获取当前用户的最新昵称和头像
  const userInfo = await fetchCurrentUserInfo()

  const params = {
    groupId: groupId.value,
    members: members,
    type: type,
    msg: 'Hello, this is a group call from Easemob Chat CallKit!',
    groupName: groupName.value || undefined,
    groupAvatar: groupAvatar.value || undefined,
    userInfo,
  }
  try {
    await groupCall(
      params
    )
    currentCallInfo.value = `群组${type === 'audio' ? '语音' : '视频'}通话: ${groupId.value}`
  } catch (error) {
    console.error('发起群组通话失败:', error)
    alert('发起群组通话失败')
    currentCallInfo.value = ''
  }
}

const handleSingleCallStart = () => {
  // 已由 onCallStarted 事件处理
}

const handleSingleCallEnd = () => {
  currentCallInfo.value = ''
}

// 群组通话回调（如需监听可在此添加）
// const handleMultiCallStart = () => { console.log('群组通话开始') }
// const handleMultiCallEnd = () => { currentCallInfo.value = '' }

// 登录处理函数
const handleLogin = () => {
  if (!loginUserId.value || !loginPassword.value) {
    alert('请输入用户ID和密码')
    return
  }

  if (!chatClient.value) {
    alert('环信客户端未初始化')
    return
  }

  chatClient.value.open({
    user: loginUserId.value,
    pwd: loginPassword.value
  }).then(() => {
    console.log('登录成功')
    alert('登录成功')
  }).catch((error: any) => {
    console.error('登录失败:', error)
    alert(`登录失败: ${error.message || '未知错误'}`)
  })
}

// 重置通话状态
const handleResetState = () => {
  callStateStore.resetCallState()
  currentCallInfo.value = ''
  console.log('通话状态已重置')
  alert('通话状态已重置')
}

// 结束通话处理函数
const handleEndCall = () => {
  console.log('用户主动结束通话')
  hangup()
    .then(() => {
      console.log('通话已结束')
      currentCallInfo.value = ''
      alert('通话已结束')
    })
    .catch((error: any) => {
      console.error('结束通话失败:', error)
      alert('结束通话失败')
    })
}

// IDB 日志调试
const idbLogContent = ref('')
const idbStats = ref({ total: 0, sessions: 0, list: [] as string[] })

const handleRefreshStats = async () => {
  const sessions = await Logger.getInstance().getSessions()
  let total = 0
  for (const s of sessions.slice(0, 10)) {
    const logs = await Logger.getInstance().exportLogsBySession(s)
    total += logs.length
  }
  // 如果超过 10 个 session，额外估算
  if (sessions.length > 10) {
    const all = await Logger.getInstance().exportLogsBySession()
    total = all.length
  }
  idbStats.value = { total, sessions: sessions.length, list: sessions }
  idbLogContent.value = `统计更新完成：共 ${total} 条日志，${sessions.length} 个 session\n${sessions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
}

const handleExportRecentSession = async () => {
  const sessions = await Logger.getInstance().getSessions()
  if (sessions.length === 0) {
    idbLogContent.value = '暂无日志记录'
    return
  }
  const logs = await Logger.getInstance().exportLogsBySession(sessions[0])
  idbLogContent.value = `【最近通话】session: ${sessions[0]}\n共 ${logs.length} 条日志\n\n` + JSON.stringify(logs, null, 2)
}

const handleExportAllLogs = async () => {
  const logs = await Logger.getInstance().exportLogsBySession()
  const sessions = [...new Set(logs.map(l => l.sessionId).filter(Boolean))]
  idbLogContent.value = `【全部日志】共 ${logs.length} 条，涉及 ${sessions.length} 个 session\nsessions: ${sessions.join(', ') || '无'}\n\n` + JSON.stringify(logs, null, 2)
}

/** 获取当前优先下载的 callId：正在进行的通话 > 最近一个 session */
const getTargetCallId = async (): Promise<string | undefined> => {
  const currentCallId = callStateStore.getCallState.callId || Logger.getInstance().getSessionId()
  if (currentCallId) return currentCallId
  const sessions = await Logger.getInstance().getSessions()
  return sessions[0]
}

const handleDownloadLogs = async () => {
  const callId = await getTargetCallId()
  const json = await Logger.getInstance().exportLogsAsJSON(callId)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `callkit-logs-${callId || 'all'}-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
  alert(`已下载 ${callId ? '当前通话' : '全部'} 日志 (JSON)`)
}

const handleDownloadTextLogs = async () => {
  const text = await Logger.getInstance().exportLogsAsText()
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `callkit-logs-all-${Date.now()}.log`
  a.click()
  URL.revokeObjectURL(url)
  alert('已下载全部日志 (.log)')
}

const handleClearIDBLogs = async () => {
  await Logger.getInstance().clearLogs()
  idbStats.value = { total: 0, sessions: 0, list: [] }
  idbLogContent.value = 'IDB 日志已清空'
}
</script>

<style scoped>
#app {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
  font-family: Arial, sans-serif;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 15px;
  margin-bottom: 20px;
}

.header h1 {
  margin: 0;
  font-size: 24px;
}

.mode-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
}

.mode-indicator.source {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.mode-indicator.tgz {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  color: white;
}

.mode-indicator.unknown {
  background: linear-gradient(135deg, #ccc 0%, #999 100%);
  color: #333;
}

.mode-label {
  font-size: 11px;
  opacity: 0.9;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.mode-value {
  font-size: 14px;
  font-weight: 600;
  margin-top: 2px;
}

.mode-desc {
  font-size: 11px;
  opacity: 0.85;
  margin-top: 4px;
  max-width: 220px;
  text-align: center;
  line-height: 1.4;
}

.demo-section {
  margin: 20px 0;
  padding: 20px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background-color: #f9f9f9;
}

.call-demo {
  margin: 20px 0;
  padding: 15px;
  border: 1px solid #ddd;
  border-radius: 8px;
}

.call-demo h3 {
  margin-top: 0;
  color: #333;
}

.controls {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.input-field {
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  width: 200px;
}

.button-group {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.3s;
}

.audio-btn {
  background-color: #007bff;
  color: white;
}

.video-btn {
  background-color: #28a745;
  color: white;
}

.btn:hover:not(:disabled) {
  opacity: 0.8;
}

.login-section {
  margin: 20px 0;
  padding: 15px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background-color: #f0f0f0;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 300px;
}

.login-btn {
  background-color: #6c757d;
  color: white;
}

.reset-btn {
  background-color: #ffc107;
  color: #333;
}

.status-display {
  margin-top: 15px;
  padding: 10px;
  background-color: #e3f2fd;
  border-radius: 4px;
  color: #1976d2;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.end-call-btn {
  background-color: #dc3545;
  color: white;
  padding: 8px 16px;
  align-self: flex-start;
}

.event-log-section {
  margin: 20px 0;
  padding: 15px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background-color: #fafafa;
}

.event-log-section h3 {
  margin-top: 0;
  margin-bottom: 12px;
  font-size: 16px;
  color: #333;
}

.event-log-list {
  max-height: 200px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.event-log-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 13px;
  background-color: #fff;
  border-left: 3px solid #ccc;
}

.event-log-item .event-time {
  color: #999;
  font-size: 12px;
  flex-shrink: 0;
  font-family: monospace;
}

.event-log-item .event-type {
  font-weight: 600;
  flex-shrink: 0;
  min-width: 110px;
}

.event-log-item .event-detail {
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-log-item.callStarted { border-left-color: #28a745; }
.event-log-item.callStarted .event-type { color: #28a745; }
.event-log-item.callEnded { border-left-color: #dc3545; }
.event-log-item.callEnded .event-type { color: #dc3545; }
.event-log-item.incomingCall { border-left-color: #007bff; }
.event-log-item.incomingCall .event-type { color: #007bff; }
.event-log-item.callCanceled { border-left-color: #fd7e14; }
.event-log-item.callCanceled .event-type { color: #fd7e14; }
.event-log-item.callRefused { border-left-color: #6f42c1; }
.event-log-item.callRefused .event-type { color: #6f42c1; }
.event-log-item.callTimeout { border-left-color: #e83e8c; }
.event-log-item.callTimeout .event-type { color: #e83e8c; }
.event-log-item.callBusy { border-left-color: #17a2b8; }
.event-log-item.callBusy .event-type { color: #17a2b8; }
.event-log-item.statusChanged { border-left-color: #6c757d; }
.event-log-item.statusChanged .event-type { color: #6c757d; }

.clear-log-btn {
  background-color: #6c757d;
  color: white;
  padding: 6px 14px;
  font-size: 13px;
}

.export-log-btn {
  background-color: #17a2b8;
  color: white;
  padding: 6px 14px;
  font-size: 13px;
}

.idb-stats {
  display: flex;
  gap: 16px;
  margin-bottom: 10px;
  font-size: 13px;
  color: #555;
}

.idb-stats span {
  background: #e9ecef;
  padding: 4px 10px;
  border-radius: 4px;
}

.idb-log-preview {
  margin-top: 12px;
  max-height: 300px;
  overflow-y: auto;
  background-color: #1e1e1e;
  color: #d4d4d4;
  padding: 12px;
  border-radius: 4px;
  font-size: 12px;
  font-family: 'Courier New', monospace;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>