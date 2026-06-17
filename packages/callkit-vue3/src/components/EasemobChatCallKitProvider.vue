<template>
  <div class="easemob-callkit-provider">
    <slot v-if="mounted"></slot>
  </div>
</template>

<script setup lang="ts">
import { watch, computed, onUnmounted, ref, onMounted } from 'vue'
import type { ProviderConfig } from '../types'
import { useCallKitCore } from '../composables/useCallKitCore';
import { useChatClientStore } from '../store/chatClient';
import { useRtcChannelStore } from '../store/rtcChannel';
import { logger, LogLevel, Logger } from '../utils/logger';
import { RingtoneService } from '../utils/ringtone';
import { registerUserInfoProvider, registerGroupInfoProvider, clearProfileProviders, type UserInfoProvider } from '../services/UserProfileService';
import { fetchUserInfoById } from '../utils/imSdkAdapter';
import { VERSION as CORE_VERSION } from '@easemob-community/callkit-core';

// 确保组件挂载完成后再渲染插槽
const mounted = ref(false)

// 定义默认的 initConfig 对象
const defaultInitConfig = {
  debug: false,
  enableRingtone: true,
  resizable: true,
  draggable: true,
  inviteTimeout: 30000,
};

const props = defineProps<ProviderConfig>();

// 接收外部传入的环信实例
const chatClientStore = useChatClientStore();
watch(() => props.chatClient, (client) => {
  if (client) {
    logger.info('CallKit Provider 接收到环信客户端实例');
    chatClientStore.setClient(client);
  } else {
    logger.warn('CallKit Provider 未接收到环信客户端实例');
  }
}, { immediate: true });

// 合并默认配置和用户配置（响应式）
const effectiveInitConfig = computed(() => ({
  ...defaultInitConfig,
  ...props.initConfig,
}));

// 创建全局 store 实例
const rtcChannelStore = useRtcChannelStore();

// 使用 callkit-core 的 useCallKitCore 作为统一事件消费层
const { init: initCallKitCore, destroy: destroyCallKitCore } = useCallKitCore();

// 初始化状态锁，防止竞态重复初始化
let rtcInitializing = false
let coreInitializing = false
let rtcInitialized = false
let coreInitialized = false

// 先设置日志级别（必须在 RTC 初始化之前）
function applyLoggerConfig() {
  const config = effectiveInitConfig.value
  // 设置日志级别（logLevel 优先级高于 debug）
  if (config.logLevel !== undefined) {
    logger.setLevel(config.logLevel);
  } else {
    logger.setDebug(config.debug);
  }

  // 初始化 IndexedDB 日志存储（默认开启，不受控制台日志级别影响）
  if (config.enableIDBLog !== false) {
    try {
      Logger.getInstance({ enableIDB: true, idbLevel: LogLevel.VERBOSE, idbMaxSizeMB: 20 })
      logger.info(
        '[EasemobChatCallKit] IndexedDB 日志存储已启用（上限 20MB，callId 维度，VERBOSE 级别）'
      )
    } catch (err) {
      logger.warn(
        '[EasemobChatCallKit] IndexedDB 日志存储初始化失败',
        err
      )
    }
  } else {
    logger.info(
      '[EasemobChatCallKit] IndexedDB 日志存储已禁用（enableIDBLog=false）'
    )
  }

  // 初始化铃声服务（当前为桩函数，不实际播放音频）
  RingtoneService.getInstance().setEnabled(config.enableRingtone ?? true)
  logger.debug(`铃声服务已初始化: enabled=${config.enableRingtone ?? true}（桩函数占位）`)

  logger.info(`CallKit Provider 初始化完成，配置: debug=${config.debug}, logLevel=${config.logLevel ?? 'auto'}, enableRingtone=${config.enableRingtone}`);
  logger.debug(`CallKit Provider 详细配置: inviteTimeout=${config.inviteTimeout}, resizable=${config.resizable}, draggable=${config.draggable}`);
  logger.verbose(`CallKit 当前日志级别: ${logger.getCurrentLevelName()}`);
}

// 初始化 RTC 服务
async function initRtcService() {
  if (rtcInitializing || rtcInitialized || rtcChannelStore.getRtcService()) return
  rtcInitializing = true
  try {
    // 使用占位 appId 初始化 RtcService，实际 appId 在 joinChannel 时动态设置
    const placeholderAppId = props.agoraAppId || 'placeholder'
    await rtcChannelStore.initializeRtcService(placeholderAppId, props.agoraClient);
    if (props.agoraClient) {
      logger.info('RTC服务已初始化（使用外部传入的 Agora 客户端实例）')
    } else {
      logger.info('RTC服务已初始化，appId 将在加入频道时从环信服务器动态获取')
    }
    rtcInitialized = true
  } catch (error) {
    logger.error('RTC服务初始化失败:', error)
  } finally {
    rtcInitializing = false
  }
}

// 初始化 callkit-core
async function initCore() {
  const client = chatClientStore.getChatClient
  if (!client || coreInitializing || coreInitialized) return
  coreInitializing = true
  try {
    logger.info('CallKit Provider 已就绪，初始化 callkit-core');
    await initCallKitCore({
      imClient: client,
      userProfile: {
        userId: client.user || '',
      },
      inviteTimeout: effectiveInitConfig.value.inviteTimeout,
    });
    coreInitialized = true
    logger.info('[useCallKitCore] 初始化完成')
  } catch (err) {
    logger.error('CallKit Provider 初始化 callkit-core 失败:', err);
  } finally {
    coreInitializing = false
  }
}

// 构建默认用户资料 Provider（基于环信 SDK fetchUserInfoById，兼容 full/miniCore）
function createDefaultUserInfoProvider(chatClient: any, isMiniCore: boolean): UserInfoProvider {
  return async (userIds: string[]) => {
    const response = await fetchUserInfoById(chatClient, userIds, ['nickname', 'avatarurl'], isMiniCore)
    const data = response.data || {}
    return Object.entries(data).map(([userId, info]: [string, any]) => ({
      userId,
      nickname: info?.nickname,
      avatarUrl: info?.avatarurl,
    }))
  }
}

// 注册用户/群组资料 Provider
watch([() => props.getUserInfo, () => chatClientStore.getChatClient, () => props.isMiniCore], () => {
  if (props.getUserInfo) {
    registerUserInfoProvider(props.getUserInfo)
    logger.debug('CallKit Provider 已注册用户资料 Provider')
  } else if (chatClientStore.getChatClient) {
    // 未传入自定义 provider，使用环信 SDK 内置接口作为默认实现
    const defaultProvider = createDefaultUserInfoProvider(chatClientStore.getChatClient, !!props.isMiniCore)
    registerUserInfoProvider(defaultProvider)
    logger.debug('CallKit Provider 已注册默认用户资料 Provider（基于环信 SDK）')
  }
  if (props.getGroupInfo) {
    registerGroupInfoProvider(props.getGroupInfo)
    logger.debug('CallKit Provider 已注册群组资料 Provider')
  }
}, { immediate: true })

// 同步 isMiniCore 配置到 store
watch(() => props.isMiniCore, (isMiniCore) => {
  chatClientStore.setIsMiniCore(!!isMiniCore);
  if (isMiniCore) {
    logger.info('CallKit Provider: 已启用 miniCore 兼容模式');
  }
}, { immediate: true })

// 组件挂载完成
onMounted(async () => {
  mounted.value = true

  applyLoggerConfig()

  // 输出内部依赖版本号（便于问题排查和版本感知），使用 WARN 级别确保生产环境也能看到
  logger.warn(
    `[EasemobChatCallKit] callkit-core v${CORE_VERSION}`
  )

  // 先初始化 RTC 服务，再初始化 core
  await initRtcService()
  await initCore()
})

// 监听 chatClient 变化，延迟初始化 core（用于登录后重新传入 client 的场景）
watch(() => chatClientStore.getChatClient, async (client, oldClient) => {
  if (client && client !== oldClient && !coreInitialized) {
    await initRtcService()
    await initCore()
  }
})

// 组件卸载时清理 RTC 服务和 Provider
onUnmounted(async () => {
  await destroyCallKitCore();
  await rtcChannelStore.destroyRtcService();
  clearProfileProviders();
  // 重置初始化锁，确保 Provider 重新挂载时可以正常初始化
  rtcInitialized = false
  coreInitialized = false
});
</script>
