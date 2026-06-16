console.warn('[callkit-vue3] lib/ 目录已废弃，请使用 @easemob-community/callkit-vue3')

import { type App, type Plugin } from "vue";
import { createPinia } from "pinia";
import "./style.css";
import EasemobChatCallKitProvider from "./components/EasemobChatCallKitProvider.vue";
import EasemobChatSingleCall from "./components/singleCall/EasemobChatSingleCall.vue";
import EasemobChatMultiCall from "./components/multiCall/EasemobChatMultiCall.vue";
import EasemobChatGroupMemberList from "./components/multiCall/EasemobChatGroupMemberList.vue";
import InvitationNotification from "./components/InvitationNotification.vue";
import EasemobChatMiniWindow from "./components/EasemobChatMiniWindow.vue";
import { GroupCallShell } from "./modules/groupCall";
import { useCallStateStore } from "./store/callState";
import { useRtcChannelStore } from "./store/rtcChannel";
import { useSingleCallRtcStore } from "./store/singleCallRtc";
import { useCallTimerStore } from "./store/callTimer";
import { useGlobalCallStore } from "./store/globalCall";
import { useCallKit } from "./composables/useCallKit";
import { useCallKitEvents } from "./composables/useCallKitEvents";
import { useRtcService } from "./composables/useRtcService";
import { useJoinChannel } from "./composables/useJoinChannel";
import { useParticipants } from "./composables/useParticipants";
import { useDraggable, useCenteredDraggable, useCornerDraggable } from "./composables/useDraggable";
import { RtcService } from "./services/RtcService";
// 导出组件
export {
  EasemobChatCallKitProvider,
  EasemobChatSingleCall,
  EasemobChatMultiCall,
  EasemobChatGroupMemberList,
  InvitationNotification,
  EasemobChatMiniWindow,
  GroupCallShell,
};

// 导出store
export { useCallStateStore, useRtcChannelStore, useGlobalCallStore, useSingleCallRtcStore, useCallTimerStore };
// 导出部分hook
export { useCallKit, useCallKitEvents, useRtcService, useJoinChannel, useParticipants };
// 导出拖拽hook
export { useDraggable, useCenteredDraggable, useCornerDraggable };
// 导出RTC服务
export { RtcService };

// 导出类型
export type {
  EasemobChatCallKitOptions,
  EasemobChatCallKitInstance,
  ProviderConfig,
  UseCallKitReturn,
  CallParams,
  GroupCallParams,
} from "./types";

export type {
  UseCallKitEventsReturn,
} from "./composables/useCallKitEvents";

export type {
  CallKitEventType,
  CallKitEventPayloads,
  CallKitEventHandler,
  CallUserRole,
  CallRecord,
  BaseCallEvent,
  StatusChangedEvent,
  IncomingCallEvent,
  CallStartedEvent,
  CallEndedEvent,
  CallCanceledEvent,
  CallRefusedEvent,
  CallTimeoutEvent,
  CallBusyEvent,
  ParticipantJoinedEvent,
  ParticipantLeftEvent,
} from "./core/events/types";

export type { Participant } from "./composables/useParticipants";

// 导出常量与类型
export { HANGUP_REASON, CALL_STATUS, CALL_TYPE } from "./types/callstate.types";

export { LogLevel, Logger } from "./utils/logger";

// 导出静态资源配置
export { DEFAULT_BACKGROUND_IMAGE, ICONS, getAssetUrl } from "./config/assets";

// 版本号（构建时会替换）
const VERSION = "1.0.6";

const EasemobChatCallKit: Plugin = {
  install(app: App, ...options: any[]) {
    console.info(`%c[EasemobChatCallKit] v${VERSION} initialized`, "color: #4ade80; font-weight: bold;");
    // 自动注入 Pinia（用户项目无需额外安装/配置 Pinia）
    if (!app.config.globalProperties.$pinia) {
      app.use(createPinia());
    }
    // 注册组件
    app.component("EasemobChatCallKitProvider", EasemobChatCallKitProvider);
    app.component("EasemobChatSingleCall", EasemobChatSingleCall);
    app.component("EasemobChatMultiCall", EasemobChatMultiCall);
    app.component("EasemobChatGroupMemberList", EasemobChatGroupMemberList);
    app.component("InvitationNotification", InvitationNotification);
    app.component("EasemobChatMiniWindow", EasemobChatMiniWindow);
    app.component("GroupCallShell", GroupCallShell);
  },
};

export default EasemobChatCallKit;
