import type { Chat } from "./core/sdk/imSDK";
import type { IAgoraRTCClient } from "agora-rtc-sdk-ng";
import type { HANGUP_REASON } from "./types/callstate.types";
import type { LogLevel } from "./utils/logger";

export interface EasemobChatCallKitOptions {
  // 基础配置
  appKey: string;
  userId?: string;
  accessToken?: string;
  debug?: boolean;

  // 功能配置
  enableRingtone?: boolean;
  resizable?: boolean;
  draggable?: boolean;

  // 环信客户端
  chatClient?: any;
}

export interface CallKitInstance {
  // 通话相关
  startCall: (targetId: string, type: "audio" | "video") => void;
  endCall: () => void;

  // 聊天相关
  startChat: (targetId: string) => void;

  // 状态
  isInCall: boolean;
  callType: "audio" | "video" | null;
  targetUser: string;

  // 配置
  config: any;
}

export interface ProviderConfig {
  chatClient?: Chat.Connection; // 可选，支持延迟初始化
  agoraClient?: IAgoraRTCClient; // 可选，外部传入的 Agora RTC 客户端实例
  agoraAppId?: string; // [已废弃] Agora AppId 将从环信服务器动态获取，此参数仅用于向后兼容
  /**
   * 是否使用环信 IM SDK miniCore 版本（插件模式）
   * 启用后 callkit 内部将使用命名空间 API（client.contact.* / client.group.* / client.Message.create）
   * 默认 false，使用 full 版本 API（实例直调）
   */
  isMiniCore?: boolean;
  initConfig?: {
    debug?: boolean; // 开启调试模式（等价于 logLevel: LogLevel.VERBOSE）
    logLevel?: LogLevel; // 控制台日志输出级别：0=ERROR, 1=WARN, 2=INFO, 3=DEBUG, 4=VERBOSE
    enableIDBLog?: boolean; // 是否启用 IndexedDB 日志持久化，默认 true
    enableRingtone?: boolean; // 开启铃声
    resizable?: boolean; // 开启可调整大小
    draggable?: boolean; // 开启可拖动
    inviteTimeout?: number; // 邀请超时时间，单位毫秒，默认 30000 毫秒
  };
  /**
   * 用户信息查询 Provider
   * 用于获取通话参与者的昵称和头像
   * @param userIds 用户ID数组
   * @returns 用户信息数组 { userId, nickname?, avatarUrl? }
   */
  getUserInfo?: (userIds: string[]) => Promise<Array<{ userId: string; nickname?: string; avatarUrl?: string }>>;
  /**
   * 群组信息查询 Provider
   * 用于获取群组的名称和头像
   * @param groupIds 群组ID数组
   * @returns 群组信息数组 { groupId, groupName?, groupAvatar? }
   */
  getGroupInfo?: (groupIds: string[]) => Promise<Array<{ groupId: string; groupName?: string; groupAvatar?: string }>>;
}

export interface CallParams {
  targetId: string;
  type: "audio" | "video";
  msg?: string;
  userInfo?: { nickname?: string; avatarURL?: string };
}

export interface GroupCallParams {
  groupId: string;
  members: string[];
  type: "audio" | "video";
  msg?: string;
  groupName?: string;
  groupAvatar?: string;
  userInfo?: { nickname?: string; avatarURL?: string };
}

// 导出类型别名，避免导入错误
export type EasemobChatCallKitInstance = CallKitInstance;

export interface UseCallKitReturn {
  /** 发起单人通话 */
  call: (params: CallParams) => Promise<void>;
  /** 发起群组通话 */
  groupCall: (params: GroupCallParams) => Promise<void>;
  /** 挂断/结束通话 */
  hangup: (reason?: HANGUP_REASON) => Promise<void>;
  /** 取消通话邀请 */
  cancel: () => Promise<void>;
  /** 接听通话 */
  accept: () => Promise<void>;
  /** 拒绝通话 */
  reject: () => Promise<void>;
  /** 忙碌拒绝通话 */
  rejectBusy: () => Promise<void>;
  /** 设置单个用户资料（优先级高于 Provider 拉取） */
  setUserInfo: (userId: string, userInfo: { nickname?: string; avatarURL?: string }) => void;
  /** 批量设置用户资料（key 为 userId） */
  setUserInfoMap: (map: Record<string, { nickname?: string; avatarURL?: string }>) => void;
}
