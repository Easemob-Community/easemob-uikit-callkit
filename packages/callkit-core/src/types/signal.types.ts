import { CALL_TYPE, type CALLKIT_ACTION_MSG_TYPE } from "./callstate.types";
// 邀请类型的文本消息接口定义
export interface SignalMessageInviteExt {
  // 基本信息
  action: "invite"; // 固定为'invite'
  callId: string;
  calleeIMName: string;
  callerDevId: string;
  callerIMName: string;
  channelName: string;
  chatType: CALL_TYPE;
  type: CALL_TYPE; // 从示例看是固定值
  ts: number; // 时间戳
  msgType: CALLKIT_ACTION_MSG_TYPE; // 从示例看是固定值

  // 推送扩展信息
  em_push_ext: {
    type: "call"; // 固定为'call'
    custom: {
      action: "invite";
      channelName: string;
      type: CALL_TYPE;
      callerDevId: string;
      callId: string;
      ts: number;
      msgType: CALLKIT_ACTION_MSG_TYPE;
      callerIMName: string;
      calleeIMName: string;
      callerNickname: string;
      chatType: CALL_TYPE;
    };
  };

  // APNS推送扩展
  em_apns_ext: {
    em_push_type: "voip"; // 固定为'voip'
  };

  // 用户信息，可选字段
  ease_chat_uikit_user_info?: {
    nickname: string;
    avatarURL: string;
  };

  // 群组通话信息，可选字段
  callkitGroupInfo?: {
    groupId: string;
    groupName?: string;
    groupAvatar?: string;
  };
}
// CMD 类型信令消息的通用类型定义

/**
 * 基础信令消息扩展字段接口
 */
export interface BaseSignalingExt {
  /** 操作类型 */
  action: string;
  /** 通话ID */
  callId: string;
  /** 时间戳 */
  ts: number;
  /** 消息类型 */
  msgType: string;
}

/**
 * 邀请消息扩展字段接口
 */
export interface InviteSignalingExt extends BaseSignalingExt {
  action: "invite";
  /** RTC频道名称 */
  channelName: string;
  /** 通话类型 */
  type: number;
  /** 主叫设备ID */
  callerDevId: string;
  /** 主叫IM用户名 */
  callerIMName: string;
  /** 被叫IM用户名 */
  calleeIMName: string;
  /** 聊天类型 */
  chatType: number;
  /** 推送扩展字段 */
  em_push_ext: {
    type: string;
    custom: {
      action: string;
      channelName: string;
      type: number;
      callerDevId: string;
      callId: string;
      ts: number;
      msgType: string;
      callerIMName: string;
      calleeIMName: string;
      callerNickname: string;
      chatType: number;
      ext?: Record<string, any>;
    };
  };
  /** APNS推送扩展字段 */
  em_apns_ext: {
    em_push_type: string;
  };
  /** 自定义扩展字段 */
  ext?: Record<string, any>;
  /** 被邀请成员列表（群组通话时使用） */
  invitedMembers?: string[];
  /** 用户信息（发送方 caller 资料） */
  ease_chat_uikit_user_info?: {
    nickname: string;
    avatarURL: string;
  };
  /** 群组通话信息 */
  callkitGroupInfo?: {
    groupId: string;
    groupName?: string;
    groupAvatar?: string;
  };
  /**
   * 兼容新版 iOS EaseCallUIKit：ext 最外层携带 groupId
   */
  groupId?: string;
  /**
   * 兼容新版 iOS EaseCallUIKit：ext 最外层携带 receiverList
   */
  receiverList?: string[];
}

/**
 * 响铃消息扩展字段接口
 */
export interface AlertSignalingExt extends BaseSignalingExt {
  action: "alert";
  /** 被叫设备ID */
  calleeDevId: string;
  /** 主叫设备ID */
  callerDevId: string;
}

/**
 * 确认响铃消息扩展字段接口
 */
export interface ConfirmRingSignalingExt extends BaseSignalingExt {
  action: "confirmRing";
  /** 确认状态 */
  status: boolean;
  /** 主叫设备ID */
  callerDevId: string;
  /** 被叫设备ID */
  calleeDevId: string;
}

/**
 * 应答消息扩展字段接口
 */
export interface AnswerCallSignalingExt extends BaseSignalingExt {
  action: "answerCall";
  /** 应答结果 */
  result: "accept" | "refuse" | "busy";
  /** 主叫设备ID */
  callerDevId: string;
  /** 被叫设备ID */
  calleeDevId: string;
  /**
   * 被叫方用户资料（与 invite 的 ease_chat_uikit_user_info 对称）：
   * 被叫 accept 时回传给主叫，使主叫侧无需依赖服务端用户属性即可展示被叫昵称/头像。
   * 可选字段，旧端忽略不影响兼容。
   */
  ease_chat_uikit_user_info?: {
    nickname?: string;
    avatarURL?: string;
  };
}

/**
 * 确认被叫方消息扩展字段接口
 */
export interface ConfirmCalleeSignalingExt extends BaseSignalingExt {
  action: "confirmCallee";
  /** 确认结果 */
  result: string;
  /** 主叫设备ID */
  callerDevId: string;
  /** 被叫设备ID */
  calleeDevId: string;
}

/**
 * 取消通话消息扩展字段接口
 */
export interface CancelCallSignalingExt extends BaseSignalingExt {
  action: "cancelCall";
  /** 主叫设备ID */
  callerDevId: string;
}

/**
 * 挂断通话消息扩展字段接口
 */
export interface LeaveCallSignalingExt extends BaseSignalingExt {
  action: "leaveCall";
}

/**
 * 所有信令消息扩展字段的联合类型
 */
export type SignalingExt =
  // | InviteSignalingExt
  | AlertSignalingExt
  | ConfirmRingSignalingExt
  | AnswerCallSignalingExt
  | ConfirmCalleeSignalingExt
  | CancelCallSignalingExt
  | LeaveCallSignalingExt;

/**
 * 信令消息配置接口
 */
export interface SignalingMessageOptions {
  type: "cmd";
  chatType: "singleChat" | "groupChat";
  to: string;
  action: string;
  ext: SignalingExt;
  receiverList?: string[];
  /** 是否直投在线用户 */
  deliverOnlineOnly: boolean;
}
export type CALLKIT_SIGNALING_CMD_ACTION = "rtcCall";
