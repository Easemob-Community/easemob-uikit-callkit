import { GroupParticipant as GroupParticipant_2 } from '..';
import { GroupSessionState as GroupSessionState_2 } from '..';

/**
 * 响铃消息扩展字段接口
 */
export declare interface AlertSignalingExt extends BaseSignalingExt {
    action: "alert";
    /** 被叫设备ID */
    calleeDevId: string;
    /** 主叫设备ID */
    callerDevId: string;
}

export declare interface AnswerCallParams {
    callId: string;
    /** @deprecated 使用 result 替代 */
    accept?: boolean;
    result?: 'accept' | 'refuse' | 'busy';
}

/**
 * 应答消息扩展字段接口
 */
export declare interface AnswerCallSignalingExt extends BaseSignalingExt {
    action: "answerCall";
    /** 应答结果 */
    result: "accept" | "refuse" | "busy";
    /** 主叫设备ID */
    callerDevId: string;
    /** 被叫设备ID */
    calleeDevId: string;
}

declare interface BaseEvent {
    callId: string;
    channel: string;
    callType: CALL_TYPE;
    callerUserId: string;
    calleeUserId?: string;
    groupId?: string;
}

/**
 * 基础信令消息扩展字段接口
 */
declare interface BaseSignalingExt {
    /** 操作类型 */
    action: string;
    /** 通话ID */
    callId: string;
    /** 时间戳 */
    ts: number;
    /** 消息类型 */
    msgType: string;
}

export declare interface BuildCmdMessageParams {
    action: CALLKIT_CMD_MSG_ACTION_TYPE;
    callId: string;
    callerDevId?: string;
    calleeDevId?: string;
    result?: CALLKIT_CMD_MSG_RESULT_TYPE;
    status?: boolean;
    ts?: number;
}

/**
 * MessageBuilder
 * 由 ChatService 改造而来的纯函数集合。
 *
 * 关键变化：
 * - 不再读取 callStateStore，所有数据由调用方显式传入
 * - 不再查询用户/群组资料，由调用方传入
 */
export declare interface BuildInviteMessageParams {
    callId: string;
    callerUserId: string;
    calleeUserId: string;
    callerDevId: string;
    channel: string;
    callType: CALL_TYPE;
    ts?: number;
    invitedMembers?: string[];
    callerInfo?: {
        nickname?: string;
        avatarURL?: string;
    };
    groupInfo?: {
        groupId: string;
        groupName?: string;
        groupAvatar?: string;
    };
}

export declare type CALL_STATUS = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export declare const CALL_STATUS: {
    readonly IDLE: 0;
    readonly INVITING: 1;
    readonly ALERTING: 2;
    readonly CONFIRM_RING: 3;
    readonly RECEIVED_CONFIRM_RING: 4;
    readonly ANSWER_CALL: 5;
    readonly CONFIRM_CALLEE: 6;
    readonly IN_CALL: 7;
};

export declare type CALL_TYPE = 0 | 1 | 2 | 3;

export declare const CALL_TYPE: {
    readonly AUDIO_1V1: 0;
    readonly VIDEO_1V1: 1;
    readonly VIDEO_MULTI: 2;
    readonly AUDIO_MULTI: 3;
};

export declare interface CallAcceptedEvent {
    type: 'callAccepted';
    payload: BaseEvent & {
        isCaller: boolean;
    };
}

export declare interface CallBusyEvent {
    type: 'callBusy';
    payload: BaseEvent;
}

export declare interface CallCanceledEvent {
    type: 'callCanceled';
    payload: BaseEvent & {
        isRemote: boolean;
    };
}

export declare interface CallConnectedEvent {
    type: 'callConnected';
    payload: BaseEvent;
}

export declare interface CallDurationUpdatedEvent {
    type: 'callDurationUpdated';
    payload: BaseEvent & {
        duration: number;
    };
}

export declare interface CallEndedEvent {
    type: 'callEnded';
    payload: BaseEvent & {
        reason: 'hangup' | 'cancel' | 'refuse' | 'busy' | 'timeout' | 'remoteHangup' | 'remoteCancel';
        duration?: number;
    };
}

export declare interface CallErrorEvent {
    type: 'callError';
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

export declare interface CallInvitedEvent {
    type: 'callInvited';
    payload: BaseEvent & {
        isCaller: boolean;
    };
}

declare type CALLKIT_ACTION_MSG_TYPE = "rtcCallWithAgora";

export declare type CALLKIT_CMD_MSG_ACTION_TYPE = "confirmRing" | "alert" | "answerCall" | "leaveCall" | "confirmCallee" | "cancelCall";

export declare type CALLKIT_CMD_MSG_RESULT_TYPE = "accept" | "refuse" | "busy";

export declare const CALLKIT_CMD_MSG_RESULT_TYPE: {
    readonly ACCEPT: "accept";
    readonly REFUSE: "refuse";
    readonly BUSY: "busy";
};

/**
 * CallKitCore
 * 框架无关的通话信令核心。
 *
 * 职责：
 * 1. 管理单聊/群聊通话生命周期
 * 2. 通过事件回调通知上层所有决策点
 * 3. 不直接操作任何 RTC SDK，RTC 由上层通过适配器或事件自行处理
 */
export declare class CallKitCore {
    /** 被叫 accept 后等待主叫 confirmCallee 的超时时长（正常链路为百毫秒级，10s 已足够宽容） */
    private static readonly CONFIRM_CALLEE_TIMEOUT_MS;
    private config;
    private logger;
    private singleCallState;
    private groupCallSession;
    private signalRouter;
    private signalSender;
    private singleCallHandler;
    private groupCallHandler;
    private imListener;
    private destroyed;
    private inviteTimer;
    private confirmCalleeTimer;
    private invitingLock;
    private pendingIncomingInvites;
    private recentlyCanceledCalls;
    private rtcAppId;
    private rtcUid;
    private inviteTimeoutMs;
    private durationTimer;
    private durationStartTime;
    private durationSeconds;
    private durationCallInfo;
    private get userId();
    private get deviceId();
    private eventBus;
    constructor(config: CallKitCoreConfig);
    /**
     * 更新底层 IM 客户端实例（用于账号切换等场景）。
     * 会同步更新 SignalSender、IMListener 以及内部 config，不丢失当前通话状态。
     */
    updateImClient(imClient: EasemobConnection): void;
    /**
     * 发起单聊通话
     */
    inviteCall(params: InviteCallParams): Promise<void>;
    /**
     * 响应来电（接受/拒绝）
     */
    answerCall(params: AnswerCallParams): Promise<void>;
    /**
     * 挂断/取消通话
     */
    hangup(params?: HangupParams): Promise<void>;
    /**
     * 通话中邀请更多成员加入群聊通话
     */
    inviteMoreParticipants(participantIds: string[]): Promise<void>;
    /**
     * 发起群聊通话
     */
    inviteGroupCall(params: InviteGroupCallParams): Promise<void>;
    /**
     * 切换本地音频（静音/取消静音）
     */
    toggleAudio(): void;
    /**
     * 切换本地视频（开启/关闭摄像头）
     */
    toggleVideo(): void;
    /**
     * 获取 RTC token（并缓存 appId / RTCUId）
     * - 环信真实 SDK：`{ data: { RTCToken, appId, RTCUId, expireIn } }`
     * - 早期 / 精简 mock：`{ accessToken, appId }`
     * 为了与旧版 lib/composables/useJoinChannel.ts 行为对齐，同步保存 rtcAppId、rtcUid供
     * shouldJoinRtc 事件透传给上层 RtcAdapter（Agora 的 join 必须使用服务端返回的数值型 uid）。
     */
    private fetchRtcToken;
    /**
     * 上层调用 RTC SDK 后，通过此方法反馈 RTC 事件给核心库
     */
    reportRtcEvent(report: RtcReport): void;
    getSingleCallState(): Readonly<SingleCallState>;
    getGroupCallSession(): Readonly<GroupSessionState_2> | null;
    /**
     * 获取群聊通话的所有参与者（包含状态信息）
     */
    getGroupCallParticipants(): Readonly<GroupParticipant_2>[];
    /**
     * 当前是否在通话中（IN_CALL 状态）
     */
    isInCall(): boolean;
    /**
     * 当前是否处于可被接听的状态（被叫端弹窗显示区间）
     */
    isWaitingCalleeAction(): boolean;
    /**
     * 当前是否处于活跃通话中（已进入 RTC 或即将进入）
     */
    isInActiveCall(): boolean;
    /**
     * 当前是否可以接听（被叫端按钮可点击）
     */
    canAccept(): boolean;
    /**
     * 当前是否可以拒绝（被叫端按钮可点击）
     */
    canReject(): boolean;
    /**
     * 当前是否可以挂断（主叫/被叫端的挂断按钮可点击）
     */
    canHangup(): boolean;
    /**
     * 当前是否在呼叫/响铃中（INVITING 或 ALERTING 状态）
     */
    isCalling(): boolean;
    /**
     * 获取当前通话类型，无通话时返回 null
     */
    getCurrentCallType(): CALL_TYPE | null;
    /**
     * 获取当前通话 ID，无通话时返回空字符串
     */
    getCurrentCallId(): string;
    /**
     * 当前是否空闲
     */
    isIdle(): boolean;
    /**
     * 订阅通话事件
     * @returns 取消订阅函数
     */
    onEvent(handler: (event: CallKitEvent) => void): () => void;
    /**
     * 订阅单次通话事件
     */
    onceEvent(handler: (event: CallKitEvent) => void): () => void;
    destroy(): Promise<void>;
    private isSelfMessage;
    private handleTextMessage;
    private handleGroupCallInvite;
    private handleSingleCallInvite;
    /**
     * 发送忙线拒绝（answerCall result=busy），在线直投
     */
    private sendBusyReject;
    /**
     * 发送 alert CMD 信令给主叫方
     */
    private sendAlertSignal;
    private handleCmdMessage;
    private processEvents;
    /**
     * 当配置了 rtcAdapter 时，自动处理 RTC 相关事件
     */
    private handleRtcEvent;
    /**
     * RTC 媒体开关操作失败后的状态回滚
     * 直接改状态机（不产生 LOCAL_*_CHANGED 域事件，避免再次触发 adapter 形成循环），
     * 仅向 UI 层广播回滚后的状态，保持 core 状态机与真实 RTC 状态一致（单一事实源）。
     */
    private rollbackLocalMedia;
    private mapDomainEvents;
    private emitEvent;
    private emitError;
    private startDurationTimer;
    private stopDurationTimer;
    private handleIMConnected;
    private handleIMDisconnected;
    /**
     * 启动邀请超时定时器。
     * 超时后调用状态机的 timeout() 并通过 processEvents 消费事件，
     * 确保上层 UI 能收到 callTimeout + callEnded 事件。
     */
    private startInviteTimeout;
    private clearInviteTimeout;
    /**
     * 启动 confirmCallee 等待超时（被叫 accept 后调用）。
     * 正常链路中 confirmCallee 在主叫收到 answerCall 后立即回发（百毫秒级），
     * 若超时仍未到达（主叫已取消/离线），说明这通呼叫已死，回收状态机避免阻塞后续呼叫。
     */
    private startConfirmCalleeTimeout;
    private clearConfirmCalleeTimeout;
    /**
     * 记录已取消的 callId（TTL = inviteTimeout + 10s，与 invite 过期窗口对齐）
     * 同时惰性清理已过期的条目
     */
    private markCallCanceled;
    /**
     * 检查 callId 是否近期已被取消（命中且未过期）
     */
    private isCallRecentlyCanceled;
}

export declare interface CallKitCoreConfig {
    /** 环信 IM 客户端实例 */
    imClient: EasemobConnection;
    /** 当前用户资料 */
    userProfile?: {
        userId: string;
        nickname?: string;
        avatarURL?: string;
    };
    /** RTC 适配器（可选）。配置后 Core 会自动处理 RTC 指令事件 */
    rtcAdapter?: RtcAdapter;
    /** 全局事件回调（兼容旧接口，与 onUIEvent/onRtcEvent 可共存） */
    onEvent?: (event: CallKitEvent) => void;
    /** UI 层事件回调：显示弹窗、更新界面、处理通话生命周期 */
    onUIEvent?: (event: UIEvent_2) => void;
    /** RTC 指令事件回调：加入/离开频道、发布轨道、切换音视频。若已配置 rtcAdapter 可省略 */
    onRtcEvent?: (event: RtcEvent) => void;
    /** 邀请超时时间（毫秒），默认 30000 */
    inviteTimeout?: number;
    /** 自定义日志器（可选） */
    logger?: Logger;
    /** 消息创建工厂（可选）。用于兼容不同版本的 easemob-websdk 消息创建方式 */
    createMessage?: (options: any) => any;
}

export declare type CallKitEvent = UIEvent_2 | RtcEvent;

export declare interface CallRefusedEvent {
    type: 'callRefused';
    payload: BaseEvent & {
        isRemote: boolean;
    };
}

export declare interface CallStartedEvent {
    type: 'callStarted';
    payload: BaseEvent & {
        isCaller: boolean;
        startTime: number;
    };
}

export declare interface CallTimeoutEvent {
    type: 'callTimeout';
    payload: BaseEvent;
}

/**
 * 取消通话消息扩展字段接口
 */
export declare interface CancelCallSignalingExt extends BaseSignalingExt {
    action: "cancelCall";
    /** 主叫设备ID */
    callerDevId: string;
}

/**
 * 信令消息体（从 useListenerManager 提取，去框架依赖）
 */
export declare interface CmdMsgBody {
    from?: string;
    to?: string;
    id?: string;
    action?: string;
    ext?: Partial<SignalingExt> & {
        [key: string]: any;
    };
    [key: string]: any;
}

/**
 * 确认被叫方消息扩展字段接口
 */
export declare interface ConfirmCalleeSignalingExt extends BaseSignalingExt {
    action: "confirmCallee";
    /** 确认结果 */
    result: string;
    /** 主叫设备ID */
    callerDevId: string;
    /** 被叫设备ID */
    calleeDevId: string;
}

/**
 * 确认响铃消息扩展字段接口
 */
export declare interface ConfirmRingSignalingExt extends BaseSignalingExt {
    action: "confirmRing";
    /** 确认状态 */
    status: boolean;
    /** 主叫设备ID */
    callerDevId: string;
    /** 被叫设备ID */
    calleeDevId: string;
}

export declare type DomainEvent = {
    type: 'STATUS_CHANGED';
    from: CALL_STATUS;
    to: CALL_STATUS;
    callId: string;
} | {
    type: 'CALL_INVITED';
    callId: string;
    isCaller: boolean;
    channel: string;
    callType: CALL_TYPE;
} | {
    type: 'CALL_STARTED';
    callId: string;
    isCaller: boolean;
    channel: string;
    callType: CALL_TYPE;
} | {
    type: 'CALL_ACCEPTED';
    callId: string;
    isCaller: boolean;
    channel: string;
    callType: CALL_TYPE;
} | {
    type: 'CALL_CONNECTED';
    callId: string;
    channel: string;
    callType: CALL_TYPE;
} | {
    type: 'CALL_ENDED';
    callId: string;
    reason: string;
    duration: number;
} | {
    type: 'CALL_TIMEOUT';
    callId: string;
} | {
    type: 'CALL_REFUSED';
    callId: string;
    isRemote: boolean;
} | {
    type: 'CALL_BUSY';
    callId: string;
} | {
    type: 'CALL_CANCELED';
    callId: string;
    isRemote: boolean;
} | {
    type: 'SHOULD_JOIN_RTC';
    callId: string;
    channel: string;
    token: string;
    role: 'caller' | 'callee';
    callType: CALL_TYPE;
} | {
    type: 'GROUP_CALL_INIT';
    callId: string;
    groupId: string;
    groupName: string;
    channel: string;
    callType: 'audio' | 'video';
    callerUserId: string;
    invitedMembers: string[];
} | {
    type: 'PARTICIPANT_STATE_CHANGED';
    callId: string;
    userId: string;
    state: 'invited' | 'accepted' | 'joinedRtc' | 'left';
    groupId?: string;
} | {
    type: 'PARTICIPANT_JOINED';
    callId: string;
    userId: string;
    channel: string;
    callType: CALL_TYPE;
    groupId?: string;
} | {
    type: 'PARTICIPANT_LEFT';
    callId: string;
    userId: string;
    channel: string;
    callType: CALL_TYPE;
    reason: string;
    groupId?: string;
} | {
    type: 'LOCAL_AUDIO_CHANGED';
    callId: string;
    enabled: boolean;
} | {
    type: 'LOCAL_VIDEO_CHANGED';
    callId: string;
    enabled: boolean;
};

export declare interface EasemobConnection {
    user: string;
    context: {
        userId: string;
        jid: {
            clientResource: string;
        };
    };
    token: string;
    send: (msg: any) => Promise<any>;
    addEventHandler: (id: string, handlers: Record<string, (...args: any[]) => void>) => void;
    removeEventHandler: (id: string) => void;
    /**
     * 获取 Agora RTC Token。
     * 环信真实 SDK 返回结构为 `{ data: { RTCToken, appId, RTCUId, expireIn } }`，
     * 为了兼容早期代码与精简 mock，额外允许顶层 `accessToken`/`appId` 字段。
     */
    getRTCToken: (channel: string) => Promise<{
        data?: {
            RTCToken?: string;
            appId?: string;
            RTCUId?: number;
            expireIn?: number;
        };
        accessToken?: string;
        appId?: string;
    }>;
    getUserIdByRTCUIds: (uids: (number | string)[]) => Promise<{
        data: Record<string, string>;
    }>;
}

/**
 * 轻量级事件总线
 * 不依赖外部库，内部使用 Map + Set 实现。
 */
export declare class EventBus<TEvents extends Record<string, any>> {
    private listeners;
    private logger;
    constructor(logger?: Logger);
    on<K extends keyof TEvents>(event: K, handler: (payload: TEvents[K]) => void): () => void;
    once<K extends keyof TEvents>(event: K, handler: (payload: TEvents[K]) => void): () => void;
    off<K extends keyof TEvents>(event: K, handler: (payload: TEvents[K]) => void): void;
    emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void;
    clear(event?: keyof TEvents): void;
    listenerCount(event: keyof TEvents): number;
}

/**
 * 格式化通话时间
 * @param seconds 秒数
 * @returns 格式化的时间字符串 (HH:MM:SS 或 MM:SS)
 */
export declare const formatCallDuration: (seconds: number) => string;

/**
 * 生成随机channel字符串
 * @param length 字符串长度，默认8位
 * @returns 随机字符串
 */
export declare const generateRandomChannel: (length?: number) => string;

export declare function getLogger(): Logger;

export declare interface GroupCallAcceptedEvent {
    type: 'groupCallAccepted';
    payload: BaseEvent & {
        isCaller: boolean;
    };
}

export declare interface GroupCallBusyEvent {
    type: 'groupCallBusy';
    payload: BaseEvent;
}

export declare interface GroupCallCanceledEvent {
    type: 'groupCallCanceled';
    payload: BaseEvent & {
        isRemote: boolean;
    };
}

export declare interface GroupCallConnectedEvent {
    type: 'groupCallConnected';
    payload: BaseEvent;
}

export declare interface GroupCallEndedEvent {
    type: 'groupCallEnded';
    payload: BaseEvent & {
        reason: 'hangup' | 'cancel' | 'refuse' | 'busy' | 'timeout' | 'remoteHangup' | 'remoteCancel';
        duration?: number;
    };
}

export declare interface GroupCallInitEvent {
    type: 'groupCallInit';
    payload: {
        callId: string;
        groupId: string;
        groupName: string;
        channel: string;
        callType: 'audio' | 'video';
        callerUserId: string;
        invitedMembers: string[];
    };
}

export declare interface GroupCallInvitedEvent {
    type: 'groupCallInvited';
    payload: BaseEvent & {
        isCaller: boolean;
    };
}

export declare interface GroupCallRefusedEvent {
    type: 'groupCallRefused';
    payload: BaseEvent & {
        isRemote: boolean;
    };
}

/**
 * 群聊会话管理
 *
 * 职责：
 * 1. 管理群聊通话的会话元数据
 * 2. 维护参与者集合及其状态流转
 * 3. 不执行副作用，只维护内存状态
 */
export declare class GroupCallSession {
    private session;
    private participants;
    private pendingRemoveTimers;
    private logger;
    constructor(logger?: Logger);
    /**
     * 初始化会话
     */
    init(params: {
        sessionId: string;
        groupId: string;
        groupName: string;
        callType: 'audio' | 'video';
        callerUserId: string;
    }): void;
    /**
     * 添加参与者
     */
    addParticipant(info: GroupParticipant): void;
    /**
     * 移除参与者
     */
    removeParticipant(userId: string): boolean;
    /**
     * 延迟移除已离开参与者（left 后 2 秒）
     * - 新 left 先取消同 userId 的旧 timer
     * - 真正移除前校验当前 state 仍为 'left'，防止误杀重进成员
     */
    scheduleRemoveParticipant(userId: string, delayMs?: number): void;
    /**
     * 标记参与者状态
     */
    setParticipantState(userId: string, state: GroupParticipant['state']): boolean;
    /**
     * 标记已接受
     */
    markAccepted(userId: string): boolean;
    /**
     * 标记已加入 RTC
     */
    markJoinedRtc(userId: string): boolean;
    /**
     * 标记已离开 RTC
     */
    markLeftRtc(userId: string): boolean;
    /**
     * 标记音频静音状态
     */
    markAudioMuted(userId: string, muted: boolean): boolean;
    /**
     * 标记视频开关状态
     */
    markVideoOn(userId: string, on: boolean): boolean;
    /**
     * 获取参与者
     */
    getParticipant(userId: string): Readonly<GroupParticipant> | undefined;
    /**
     * 获取所有参与者
     */
    getAllParticipants(): Readonly<GroupParticipant>[];
    /**
     * 获取当前在线参与者（未离开）
     */
    getActiveParticipants(): Readonly<GroupParticipant>[];
    /**
     * 获取会话快照
     */
    getSnapshot(): Readonly<GroupSessionState> | null;
    /**
     * 结束会话
     */
    end(): void;
    /**
     * 销毁会话
     */
    destroy(): void;
}

/**
 * GroupCallSignalHandler
 * 群聊域信令处理器
 *
 * 改造后：
 * - 不读写 GroupCallStore → 注入 GroupCallSession
 * - 不直接调用 CallService → 返回 DomainEvent[]
 * - 不直接 emit callKitEventBus → 返回 DomainEvent[]
 * - 保留 SingleCallStateMachine 用于 callId / 状态校验（与原架构一致）
 */
export declare class GroupCallSignalHandler implements SignalHandler {
    private session;
    private stateMachine;
    private sender;
    private getUserId;
    private logger;
    constructor(session: GroupCallSession, stateMachine: SingleCallStateMachine, sender: SignalSender, userIdProvider: (() => string) | string, logger?: Logger);
    private get userId();
    /**
     * 处理 invite 文本消息中的群聊初始化
     * 由 IMListener 在收到 invite 文本消息时直接调用（不走 SignalRouter）
     */
    handleInviteTextMessage(message: CmdMsgBody): DomainEvent[];
    handle(message: CmdMsgBody): DomainEvent[];
    private handleAnswerCall;
    private sendConfirmCallee;
    private handleCancelCall;
    private handleLeaveCall;
}

export declare interface GroupCallStartedEvent {
    type: 'groupCallStarted';
    payload: BaseEvent & {
        isCaller: boolean;
        startTime: number;
    };
}

export declare interface GroupCallTimeoutEvent {
    type: 'groupCallTimeout';
    payload: BaseEvent;
}

/**
 * 群聊参与者
 */
export declare interface GroupParticipant {
    userId: string;
    nickname: string;
    avatarUrl?: string;
    state: 'invited' | 'accepted' | 'joinedRtc' | 'left';
    isLocal: boolean;
    isMuted: boolean;
    isCameraOn: boolean;
    isSpeaking: boolean;
}

/**
 * 群聊会话状态
 */
export declare interface GroupSessionState {
    sessionId: string;
    groupId: string;
    groupName: string;
    callType: 'audio' | 'video';
    status: 'inviting' | 'inCall' | 'ended';
    callerUserId: string;
    startTime: number;
}

export declare type HANGUP_REASON = "hangup" | "cancel" | "remoteCancel" | "refuse" | "remoteRefuse" | "busy" | "noResponse" | "remoteNoResponse" | "handleOnOtherDevice" | "abnormalEnd";

export declare const HANGUP_REASON: {
    readonly HANGUP: "hangup";
    readonly CANCEL: "cancel";
    readonly REMOTE_CANCEL: "remoteCancel";
    readonly REFUSE: "refuse";
    readonly REMOTE_REFUSE: "remoteRefuse";
    readonly BUSY: "busy";
    readonly NO_RESPONSE: "noResponse";
    readonly REMOTE_NO_RESPONSE: "remoteNoResponse";
    readonly HANDLE_ON_OTHER_DEVICE: "handleOnOtherDevice";
    readonly ABNORMAL_END: "abnormalEnd";
};

export declare interface HangupParams {
    callId?: string;
    reason?: 'normal' | 'cancel' | 'timeout';
}

/**
 * IMListener
 * 环信 IM SDK 消息监听器薄壳。
 *
 * 职责：
 * 1. 挂载 onTextMessage / onCmdMessage 监听
 * 2. 收到后通过回调交给 CallKitCore 处理（不处理任何业务逻辑）
 */
export declare class IMListener {
    private imClient;
    private callbacks;
    private logger;
    private mounted;
    private handlerId;
    constructor(imClient: EasemobConnection, callbacks: IMListenerCallbacks, logger?: Logger);
    mount(): void;
    unmount(): void;
    /**
     * 更新底层 IM 客户端实例（用于账号切换等场景）
     */
    updateImClient(imClient: EasemobConnection): void;
}

export declare interface IMListenerCallbacks {
    onTextMessage?: (msg: any) => void | Promise<void>;
    onCmdMessage?: (msg: any) => void | Promise<void>;
    onConnected?: () => void;
    onDisconnected?: () => void;
}

/**
 * IM 抽象接口
 *
 * 核心库通过此接口与环信 IM SDK 交互，不直接 import easemob-websdk。
 * 由于环信 Web/小程序/UniApp API 一致，此接口可直接映射到环信 SDK。
 */
export declare interface IMMessage {
    from?: string;
    to?: string;
    id?: string;
    type: 'txt' | 'cmd';
    body?: any;
    ext?: Record<string, any>;
    [key: string]: any;
}

export declare interface IMProvider {
    /** 发送消息 */
    sendMessage(msg: IMMessage): Promise<any>;
    /** 获取当前登录用户 ID */
    getCurrentUserId(): string;
    /** 获取当前设备 ID */
    getCurrentDeviceId(): string;
    /** 获取 RTC Token 和 AppId（环信 SDK 特有方法） */
    getRtcToken(channel: string): Promise<{
        token: string;
        appId: string;
    }>;
    /** UID → UserId 映射查询（环信 SDK 特有方法） */
    getUserIdByRtcUids(uids: (string | number)[]): Promise<Record<string, string>>;
    /** 挂载消息监听 */
    onTextMessage(handler: (msg: IMMessage) => void): () => void;
    /** 挂载 CMD 消息监听 */
    onCmdMessage(handler: (msg: IMMessage) => void): () => void;
}

export declare interface IncomingCallEvent {
    type: 'incomingCall';
    payload: {
        callId: string;
        callType: CALL_TYPE;
        callerUserId: string;
        callerDevId: string;
        channel: string;
        calleeUserId: string;
        token?: string;
        groupId?: string;
        groupName?: string;
        invitedMembers?: string[];
        callerInfo?: {
            nickname?: string;
            avatarURL?: string;
        };
    };
}

export declare interface InviteCallParams {
    calleeUserId: string;
    callType: CALL_TYPE;
    ext?: Record<string, any>;
    /**
     * 当前用户（主叫方）资料。
     * 优先级高于 CallKitCoreConfig.userProfile，用于让每次邀请都携带最新的昵称/头像。
     */
    callerInfo?: {
        nickname?: string;
        avatarURL?: string;
    };
}

export declare interface InviteGroupCallParams {
    groupId: string;
    participantIds: string[];
    callType: CALL_TYPE;
    ext?: Record<string, any>;
    /**
     * 当前用户（主叫方）资料。
     * 优先级高于 CallKitCoreConfig.userProfile，用于让每次邀请都携带最新的昵称/头像。
     */
    callerInfo?: {
        nickname?: string;
        avatarURL?: string;
    };
}

/**
 * 邀请消息扩展字段接口
 */
export declare interface InviteSignalingExt extends BaseSignalingExt {
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
 * CMD 消息过期检查（与 lib 对齐，默认 60s）
 * @param messageTime 消息时间戳（毫秒）
 * @returns 是否已过期
 */
export declare const isCmdMessageExpired: (messageTime: number) => boolean;

/**
 * 检查消息是否已过期
 * 与 lib/composables/useListenerManager.ts 中的 isMessageExpired 对齐
 * @param messageTime 消息时间戳（毫秒）
 * @param toleranceMs 容忍时间（毫秒），默认 40000（30s invite超时 + 10s 容差）
 * @returns 是否已过期
 */
export declare const isMessageExpired: (messageTime: number, toleranceMs?: number) => boolean;

export declare function isRtcEvent(event: CallKitEvent): event is RtcEvent;

export declare function isUIEvent(event: CallKitEvent): event is UIEvent_2;

/**
 * RTC 抽象接口
 *
 * 核心库不直接调用任何 RTC SDK，只通过此接口定义期望的 RTC 能力。
 * 上层（Vue3/UniApp/React）自行实现此接口，接入对应的 RTC SDK。
 */
export declare interface JoinRtcParams {
    channel: string;
    token: string;
    uid: string | number;
    appId?: string;
}

/**
 * 挂断通话消息扩展字段接口
 */
export declare interface LeaveCallSignalingExt extends BaseSignalingExt {
    action: "leaveCall";
}

export declare interface LocalAudioChangedEvent {
    type: 'localAudioChanged';
    payload: {
        enabled: boolean;
    };
}

export declare interface LocalVideoChangedEvent {
    type: 'localVideoChanged';
    payload: {
        enabled: boolean;
    };
}

/**
 * 轻量级日志接口
 * 核心库不依赖外部日志库（如 dexie），通过接口允许上层注入自定义 logger。
 */
export declare interface Logger {
    error(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    debug(message: string, ...args: any[]): void;
    verbose(message: string, ...args: any[]): void;
    signal?(direction: 'send' | 'recv', action: string, meta?: Record<string, any>): void;
    stateChange?(from: any, to: any, meta?: Record<string, any>): void;
    rtc?(event: string, meta?: Record<string, any>): void;
    event?(event: string, meta?: Record<string, any>): void;
}

export declare class MessageBuilder {
    /**
     * 构建 invite 文本消息的 ext
     */
    static buildInviteExt(params: BuildInviteMessageParams): InviteSignalingExt;
    /**
     * 构建 CMD 信令消息的 ext
     */
    static buildCmdExt(params: BuildCmdMessageParams): SignalingExt;
}

export declare interface ParticipantJoinedEvent {
    type: 'participantJoined';
    payload: BaseEvent & {
        userId: string;
        groupId?: string;
    };
}

export declare interface ParticipantLeftEvent {
    type: 'participantLeft';
    payload: BaseEvent & {
        userId: string;
        reason: string;
        groupId?: string;
    };
}

export declare interface ParticipantStateChangedEvent {
    type: 'participantStateChanged';
    payload: {
        callId: string;
        userId: string;
        state: 'invited' | 'accepted' | 'joinedRtc' | 'left';
        groupId?: string;
    };
}

export declare interface RtcAdapter {
    /**
     * 加入 RTC 频道
     */
    joinChannel(params: JoinRtcParams): Promise<void>;
    /**
     * 离开 RTC 频道
     */
    leaveChannel(): Promise<void>;
    /**
     * 创建并发布本地轨道
     * @param types 要发布的轨道类型
     */
    publishLocalTracks(types: ('audio' | 'video')[]): Promise<void>;
    /**
     * 取消发布本地轨道
     */
    unpublishLocalTracks(types: ('audio' | 'video')[]): Promise<void>;
    /**
     * 订阅远程用户
     */
    subscribeRemoteUser(userId: string, mediaType: 'audio' | 'video'): Promise<void>;
    /**
     * 取消订阅远程用户
     */
    unsubscribeRemoteUser(userId: string, mediaType: 'audio' | 'video'): Promise<void>;
    /**
     * 静音/取消静音
     */
    setAudioEnabled(enabled: boolean): Promise<void>;
    /**
     * 开启/关闭摄像头
     */
    setVideoEnabled(enabled: boolean): Promise<void>;
    /**
     * 切换摄像头设备
     */
    switchCamera?(deviceId: string): Promise<void>;
    /**
     * 切换麦克风设备
     */
    switchMicrophone?(deviceId: string): Promise<void>;
    /**
     * 切换音频输出设备（移动端：扬声器/听筒）
     */
    switchAudioOutput?(device: 'speaker' | 'earpiece'): Promise<void>;
}

export declare type RtcEvent = ShouldJoinRtcEvent | ShouldLeaveRtcEvent | ShouldPublishTracksEvent | LocalAudioChangedEvent | LocalVideoChangedEvent;

export declare interface RtcReport {
    type: 'rtcJoined' | 'rtcLeft' | 'userJoined' | 'userLeft' | 'userPublished' | 'userUnpublished' | 'userAudioMuted' | 'userAudioUnmuted' | 'userVideoMuted' | 'userVideoUnmuted' | 'networkQuality' | 'speaking' | 'stoppedSpeaking' | 'error';
    payload: {
        userId?: string;
        uid?: string | number;
        mediaType?: 'audio' | 'video';
        track?: any;
        /** 网络质量：0=未知, 1=优, 2=良, 3=一般, 4=差, 5=极差, 6=断开 */
        quality?: number;
        /** 说话音量 0-100 */
        volume?: number;
        /** 错误信息 */
        error?: string;
        /** 错误码 */
        errorCode?: number;
    };
}

declare interface RtcReportEvent {
    type: 'rtcReport';
    payload: {
        type: string;
        payload: Record<string, any>;
    };
}

export declare function setLogger(logger: Logger): void;

export declare interface ShouldJoinRtcEvent {
    type: 'shouldJoinRtc';
    payload: BaseEvent & {
        token: string;
        uid: number | string;
        /** Agora App ID（来自 IM 服务端 getRTCToken 返回），为空时上层使用初始化时传入的 appId */
        appId?: string;
        role: 'caller' | 'callee';
    };
}

export declare interface ShouldLeaveRtcEvent {
    type: 'shouldLeaveRtc';
    payload: BaseEvent & {
        reason: string;
    };
}

export declare interface ShouldPublishTracksEvent {
    type: 'shouldPublishTracks';
    payload: BaseEvent & {
        trackTypes: ('audio' | 'video')[];
    };
}

export declare interface SignalHandler {
    handle(message: CmdMsgBody): DomainEvent[];
}

/**
 * 所有信令消息扩展字段的联合类型
 */
export declare type SignalingExt = AlertSignalingExt | ConfirmRingSignalingExt | AnswerCallSignalingExt | ConfirmCalleeSignalingExt | CancelCallSignalingExt | LeaveCallSignalingExt;

export declare interface SignalMessageInviteExt {
    action: "invite";
    callId: string;
    calleeIMName: string;
    callerDevId: string;
    callerIMName: string;
    channelName: string;
    chatType: CALL_TYPE;
    type: CALL_TYPE;
    ts: number;
    msgType: CALLKIT_ACTION_MSG_TYPE;
    em_push_ext: {
        type: "call";
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
    em_apns_ext: {
        em_push_type: "voip";
    };
    ease_chat_uikit_user_info?: {
        nickname: string;
        avatarURL: string;
    };
    callkitGroupInfo?: {
        groupId: string;
        groupName?: string;
        groupAvatar?: string;
    };
}

/**
 * SignalRouter
 * 信令消息中央路由器
 * 职责：根据 action 将消息分发给已注册的 Handler
 */
export declare class SignalRouter {
    private handlers;
    private logger;
    constructor(logger?: Logger);
    register(action: string, handler: SignalHandler): void;
    dispatch(message: CmdMsgBody): DomainEvent[];
}

/**
 * SignalSender
 * 信令发送器，封装环信 IM SDK 的消息发送。
 *
 * 由 useSignalManager 改造而来，从 Vue Composable 退化为普通类。
 */
export declare class SignalSender {
    private imClient;
    private logger;
    private createMessageFn?;
    constructor(imClient: EasemobConnection, logger?: Logger, createMessageFn?: (options: any) => any);
    /**
     * 更新底层 IM 客户端实例（用于账号切换等场景）
     */
    updateImClient(imClient: EasemobConnection): void;
    /**
     * 发送 invite 文本消息
     */
    sendInviteMessage(targetId: string | string[], chatType: 'singleChat' | 'groupChat', message: string, ext: SignalingExt | Record<string, any>, groupId?: string): Promise<any>;
    /**
     * 发送 CMD 信令消息
     */
    sendCmdMessage(targetId: string, chatType: 'singleChat' | 'groupChat', ext: SignalingExt | Record<string, any>, options?: {
        deliverOnlineOnly?: boolean;
        receiverList?: string[];
    }): Promise<any>;
    /**
     * 兼容 full 版与 miniCore 版的消息创建
     * full 版: ChatSDK.message.create(options)
     * miniCore 版: client.Message.create(options)
     */
    private createMessage;
}

export declare interface SingleCallAcceptedEvent {
    type: 'singleCallAccepted';
    payload: BaseEvent & {
        isCaller: boolean;
    };
}

export declare interface SingleCallBusyEvent {
    type: 'singleCallBusy';
    payload: BaseEvent;
}

export declare interface SingleCallCanceledEvent {
    type: 'singleCallCanceled';
    payload: BaseEvent & {
        isRemote: boolean;
    };
}

export declare interface SingleCallConnectedEvent {
    type: 'singleCallConnected';
    payload: BaseEvent;
}

export declare interface SingleCallEndedEvent {
    type: 'singleCallEnded';
    payload: BaseEvent & {
        reason: 'hangup' | 'cancel' | 'refuse' | 'busy' | 'timeout' | 'remoteHangup' | 'remoteCancel';
        duration?: number;
    };
}

export declare interface SingleCallInvitedEvent {
    type: 'singleCallInvited';
    payload: BaseEvent & {
        isCaller: boolean;
    };
}

export declare interface SingleCallRefusedEvent {
    type: 'singleCallRefused';
    payload: BaseEvent & {
        isRemote: boolean;
    };
}

/**
 * SingleCallSignalHandler
 * 单聊域信令处理器
 *
 * 改造后：
 * - 不读写 Pinia Store → 注入 SingleCallStateMachine
 * - 不直接 join RTC → 通过 StateMachine 返回 SHOULD_JOIN_RTC 事件
 * - 不直接调用 CallService.hangup() → 返回 CALL_ENDED 事件
 * - 不直接 emit callKitEventBus → 返回 DomainEvent[]
 * - 保留直接发送响应信令（confirmRing / confirmCallee）→ 注入 SignalSender
 */
export declare class SingleCallSignalHandler implements SignalHandler {
    private stateMachine;
    private sender;
    private getDeviceId;
    private logger;
    constructor(stateMachine: SingleCallStateMachine, sender: SignalSender, deviceIdProvider: (() => string) | string, logger?: Logger);
    private get deviceId();
    /**
     * 判断信令是否早于当前通话（陈旧信令防护）。
     * 离线补投的上一通信令 ts 早于当前通话 invite 的 ts，容错分支应忽略，
     * 否则旧 callId 的 cancelCall/leaveCall 会误杀同主叫快速重呼的新通话。
     */
    private isStaleSignal;
    handle(message: CmdMsgBody): DomainEvent[];
    private handleAlert;
    private buildConfirmRingPayload;
    private handleConfirmRing;
    private handleAnswerCall;
    private handleCancelCall;
    private handleLeaveCall;
    private handleConfirmCallee;
    private sendConfirmCallee;
}

export declare interface SingleCallStartedEvent {
    type: 'singleCallStarted';
    payload: BaseEvent & {
        isCaller: boolean;
        startTime: number;
    };
}

export declare interface SingleCallState {
    status: CALL_STATUS;
    callId: string;
    channel: string;
    token: string;
    type: CALL_TYPE;
    callerDevId: string;
    calleeDevId: string;
    callerUserId: string;
    calleeUserId: string;
    inviteTimeout: number;
    inviteTimeoutTimer: ReturnType<typeof setTimeout> | null;
    startTime: number | null;
    audioEnabled: boolean;
    videoEnabled: boolean;
    /** 当前通话 invite 的发送时间戳（用于容错分支丢弃早于本场通话的陈旧信令；0 = 未记录） */
    inviteTs: number;
}

/**
 * 单聊通话状态机
 *
 * 职责：
 * 1. 管理 IDLE → INVITING → ALERTING → RECEIVED_CONFIRM_RING → IN_CALL 的状态流转
 * 2. 校验 callId、deviceId、多端冲突（由 Handler 调用前预校验，状态机二次兜底）
 * 3. 管理邀请超时定时器
 * 4. 计算通话时长
 *
 * 不执行任何副作用（不发消息、不 join RTC），只返回领域事件。
 *
 * 状态流转规则从现有 lib/store/callState.ts + lib/signaling/SingleCallSignalHandler.ts 提取。
 */
export declare class SingleCallStateMachine {
    private state;
    private logger;
    constructor(logger?: Logger);
    getState(): Readonly<SingleCallState>;
    isIdle(): boolean;
    isInCall(): boolean;
    /**
     * 当前是否处于可被接听的状态（被叫端弹窗显示区间）
     */
    isWaitingCalleeAction(): boolean;
    /**
     * 当前是否处于活跃通话中（已进入 RTC 或即将进入）
     */
    isInActiveCall(): boolean;
    /**
     * 当前是否可以接听（被叫端按钮可点击）
     */
    canAccept(): boolean;
    /**
     * 当前是否可以拒绝（被叫端按钮可点击）
     */
    canReject(): boolean;
    /**
     * 当前是否可以挂断（主叫/被叫端的挂断按钮可点击）
     */
    canHangup(): boolean;
    /**
     * 当前是否处于呼叫/响铃中（主叫等待对方接听）
     */
    isCalling(): boolean;
    isCallIdMatch(incomingCallId: string): boolean;
    getDuration(): number;
    /**
     * 主叫方发起邀请
     */
    initInvite(params: {
        calleeUserId: string;
        callType: CALL_TYPE;
        callerDevId: string;
        callerUserId: string;
        callId: string;
        channel: string;
        token: string;
        timeout?: number;
        inviteTs?: number;
    }): TransitionResult;
    /**
     * 被叫方收到 invite，初始化响铃状态
     */
    initIncoming(params: {
        callId: string;
        channel: string;
        token: string;
        callType: CALL_TYPE;
        callerDevId: string;
        callerUserId: string;
        calleeDevId: string;
        calleeUserId: string;
        inviteTs?: number;
    }): TransitionResult;
    /**
     * 主叫方收到 alert（被叫已响铃）
     *
     * 与 lib 对齐：收到 alert 后保持 INVITING 状态不变（lib 的 handleAlertSignalMessage
     * 不修改 callState.status），只记录 calleeDevId 和发送 confirmRing。
     * 状态直到收到 confirmRing 后才变为 RECEIVED_CONFIRM_RING。
     */
    receiveAlert(calleeDevId: string): TransitionResult;
    /**
     * 被叫方收到 confirmRing
     */
    receiveConfirmRing(status: boolean): TransitionResult;
    /**
     * 收到 answerCall 信令
     */
    receiveAnswer(result: 'accept' | 'refuse' | 'busy', fromCaller?: boolean): TransitionResult;
    /**
     * 收到 cancelCall 信令
     *
     * 注：callId 校验和多端容错由 Handler 负责，状态机只处理匹配后的状态流转。
     */
    receiveCancel(): TransitionResult;
    /**
     * 收到 leaveCall 信令
     *
     * 注：callId 校验和多端容错由 Handler 负责，状态机只处理匹配后的状态流转。
     */
    receiveLeave(): TransitionResult;
    /**
     * 收到 confirmCallee 信令（被叫方）
     */
    receiveConfirmCallee(): TransitionResult;
    /**
     * 本地挂断/取消
     */
    hangup(reason?: string): TransitionResult;
    /**
     * 邀请超时
     */
    timeout(): TransitionResult;
    /**
     * 强制重置状态机
     */
    reset(): void;
    /**
     * 启动超时定时器。
     * 超时后自动调用 onTimeout 回调（由 CallKitCore 注册），确保事件不会被丢弃。
     */
    startTimeout(onTimeout?: (result: TransitionResult) => void): void;
    private clearTimeout;
    private resetCore;
    /**
     * 切换本地音频状态
     */
    toggleAudio(): TransitionResult;
    /**
     * 切换本地视频状态
     */
    toggleVideo(): TransitionResult;
    /**
     * 直接设置本地媒体开关状态（不产生事件）
     * 仅用于 RTC 操作失败后的状态回滚：若走 toggle* 会再次发出 LOCAL_*_CHANGED
     * 域事件，导致 adapter 被重复触发，形成"失败 → 回滚 → 再失败"循环。
     */
    setMediaEnabled(kind: 'audio' | 'video', enabled: boolean): void;
}

export declare interface SingleCallTimeoutEvent {
    type: 'singleCallTimeout';
    payload: BaseEvent;
}

export declare interface StatusChangedEvent {
    type: 'statusChanged';
    payload: BaseEvent & {
        from: string;
        to: string;
    };
}

export declare interface TransitionResult {
    ok: boolean;
    events: DomainEvent[];
}

declare type UIEvent_2 = IncomingCallEvent | CallInvitedEvent | CallStartedEvent | CallAcceptedEvent | CallConnectedEvent | CallEndedEvent | CallTimeoutEvent | StatusChangedEvent | CallRefusedEvent | CallBusyEvent | CallCanceledEvent | GroupCallInitEvent | ParticipantStateChangedEvent | ParticipantJoinedEvent | ParticipantLeftEvent | RtcReportEvent | CallDurationUpdatedEvent | CallErrorEvent | SingleCallInvitedEvent | SingleCallStartedEvent | SingleCallAcceptedEvent | SingleCallConnectedEvent | SingleCallEndedEvent | SingleCallTimeoutEvent | SingleCallRefusedEvent | SingleCallBusyEvent | SingleCallCanceledEvent | GroupCallInvitedEvent | GroupCallStartedEvent | GroupCallAcceptedEvent | GroupCallConnectedEvent | GroupCallEndedEvent | GroupCallTimeoutEvent | GroupCallRefusedEvent | GroupCallBusyEvent | GroupCallCanceledEvent;
export { UIEvent_2 as UIEvent }

export declare const VERSION: string;

export { }
