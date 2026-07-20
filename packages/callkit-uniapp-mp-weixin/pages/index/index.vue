<template>
  <view class="content">
    <view class="logo-section">
      <text class="h1">Easemob CallKit</text>
      <text class="h2">UniApp 微信小程序</text>
    </view>

    <!-- 登录区 -->
    <view v-if="!isLoggedIn" class="login-card">
      <text class="login-title">环信 IM 登录</text>

      <!-- 登录方式切换 -->
      <view class="login-tabs">
        <view
          class="login-tab"
          :class="{ active: loginMode === 'password' }"
          @click="loginMode = 'password'"
        >
          密码登录
        </view>
        <view
          class="login-tab"
          :class="{ active: loginMode === 'token' }"
          @click="loginMode = 'token'"
        >
          Token 登录
        </view>
      </view>

      <view class="form-item">
        <text class="form-label">App Key</text>
        <input class="form-input" placeholder="请输入 App Key" v-model="appKey" />
      </view>

      <view class="form-item">
        <text class="form-label">用户 ID</text>
        <input class="form-input" placeholder="请输入用户 ID" v-model="userId" />
      </view>

      <view v-if="loginMode === 'password'" class="form-item">
        <text class="form-label">密码</text>
        <input class="form-input" placeholder="请输入密码" v-model="password" password />
      </view>

      <view v-else class="form-item">
        <text class="form-label">Token</text>
        <input class="form-input" placeholder="请输入 accessToken" v-model="token" />
      </view>

      <button class="login-btn" @click="login">登 录</button>
    </view>

    <!-- 呼叫区 -->
    <view v-else class="call-card">
      <text class="current-user">当前用户：{{ currentUserId }}</text>

      <!-- 单聊 -->
      <view class="section">
        <text class="section-title">单聊呼叫</text>
        <input class="form-input" placeholder="输入对方用户 ID" v-model="targetUserId" />
        <view class="btn-group">
          <button class="call-btn audio" @click="startAudioCall">语音呼叫</button>
          <button class="call-btn video" @click="startVideoCall">视频呼叫</button>
        </view>
      </view>

      <!-- 群聊 -->
      <view class="section">
        <text class="section-title">群聊呼叫</text>
        <input class="form-input" placeholder="输入群组 ID" v-model="groupId" />
        <input class="form-input" placeholder="输入成员 ID，用逗号分隔" v-model="groupMembers" />
        <view class="btn-group">
          <button class="call-btn audio" @click="startGroupAudioCall">群语音</button>
          <button class="call-btn video" @click="startGroupVideoCall">群视频</button>
        </view>
      </view>
    </view>

    <view class="footer">
      <text v-if="errorMsg" class="error">{{ errorMsg }}</text>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import SDK from 'easemob-websdk/uniApp/Easemob-chat'
import {
  createIMConnectionAdapter,
  createUniappMpWeixinCallKit
} from '@/uni_modules/easemob-callkit-mp-weixin'
import { getMpWeixinLogger } from '@/uni_modules/easemob-callkit-mp-weixin/src/utils/logger'

const logger = getMpWeixinLogger()

const appKey = ref('easemob#easeim')
const userId = ref('hfp')
const password = ref('1')
const token = ref('')
const loginMode = ref('password')
const targetUserId = ref('')
const groupId = ref('')
const groupMembers = ref('')
const isLoggedIn = ref(false)
const currentUserId = ref('')
const errorMsg = ref('')

/**
 * 示例：给通知条和通话页用的用户资料映射表。
 * 实际项目中可从业务用户系统注入。
 */
const userInfoMap = ref({
  hfp: { nickname: '黄飞鹏', avatarURL: 'https://i.pravatar.cc/150?img=1' },
  pfh: { nickname: '潘飞虎', avatarURL: 'https://i.pravatar.cc/150?img=2' }
})

/**
 * 创建环信 IM connection。
 *
 * 注意：IM SDK 的初始化和 connection 创建属于宿主项目职责，
 * 插件只负责接收已登录的 connection 并包装成 core 需要的形态。
 */
function createDemoIMConnection(appKeyValue) {
  const WebIM = (uni.WebIM = SDK)
  return new WebIM.connection({
    appKey: appKeyValue,
    url: 'wss://im-api-wechat.easemob.com/websocket',
    apiUrl: 'https://a1.easemob.com',
    useOwnUploadFun: true,
    isHttpDNS: false,
    isAutoLogin: false
  })
}

async function login() {
  errorMsg.value = ''

  if (!appKey.value || !userId.value) {
    uni.showToast({ title: '请填写 App Key 和用户 ID', icon: 'none' })
    return
  }

  if (loginMode.value === 'password' && !password.value) {
    uni.showToast({ title: '请输入密码', icon: 'none' })
    return
  }

  if (loginMode.value === 'token' && !token.value) {
    uni.showToast({ title: '请输入 Token', icon: 'none' })
    return
  }

  try {
    // 1. 创建 IM 连接（宿主项目自行负责）
    const conn = createDemoIMConnection(appKey.value)

    // 2. 登录：支持密码和 token 两种方式
    const openParams = {
      user: userId.value
    }
    if (loginMode.value === 'password') {
      openParams.pwd = password.value
    } else {
      openParams.accessToken = token.value
    }
    await conn.open(openParams)

    // 3. 包装成 core 需要的形态
    const imClient = createIMConnectionAdapter(conn)

    // 4. 初始化 CallKit
    const callKit = createUniappMpWeixinCallKit({
      imClient,
      userProfile: {
        userId: userId.value
      },
      // 群成员数据源：群聊通话页"邀请成员"面板通过它拉取候选人
      getGroupMembers: async (groupId) => {
        let memberIds = []
        // 1. 优先从环信群组拉真实成员
        try {
          const res = await conn.listGroupMembers({ groupId, pageNum: 1, pageSize: 100 })
          memberIds = (res?.data || [])
            .map((m) => m.member || m.owner || m.admin)
            .filter(Boolean)
        } catch (e) {
          logger.warn('[demo] listGroupMembers 失败，改用首页输入的成员列表兜底', e)
        }
        // 2. 兜底：群 ID 不是真实环信群组时，合并首页输入列表 + demo 用户池
        if (memberIds.length === 0) {
          const draft = Array.isArray(uni.$lastGroupMembers) ? uni.$lastGroupMembers : []
          memberIds = [...new Set([...draft, ...Object.keys(userInfoMap.value)])]
        }
        return memberIds.map((id) => ({
          userId: id,
          nickname: userInfoMap.value[id]?.nickname,
          avatarURL: userInfoMap.value[id]?.avatarURL
        }))
      }
    })

    // 5. 注入用户资料，供通话页/通知条显示昵称头像
    callKit.setUserInfoMap(userInfoMap.value)

    // 6. 挂到全局供其他页面使用
    uni.$callKit = callKit
    uni.$imClient = imClient

    isLoggedIn.value = true
    currentUserId.value = userId.value
    uni.showToast({ title: '登录成功', icon: 'success' })
  } catch (err) {
    logger.error('[login error]', err)
    errorMsg.value = `登录失败：${err.message || JSON.stringify(err)}`
    uni.showToast({ title: '登录失败', icon: 'none' })
  }
}

function startAudioCall() {
  if (!targetUserId.value) {
    uni.showToast({ title: '请输入对方用户 ID', icon: 'none' })
    return
  }
  uni.navigateTo({
    url: `/uni_modules/easemob-callkit-mp-weixin/pages/single-call-page/single-call-page?targetUserId=${targetUserId.value}&callType=audio`
  })
}

function startVideoCall() {
  if (!targetUserId.value) {
    uni.showToast({ title: '请输入对方用户 ID', icon: 'none' })
    return
  }
  uni.navigateTo({
    url: `/uni_modules/easemob-callkit-mp-weixin/pages/single-call-page/single-call-page?targetUserId=${targetUserId.value}&callType=video`
  })
}

function startGroupAudioCall() {
  if (!groupId.value || !groupMembers.value) {
    uni.showToast({ title: '请输入群组 ID 和成员', icon: 'none' })
    return
  }
  const participantIds = groupMembers.value.split(',').map((s) => s.trim()).filter(Boolean)
  // 记录下来，群聊通话中"邀请成员"面板会用它兜底（群 ID 非真实环信群组时 SDK 拉不到成员）
  uni.$lastGroupMembers = participantIds
  const callKit = uni.$callKit
  callKit
    ?.inviteGroupCall?.({
      groupId: groupId.value,
      participantIds,
      callType: 3, // CALL_TYPE.AUDIO_MULTI
      ext: { groupName: `群聊-${groupId.value}` }
    })
    .catch((err) => {
      logger.error('[startGroupAudioCall error]', err)
      uni.showToast({ title: '群聊呼叫失败', icon: 'none' })
    })
}

function startGroupVideoCall() {
  if (!groupId.value || !groupMembers.value) {
    uni.showToast({ title: '请输入群组 ID 和成员', icon: 'none' })
    return
  }
  const participantIds = groupMembers.value.split(',').map((s) => s.trim()).filter(Boolean)
  uni.$lastGroupMembers = participantIds
  const callKit = uni.$callKit
  callKit
    ?.inviteGroupCall?.({
      groupId: groupId.value,
      participantIds,
      callType: 2, // CALL_TYPE.VIDEO_MULTI
      ext: { groupName: `群聊-${groupId.value}` }
    })
    .catch((err) => {
      logger.error('[startGroupVideoCall error]', err)
      uni.showToast({ title: '群聊呼叫失败', icon: 'none' })
    })
}
</script>

<style>
.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80rpx 48rpx;
  min-height: 100vh;
  box-sizing: border-box;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.logo-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 60rpx;
}

.h1 {
  font-size: 56rpx;
  font-weight: bold;
  color: #fff;
  letter-spacing: 2rpx;
}

.h2 {
  font-size: 28rpx;
  color: rgba(255, 255, 255, 0.8);
  margin-top: 16rpx;
}

.login-card {
  width: 100%;
  background: #fff;
  border-radius: 24rpx;
  padding: 48rpx 40rpx;
  box-shadow: 0 16rpx 48rpx rgba(0, 0, 0, 0.15);
  box-sizing: border-box;
}

.login-title {
  display: block;
  font-size: 40rpx;
  font-weight: 600;
  color: #1a1a1a;
  text-align: center;
  margin-bottom: 40rpx;
}

.login-tabs {
  display: flex;
  background: #f5f7fa;
  border-radius: 16rpx;
  padding: 8rpx;
  margin-bottom: 32rpx;
}

.login-tab {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  font-size: 28rpx;
  color: #666;
  border-radius: 12rpx;
  transition: all 0.2s ease;
}

.login-tab.active {
  background: #fff;
  color: #2979ff;
  font-weight: 600;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.08);
}

.form-item {
  margin-bottom: 28rpx;
}

.form-label {
  display: block;
  font-size: 26rpx;
  color: #666;
  margin-bottom: 12rpx;
}

.form-input {
  width: 100%;
  height: 96rpx;
  border: 2rpx solid #e5e7eb;
  border-radius: 16rpx;
  padding: 0 28rpx;
  box-sizing: border-box;
  font-size: 30rpx;
  color: #1a1a1a;
  background: #fafbfc;
  transition: all 0.2s ease;
}

.form-input:focus {
  border-color: #2979ff;
  background: #fff;
}

.login-btn {
  width: 100%;
  height: 96rpx;
  line-height: 96rpx;
  border-radius: 16rpx;
  font-size: 32rpx;
  font-weight: 600;
  background: linear-gradient(135deg, #2979ff 0%, #1e5eff 100%);
  color: #fff;
  margin-top: 16rpx;
  box-shadow: 0 8rpx 24rpx rgba(41, 121, 255, 0.3);
}

.call-card {
  width: 100%;
  background: #fff;
  border-radius: 24rpx;
  padding: 48rpx 40rpx;
  box-shadow: 0 16rpx 48rpx rgba(0, 0, 0, 0.15);
  box-sizing: border-box;
}

.current-user {
  display: block;
  font-size: 32rpx;
  color: #1a1a1a;
  text-align: center;
  margin-bottom: 32rpx;
  font-weight: 600;
}

.btn-group {
  display: flex;
  gap: 24rpx;
  margin-top: 32rpx;
}

.call-btn {
  flex: 1;
  height: 96rpx;
  line-height: 96rpx;
  border-radius: 16rpx;
  font-size: 30rpx;
  font-weight: 600;
}

.call-btn.audio {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: #fff;
  box-shadow: 0 8rpx 24rpx rgba(16, 185, 129, 0.3);
}

.call-btn.video {
  background: linear-gradient(135deg, #2979ff 0%, #1e5eff 100%);
  color: #fff;
  box-shadow: 0 8rpx 24rpx rgba(41, 121, 255, 0.3);
}

.section {
  margin-bottom: 32rpx;
}

.section-title {
  display: block;
  font-size: 28rpx;
  color: #666;
  margin-bottom: 16rpx;
}

.footer {
  margin-top: auto;
  padding-top: 40rpx;
}

.error {
  color: #ff4d4f;
  font-size: 26rpx;
  text-align: center;
}
</style>
