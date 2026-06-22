// Store相关类型定义
import type { Chat } from "../core/sdk/imSDK";
import type {
  CALL_STATUS,
  CALL_INFO,
  CALL_TYPE,
} from "../types/callstate.types";

export type CallStatus = CALL_STATUS;
export interface ChatClientState {
  client: Chat.Connection | null;
  /** 是否使用环信 IM SDK miniCore 版本（插件模式） */
  isMiniCore: boolean;
  /** IM 客户端是否已连接/登录 */
  isConnected: boolean;
}
export interface CallParticipant {
  userId: string;
  nickname?: string;
  avatar?: string;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isLocalUser: boolean;
  joinedAt: number;
}

export interface CurrentCallInfo {
  callId: string;
  callerId: string;
  calleeIds: string[];
  callType: "audio" | "video";
  startTime: number;
  duration: number;
  status: CallStatus;
  participants: CallParticipant[];
  isGroupCall: boolean;
  channelId?: string;
}
export interface INVITE_INFO {
  type: CALL_TYPE;
  calleeUserId: string;
  groupId?: string;
  groupName?: string;
  groupAvatar?: string;
  invitedMembers?: string[]; // 群组通话邀请成员列表
}
export interface CallState extends CALL_INFO {
  // 基础状态
  status: CallStatus;
  callType: "audio" | "video" | null;
  // 超时时间，单位ms，默认30s
  inviteTimeout?: number;
  // 超时定时器
  inviteTimeoutTimer?: any | null;
}

// RTC频道状态类型（简化版）
export interface RtcChannelState {
  isConnected: boolean;
  localStream: MediaStream | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
  agoraAppId: string | null;
}
