<template>
  <view class="content">
    <view class="logo-section">
      <text class="h1">Easemob CallKit</text>
      <text class="h2">UniApp 微信小程序</text>
    </view>

    <!-- 登录区 -->
    <view v-if="!isLoggedIn" class="form-section">
      <text class="section-title">环信 IM 登录</text>
      <input class="input" placeholder="App Key" v-model="appKey" />
      <input class="input" placeholder="用户 ID" v-model="userId" />
      <input class="input" placeholder="密码" v-model="token" password />
      <button class="btn primary" @click="login">登录</button>
    </view>

    <!-- 呼叫区 -->
    <view v-else class="form-section">
      <text class="section-title">当前用户：{{ currentUserId }}</text>
      <input class="input" placeholder="输入对方用户 ID" v-model="targetUserId" />
      <view class="btn-group">
        <button class="btn primary" @click="startAudioCall">语音呼叫</button>
        <button class="btn primary" @click="startVideoCall">视频呼叫</button>
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

const appKey = ref('easemob-demo#support')
const userId = ref('hfp')
const token = ref('1')
const targetUserId = ref('')
const isLoggedIn = ref(false)
const currentUserId = ref('')
const errorMsg = ref('')

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

  if (!appKey.value || !userId.value || !token.value) {
    uni.showToast({ title: '请填写完整登录信息', icon: 'none' })
    return
  }

  try {
    // 1. 创建 IM 连接（宿主项目自行负责）
    const conn = createDemoIMConnection(appKey.value)

    // 2. 登录
    await conn.open({
      user: userId.value,
      pwd: token.value
    })

    // 3. 包装成 core 需要的形态
    const imClient = createIMConnectionAdapter(conn)

    // 4. 初始化 CallKit
    const callKit = createUniappMpWeixinCallKit({
      imClient,
      userProfile: {
        userId: userId.value
      }
    })

    // 5. 挂到全局供其他页面使用
    uni.$callKit = callKit
    uni.$imClient = imClient

    isLoggedIn.value = true
    currentUserId.value = userId.value
    uni.showToast({ title: '登录成功', icon: 'success' })
  } catch (err) {
    console.error('[login error]', err)
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
</script>

<style>
.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80rpx 60rpx;
}
.logo-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 60rpx;
}
.h1 {
  font-size: 48rpx;
  font-weight: bold;
  color: #333;
}
.h2 {
  font-size: 28rpx;
  color: #666;
  margin-top: 12rpx;
}
.form-section {
  width: 100%;
}
.section-title {
  font-size: 32rpx;
  color: #333;
  margin-bottom: 24rpx;
  display: block;
}
.input {
  width: 100%;
  height: 88rpx;
  border: 1rpx solid #ddd;
  border-radius: 12rpx;
  padding: 0 24rpx;
  box-sizing: border-box;
  margin-bottom: 24rpx;
}
.btn-group {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}
.btn {
  width: 100%;
  height: 88rpx;
  line-height: 88rpx;
  border-radius: 12rpx;
  font-size: 32rpx;
}
.btn.primary {
  background-color: #2979ff;
  color: #fff;
}
.footer {
  margin-top: auto;
  padding-top: 40rpx;
}
.error {
  color: #ff4d4f;
  font-size: 24rpx;
}
</style>
