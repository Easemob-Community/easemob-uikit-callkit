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
import { useRtcChannelStore } from "./store/rtcChannel";

import { useCallTimerStore } from "./store/callTimer";
import { useGlobalCallStore } from "./store/globalCall";
import { useCallKit } from "./composables/useCallKit";
import { useCallKitEvents } from "./composables/useCallKitEvents";
import { useCallKitCore } from "./composables/useCallKitCore";
import { useRtcService } from "./composables/useRtcService";
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
export { useRtcChannelStore, useGlobalCallStore, useCallTimerStore };
// 导出部分hook
export { useCallKit, useCallKitEvents, useCallKitCore, useRtcService, useParticipants };
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
  UseCallKitCoreReturn,
} from "./composables/useCallKitCore";

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
  CallInvitedEvent,
  CallAcceptedEvent,
  CallConnectedEvent,
  CallStartedEvent,
  CallEndedEvent,
  CallCanceledEvent,
  CallRefusedEvent,
  CallTimeoutEvent,
  CallBusyEvent,
  GroupCallInitEvent,
  ParticipantJoinedEvent,
  ParticipantLeftEvent,
  ParticipantStateChangedEvent,
  RtcReportEvent,
  CallDurationUpdatedEvent,
  CallErrorEvent,
} from "./core/events/types";

export type { Participant } from "./composables/useParticipants";

// 导出常量与类型
export { HANGUP_REASON, CALL_STATUS, CALL_TYPE } from "./types/callstate.types";

export { LogLevel, Logger } from "./utils/logger";

// 导出静态资源配置
export { DEFAULT_BACKGROUND_IMAGE, ICONS, getAssetUrl } from "./config/assets";

// 版本号（构建时会替换）
const VERSION = "2.0.0";

const EasemobChatCallKit: Plugin = {
  install(app: App, ...options: any[]) {
    console.info(`%c[EasemobChatCallKit] v${VERSION} initialized`, "color: #4ade80; font-weight: bold;");
    // 自动注入 Pinia（用户项目无需额外安装/配置 Pinia）。
    // 必须始终使用 callkit 内部打包的 Pinia 实例：store 文件与该实例在同一 bundle 内，
    // 若外部已安装其他 Pinia，符号可能不匹配，导致 Provider setup 时 getActivePinia() 失败。
    app.use(createPinia());
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
