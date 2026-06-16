import type { CALL_TYPE, HANGUP_REASON } from "../../types/callstate.types";

/**
 * CallKit 事件类型枚举
 */
export type CallKitEventType =
  | "statusChanged" // 通话状态变化
  | "incomingCall" // 收到来电邀请
  | "callInvited" // 通话邀请已发出/收到（邀请阶段，UI 应显示窗口）
  | "callAccepted" // 通话已被接受
  | "callConnected" // 通话已连接（被叫收到 confirmCallee，即将进入 RTC）
  | "callStarted" // 通话开始（双方/多方接通，计时器启动）
  | "callEnded" // 通话结束
  | "callCanceled" // 通话被取消
  | "callRefused" // 通话被拒绝
  | "callTimeout" // 通话邀请超时
  | "callBusy" // 对方忙线
  // 精确单聊事件
  | "singleCallInvited"
  | "singleCallAccepted"
  | "singleCallStarted"
  | "singleCallConnected"
  | "singleCallEnded"
  | "singleCallCanceled"
  | "singleCallRefused"
  | "singleCallTimeout"
  | "singleCallBusy"
  // 精确群聊事件
  | "groupCallInvited"
  | "groupCallAccepted"
  | "groupCallStarted"
  | "groupCallConnected"
  | "groupCallEnded"
  | "groupCallCanceled"
  | "groupCallRefused"
  | "groupCallTimeout"
  | "groupCallBusy"
  | "participantJoined" // 群通话成员加入
  | "participantLeft" // 群通话成员离开
  | "groupCallInit" // 群通话初始化
  | "participantStateChanged" // 群通话参与者状态变化
  | "rtcReport" // RTC 上报事件
  | "callDurationUpdated" // 通话时长更新
  | "callError"; // 通话错误

/**
 * 当前用户在通话中的角色
 */
export type CallUserRole = "caller" | "callee" | "participant";

/**
 * 基础通话信息（事件 payload 公共字段）
 */
export interface BaseCallEvent {
  callId: string;
  channel: string;
  type: CALL_TYPE;
  callerUserId: string;
  calleeUserId?: string;
  groupId?: string;
  /** 会话 ID：单聊=对方用户ID，群聊=groupId，直接对应 IM 会话 key */
  conversationId: string;
  /** 是否由本端行为触发（true=本端，false=对端信令/系统） */
  isLocal: boolean;
  /** 当前用户在本通通话中的角色 */
  localUserRole: CallUserRole;
}

/**
 * 通话状态变化事件
 */
export interface StatusChangedEvent extends BaseCallEvent {
  from: number;
  to: number;
}

/**
 * 收到来电邀请事件
 */
export interface IncomingCallEvent extends BaseCallEvent {
  callerDevId: string;
  calleeDevId?: string;
  groupName?: string;
  groupAvatar?: string;
  invitedMembers?: string[];
}

/**
 * 通话邀请已发出/收到事件（邀请阶段，UI 应显示通话窗口）
 */
export interface CallInvitedEvent extends BaseCallEvent {
  /** 当前用户是否是主叫方 */
  isCaller: boolean;
}

/**
 * 通话已接受事件
 */
export interface CallAcceptedEvent extends BaseCallEvent {
  /** 当前用户是否是主叫方 */
  isCaller: boolean;
}

/**
 * 通话开始事件
 */
export interface CallConnectedEvent extends BaseCallEvent {}

export interface CallStartedEvent extends BaseCallEvent {
  /** 当前用户是否是主叫方 */
  isCaller: boolean;
}

/**
 * 通话结束事件
 */
export interface CallEndedEvent extends BaseCallEvent {
  /** 挂断原因 */
  reason: HANGUP_REASON;
  /** 通话时长（毫秒）。若计时器未启动则为 0 */
  duration: number;
  /** 挂断方的 userId（谁点的挂断）。部分 reason 如系统超时可能无此字段 */
  endedBy?: string;
}

/**
 * 通话取消事件
 */
export interface CallCanceledEvent extends BaseCallEvent {
  /** 是否是远程取消（冗余保留，等价于 !isLocal） */
  isRemote: boolean;
}

/**
 * 通话拒绝事件
 */
export interface CallRefusedEvent extends BaseCallEvent {
  /** 是否是远程拒绝（冗余保留，等价于 !isLocal） */
  isRemote: boolean;
}

/**
 * 通话超时事件
 */
export interface CallTimeoutEvent extends BaseCallEvent {}

/**
 * 对方忙线事件
 */
export interface CallBusyEvent extends BaseCallEvent {}

/**
 * 群通话成员加入事件
 */
export interface ParticipantJoinedEvent {
  userId: string;
  callId: string;
  channel: string;
  groupId?: string;
  /** 会话 ID，群聊=groupId */
  conversationId: string;
  /** 是否由本端行为触发 */
  isLocal: boolean;
  /** 当前用户角色 */
  localUserRole: CallUserRole;
}

/**
 * 群通话成员离开事件
 */
export interface ParticipantLeftEvent {
  userId: string;
  callId: string;
  channel: string;
  groupId?: string;
  reason?: string;
  /** 会话 ID，群聊=groupId */
  conversationId: string;
  /** 是否由本端行为触发 */
  isLocal: boolean;
  /** 当前用户角色 */
  localUserRole: CallUserRole;
}

/**
 * 群通话初始化事件
 */
export interface GroupCallInitEvent {
  callId: string;
  channel: string;
  groupId: string;
  groupName?: string;
  groupAvatar?: string;
  callType: CALL_TYPE;
  callerUserId: string;
  invitedMembers: string[];
  /** 会话 ID，群聊=groupId */
  conversationId: string;
  /** 是否由本端行为触发 */
  isLocal: boolean;
  /** 当前用户角色 */
  localUserRole: CallUserRole;
}

/**
 * 群通话参与者状态变化事件
 */
export interface ParticipantStateChangedEvent {
  userId: string;
  callId: string;
  channel: string;
  groupId?: string;
  state: string;
  /** 会话 ID，群聊=groupId */
  conversationId: string;
  /** 是否由本端行为触发 */
  isLocal: boolean;
  /** 当前用户角色 */
  localUserRole: CallUserRole;
}

/**
 * RTC 上报事件
 */
export interface RtcReportEvent {
  callId: string;
  channel: string;
  type: string;
  data: any;
  /** 会话 ID */
  conversationId: string;
  /** 是否由本端行为触发 */
  isLocal: boolean;
  /** 当前用户角色 */
  localUserRole: CallUserRole;
}

/**
 * 通话时长更新事件
 */
export interface CallDurationUpdatedEvent extends BaseCallEvent {
  /** 通话时长（毫秒） */
  duration: number;
}

/**
 * 通话错误事件
 */
export interface CallErrorEvent {
  type: "callError";
  payload: {
    /** 错误类型 */
    type: string;
    /** 错误信息 */
    error: string;
    /** 关联通话 ID */
    callId?: string;
    /** 额外上下文 */
    context?: Record<string, any>;
  };
}

/**
 * 通话记录对象（供 getCallRecord API 使用）
 */
export interface CallRecord {
  callId: string;
  conversationId: string;
  chatType: "singleChat" | "groupChat";
  from: string; // 主叫方 userId
  to: string; // 被叫方 userId 或群 groupId
  status:
    | "ended"
    | "refused"
    | "busy"
    | "canceled"
    | "timeout"
    | "noResponse"
    | "ongoing";
  duration: number; // 毫秒
  timestamp: number;
  endedBy?: string;
}

/**
 * 各事件对应的 payload 类型映射
 */
export interface CallKitEventPayloads {
  statusChanged: StatusChangedEvent;
  incomingCall: IncomingCallEvent;
  callInvited: CallInvitedEvent;
  callAccepted: CallAcceptedEvent;
  callConnected: CallConnectedEvent;
  callStarted: CallStartedEvent;
  callEnded: CallEndedEvent;
  callCanceled: CallCanceledEvent;
  callRefused: CallRefusedEvent;
  callTimeout: CallTimeoutEvent;
  callBusy: CallBusyEvent;
  // 精确单聊事件
  singleCallInvited: CallInvitedEvent;
  singleCallAccepted: CallAcceptedEvent;
  singleCallStarted: CallStartedEvent;
  singleCallConnected: CallConnectedEvent;
  singleCallEnded: CallEndedEvent;
  singleCallCanceled: CallCanceledEvent;
  singleCallRefused: CallRefusedEvent;
  singleCallTimeout: CallTimeoutEvent;
  singleCallBusy: CallBusyEvent;
  // 精确群聊事件
  groupCallInvited: CallInvitedEvent;
  groupCallAccepted: CallAcceptedEvent;
  groupCallStarted: CallStartedEvent;
  groupCallConnected: CallConnectedEvent;
  groupCallEnded: CallEndedEvent;
  groupCallCanceled: CallCanceledEvent;
  groupCallRefused: CallRefusedEvent;
  groupCallTimeout: CallTimeoutEvent;
  groupCallBusy: CallBusyEvent;
  participantJoined: ParticipantJoinedEvent;
  participantLeft: ParticipantLeftEvent;
  groupCallInit: GroupCallInitEvent;
  participantStateChanged: ParticipantStateChangedEvent;
  rtcReport: RtcReportEvent;
  callDurationUpdated: CallDurationUpdatedEvent;
  callError: CallErrorEvent;
}

/**
 * 事件处理器类型
 */
export type CallKitEventHandler<T extends CallKitEventType> = (
  payload: CallKitEventPayloads[T]
) => void;
