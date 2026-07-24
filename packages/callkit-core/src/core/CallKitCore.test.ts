import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CallKitCore } from './CallKitCore'
import { CALL_STATUS, CALL_TYPE, HANGUP_REASON } from '../types/callstate.types'
import type { EasemobConnection } from './CallKitCore.types'
import type { CallKitEvent } from '../events/CallKitEvents'

// ─── Mock ───

function createMockIMClient(overrides?: Partial<EasemobConnection>): EasemobConnection {
  return {
    user: 'user_local',
    context: {
      userId: 'user_local',
      jid: { clientResource: 'dev_web' },
    },
    token: 'token_123',
    send: vi.fn().mockResolvedValue({}),
    addEventHandler: vi.fn(),
    removeEventHandler: vi.fn(),
    getRTCToken: vi.fn().mockResolvedValue({
      data: { RTCToken: 'rtc_token', appId: 'app_id', RTCUId: 123, expireIn: 86400 },
    }),
    getUserIdByRTCUIds: vi.fn().mockResolvedValue({ data: {} }),
    message: {
      create: vi.fn().mockImplementation((options: any) => ({ ...options, id: 'msg_mock' })),
    },
    ...overrides,
  } as unknown as EasemobConnection
}

function getHandlerMap(client: EasemobConnection) {
  const addHandler = (client.addEventHandler as any).mock
  return addHandler.calls[0][1]
}

function createCore(imClient?: EasemobConnection) {
  const events: CallKitEvent[] = []
  const client = imClient || createMockIMClient()
  const core = new CallKitCore({
    imClient: client,
    onEvent: (e) => events.push(e),
  })
  return { core, client, events }
}

// ─── 测试 ───

describe('CallKitCore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  describe('inviteCall', () => {
    it('主叫发起单聊 → 发送 invite 消息 + 触发 statusChanged', async () => {
      const { core, client, events } = createCore()

      await core.inviteCall({
        calleeUserId: 'user_b',
        callType: CALL_TYPE.VIDEO_1V1,
      })

      // 验证 send 被调用
      expect(client.send).toHaveBeenCalledTimes(1)

      // 验证状态
      const state = core.getSingleCallState()
      expect(state.status).toBe(CALL_STATUS.INVITING)
      expect(state.calleeUserId).toBe('user_b')
      expect(state.callId).toBeTruthy()
      expect(state.channel).toBeTruthy()

      // 验证事件：initInvite 会同时发出 statusChanged + callInvited + singleCallInvited
      expect(events.filter((e) => e.type === 'statusChanged')).toHaveLength(1)
      const statusEvent = events.find((e) => e.type === 'statusChanged')!
      expect((statusEvent as any).payload.to).toBe(String(CALL_STATUS.INVITING))
      expect(events.filter((e) => e.type === 'callInvited')).toHaveLength(1)
      expect(events.filter((e) => e.type === 'singleCallInvited')).toHaveLength(1)
    })
  })

  describe('handleTextMessage — 单聊 invite', () => {
    it('被叫收到 invite → 触发 incomingCall + statusChanged', async () => {
      const { core, client, events } = createCore()

      const handlerMap = getHandlerMap(client)
      await handlerMap.onTextMessage({
        from: 'user_a',
        id: 'msg_1',
        ext: {
          action: 'invite',
          callId: 'call_abc',
          callerIMName: 'user_a',
          calleeIMName: 'user_local',
          callerDevId: 'dev_a',
          channelName: 'ch_001',
          type: CALL_TYPE.VIDEO_1V1,
          chatType: CALL_TYPE.VIDEO_1V1,
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })

      // 验证事件
      const incomingEvents = events.filter((e) => e.type === 'incomingCall')
      expect(incomingEvents).toHaveLength(1)
      expect((incomingEvents[0] as any).payload.callerUserId).toBe('user_a')

      const statusEvents = events.filter((e) => e.type === 'statusChanged')
      expect(statusEvents).toHaveLength(1)
      expect((statusEvents[0] as any).payload.to).toBe(String(CALL_STATUS.ALERTING))

      // 验证状态
      const state = core.getSingleCallState()
      expect(state.status).toBe(CALL_STATUS.ALERTING)
      expect(state.callerUserId).toBe('user_a')
    })
  })

  describe('handleCmdMessage — alert', () => {
    it('主叫收到 alert → 发送 confirmRing + 状态变为 ALERTING', async () => {
      const { core, client, events } = createCore()

      // 先发起邀请
      await core.inviteCall({
        calleeUserId: 'user_b',
        callType: CALL_TYPE.VIDEO_1V1,
      })
      events.length = 0 // 清空事件

      const handlerMap = getHandlerMap(client)
      const state = core.getSingleCallState()

      await handlerMap.onCmdMessage({
        action: 'rtcCall',
        from: 'user_b',
        ext: {
          action: 'alert',
          callId: state.callId,
          callerDevId: state.callerDevId,
          calleeDevId: 'dev_b',
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })

      // 验证 confirmRing 已发送
      expect(client.send).toHaveBeenCalledTimes(2) // invite + confirmRing

      // 验证事件（alert 保持 INVITING，不触发 statusChanged）
      expect(events).toHaveLength(0)
    })
  })

  describe('handleCmdMessage — answerCall accept', () => {
    it('主叫收到 accept → 发送 confirmCallee + IN_CALL + SHOULD_JOIN_RTC', async () => {
      const { core, client, events } = createCore()

      await core.inviteCall({ calleeUserId: 'user_b', callType: CALL_TYPE.VIDEO_1V1 })
      events.length = 0

      const state = core.getSingleCallState()
      const handlerMap = getHandlerMap(client)

      await handlerMap.onCmdMessage({
        action: 'rtcCall',
        from: 'user_b',
        ext: {
          action: 'answerCall',
          callId: state.callId,
          callerDevId: state.callerDevId,
          calleeDevId: 'dev_b',
          result: 'accept',
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })

      // 验证 confirmCallee 已发送
      expect(client.send).toHaveBeenCalledTimes(2)

      // 验证事件（生命周期事件会同时发出通用 + 精确事件）
      expect(events.filter((e) => e.type === 'statusChanged')).toHaveLength(1)
      expect(events.filter((e) => e.type === 'callAccepted')).toHaveLength(1)
      expect(events.filter((e) => e.type === 'singleCallAccepted')).toHaveLength(1)
      expect(events.filter((e) => e.type === 'callStarted')).toHaveLength(1)
      expect(events.filter((e) => e.type === 'singleCallStarted')).toHaveLength(1)
      const shouldJoinRtcEvents = events.filter((e) => e.type === 'shouldJoinRtc')
      expect(shouldJoinRtcEvents).toHaveLength(1)
      expect((shouldJoinRtcEvents[0] as any).payload.role).toBe('caller')
    })
  })

  describe('handleCmdMessage — answerCall refuse', () => {
    it('主叫收到 refuse → 发送 confirmCallee + CALL_REFUSED + CALL_ENDED', async () => {
      const { core, client, events } = createCore()

      await core.inviteCall({ calleeUserId: 'user_b', callType: CALL_TYPE.VIDEO_1V1 })
      events.length = 0

      const state = core.getSingleCallState()
      const handlerMap = getHandlerMap(client)

      await handlerMap.onCmdMessage({
        action: 'rtcCall',
        from: 'user_b',
        ext: {
          action: 'answerCall',
          callId: state.callId,
          callerDevId: state.callerDevId,
          calleeDevId: 'dev_b',
          result: 'refuse',
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })

      expect(client.send).toHaveBeenCalledTimes(2)

      expect(events.filter((e) => e.type === 'callRefused')).toHaveLength(1)
      expect(events.filter((e) => e.type === 'singleCallRefused')).toHaveLength(1)
      const callEndedEvents = events.filter((e) => e.type === 'callEnded')
      expect(callEndedEvents).toHaveLength(1)
      expect(events.filter((e) => e.type === 'singleCallEnded')).toHaveLength(1)
      expect((callEndedEvents[0] as any).payload.reason).toBe(HANGUP_REASON.REMOTE_REFUSE)
    })
  })

  describe('answerCall — 被叫接受', () => {
    it('被叫发送 answerCall accept → 等待 confirmCallee', async () => {
      const { core, client, events } = createCore()

      const handlerMap = getHandlerMap(client)
      await handlerMap.onTextMessage({
        from: 'user_a',
        id: 'msg_1',
        ext: {
          action: 'invite',
          callId: 'call_abc',
          callerIMName: 'user_a',
          calleeIMName: 'user_local',
          callerDevId: 'dev_a',
          channelName: 'ch_001',
          type: CALL_TYPE.VIDEO_1V1,
          chatType: CALL_TYPE.VIDEO_1V1,
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })
      events.length = 0
      ;(client.send as any).mockClear()

      await core.answerCall({ callId: 'call_abc', accept: true })

      // 验证 answerCall 已发送（被叫方收到 invite 后已发送 alert，此处只验证 answerCall）
      expect(client.send).toHaveBeenCalledTimes(1)
      const lastSendCall = (client.send as any).mock.calls.at(-1)
      const sentMsg = lastSendCall[0]
      expect(sentMsg.ext.action).toBe('answerCall')
      expect(sentMsg.ext.result).toBe('accept')

      // 被叫接受后，状态保持 ALERTING
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.ALERTING)
    })
  })

  describe('answerCall — 被叫拒绝', () => {
    it('被叫发送 answerCall refuse → 本地挂断 + CALL_ENDED', async () => {
      const { core, client, events } = createCore()

      const handlerMap = getHandlerMap(client)
      await handlerMap.onTextMessage({
        from: 'user_a',
        id: 'msg_1',
        ext: {
          action: 'invite',
          callId: 'call_abc',
          callerIMName: 'user_a',
          calleeIMName: 'user_local',
          callerDevId: 'dev_a',
          channelName: 'ch_001',
          type: CALL_TYPE.VIDEO_1V1,
          chatType: CALL_TYPE.VIDEO_1V1,
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })
      events.length = 0
      ;(client.send as any).mockClear()

      await core.answerCall({ callId: 'call_abc', accept: false })

      // 被叫方收到 invite 后已发送 alert，此处只验证 answerCall
      expect(client.send).toHaveBeenCalledTimes(1)
      const lastSendCall = (client.send as any).mock.calls.at(-1)
      expect(lastSendCall[0].ext.result).toBe('refuse')

      const callEndedEvents = events.filter((e) => e.type === 'callEnded')
      expect(callEndedEvents).toHaveLength(1)
      expect(events.filter((e) => e.type === 'singleCallEnded')).toHaveLength(1)
      expect((callEndedEvents[0] as any).payload.reason).toBe(HANGUP_REASON.REFUSE)
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.IDLE)
    })
  })

  describe('离线补投乱序与 confirmCallee 超时', () => {
    const buildInviteMsg = (callId: string) => ({
      from: 'user_a',
      id: 'msg_1',
      ext: {
        action: 'invite',
        callId,
        callerIMName: 'user_a',
        calleeIMName: 'user_local',
        callerDevId: 'dev_a',
        channelName: 'ch_001',
        type: CALL_TYPE.VIDEO_1V1,
        chatType: CALL_TYPE.VIDEO_1V1,
        ts: Date.now(),
        msgType: 'rtcCallWithAgora',
      },
    })

    it('cancelCall 先于 invite 到达（离线补投乱序）→ invite 被丢弃，不弹来电', async () => {
      const { core, client, events } = createCore()
      const handlerMap = getHandlerMap(client)

      // cancelCall 先到：状态机 IDLE、callId 不匹配，按现有逻辑忽略，但应记入取消名单
      await handlerMap.onCmdMessage({
        action: 'rtcCall',
        from: 'user_a',
        ext: {
          action: 'cancelCall',
          callId: 'call_dead',
          callerDevId: 'dev_a',
          calleeDevId: 'dev_web',
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })

      // 同 callId 的 invite 补投到达
      await handlerMap.onTextMessage(buildInviteMsg('call_dead'))

      // 不弹来电、状态机保持 IDLE、不回发 alert
      expect(events.filter((e) => e.type === 'incomingCall')).toHaveLength(0)
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.IDLE)
      expect(client.send).not.toHaveBeenCalled()
    })

    it('取消名单过期后，同 callId 的 invite 可正常处理', async () => {
      const { core, client, events } = createCore()
      const handlerMap = getHandlerMap(client)

      await handlerMap.onCmdMessage({
        action: 'rtcCall',
        from: 'user_a',
        ext: {
          action: 'cancelCall',
          callId: 'call_dead',
          callerDevId: 'dev_a',
          calleeDevId: 'dev_web',
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })

      // 推进超过名单 TTL（inviteTimeout 30s + 10s）
      await vi.advanceTimersByTimeAsync(41000)

      await handlerMap.onTextMessage(buildInviteMsg('call_dead'))

      expect(events.filter((e) => e.type === 'incomingCall')).toHaveLength(1)
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.ALERTING)
    })

    it('被叫 accept 后 confirmCallee 永不到达 → 10s 超时回收状态机', async () => {
      const { core, client, events } = createCore()
      const handlerMap = getHandlerMap(client)

      await handlerMap.onTextMessage(buildInviteMsg('call_abc'))
      await core.answerCall({ callId: 'call_abc', accept: true })
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.ALERTING)

      events.length = 0
      await vi.advanceTimersByTimeAsync(10000)

      expect(core.getSingleCallState().status).toBe(CALL_STATUS.IDLE)
      expect(events.filter((e) => e.type === 'callTimeout')).toHaveLength(1)
      const callEndedEvents = events.filter((e) => e.type === 'callEnded')
      expect(callEndedEvents).toHaveLength(1)
      expect((callEndedEvents[0] as any).payload.reason).toBe(HANGUP_REASON.NO_RESPONSE)
    })

    it('被叫 accept 后 confirmCallee 正常到达 → 清除等待超时，不误杀', async () => {
      const { core, client, events } = createCore()
      const handlerMap = getHandlerMap(client)

      await handlerMap.onTextMessage(buildInviteMsg('call_abc'))
      await core.answerCall({ callId: 'call_abc', accept: true })

      await handlerMap.onCmdMessage({
        action: 'rtcCall',
        from: 'user_a',
        ext: {
          action: 'confirmCallee',
          callId: 'call_abc',
          callerDevId: 'dev_a',
          calleeDevId: 'dev_web',
          result: 'accept',
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.IN_CALL)

      // 推进超过 confirmCallee 等待超时，通话不应被回收
      events.length = 0
      await vi.advanceTimersByTimeAsync(10000)
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.IN_CALL)
      expect(events.filter((e) => e.type === 'callEnded')).toHaveLength(0)
    })

    it('H4: confirmCallee calleeDevId 不匹配 → 不进入 IN_CALL（防多端幽灵接听）', async () => {
      const { core, client } = createCore()
      const handlerMap = getHandlerMap(client)

      await handlerMap.onTextMessage(buildInviteMsg('call_abc'))
      await core.answerCall({ callId: 'call_abc', accept: true })

      // 发给本用户但 calleeDevId 是另一台设备（主叫回给设备 A，本机是设备 B）
      await handlerMap.onCmdMessage({
        action: 'rtcCall',
        from: 'user_a',
        ext: {
          action: 'confirmCallee',
          callId: 'call_abc',
          callerDevId: 'dev_a',
          calleeDevId: 'dev_other',
          result: 'accept',
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.ALERTING)

      // calleeDevId 匹配本机（dev_web）才放行
      await handlerMap.onCmdMessage({
        action: 'rtcCall',
        from: 'user_a',
        ext: {
          action: 'confirmCallee',
          callId: 'call_abc',
          callerDevId: 'dev_a',
          calleeDevId: 'dev_web',
          result: 'accept',
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.IN_CALL)
    })

    it('H5: 单聊 invite 获取 token 期间收到 cancelCall → 不弹来电', async () => {
      let resolveToken!: (v: any) => void
      const client = createMockIMClient({
        getRTCToken: vi.fn().mockImplementation(
          () => new Promise((r) => { resolveToken = r })
        ),
      })
      const events: CallKitEvent[] = []
      const core = new CallKitCore({ imClient: client, onEvent: (e) => events.push(e) })
      const handlerMap = getHandlerMap(client)

      // invite 到达（不 await，让其停在 fetchRtcToken 的等待上）
      const invitePromise = handlerMap.onTextMessage(buildInviteMsg('call_x'))

      // token 请求期间 cancelCall 到达
      await handlerMap.onCmdMessage({
        action: 'rtcCall',
        from: 'user_a',
        ext: {
          action: 'cancelCall',
          callId: 'call_x',
          callerDevId: 'dev_a',
          calleeDevId: 'dev_web',
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })

      resolveToken({ data: { RTCToken: 't', appId: 'a', RTCUId: 1 } })
      await invitePromise

      expect(events.filter((e) => e.type === 'incomingCall')).toHaveLength(0)
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.IDLE)
    })

    it('M2: IN_CALL 中 callId 不匹配的 leaveCall，仅对端发送才挂断', async () => {
      const { core, client, events } = createCore()
      const handlerMap = getHandlerMap(client)

      // 主叫流程进入 IN_CALL
      await core.inviteCall({ calleeUserId: 'user_b', callType: CALL_TYPE.VIDEO_1V1 })
      const state = core.getSingleCallState()
      await handlerMap.onCmdMessage({
        action: 'rtcCall',
        from: 'user_b',
        ext: {
          action: 'answerCall',
          callId: state.callId,
          callerDevId: state.callerDevId,
          calleeDevId: 'dev_b',
          result: 'accept',
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.IN_CALL)

      // 陌生人发送的 leaveCall（伪造/无关）→ 不挂断
      await handlerMap.onCmdMessage({
        action: 'rtcCall',
        from: 'stranger',
        ext: {
          action: 'leaveCall',
          callId: 'call_unknown',
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.IN_CALL)

      // 对端发送的 leaveCall（callId 不匹配容错）→ 挂断
      events.length = 0
      await handlerMap.onCmdMessage({
        action: 'rtcCall',
        from: 'user_b',
        ext: {
          action: 'leaveCall',
          callId: 'call_unknown',
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })
      expect(events.filter((e) => e.type === 'callEnded')).toHaveLength(1)
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.IDLE)
    })

    it('M3: 陈旧 cancelCall（ts 早于当前通话 invite）不误杀新通话', async () => {
      const { core, client, events } = createCore()
      const handlerMap = getHandlerMap(client)

      // 被叫收到新 invite（inviteTs = Date.now()）
      await handlerMap.onTextMessage(buildInviteMsg('call_new'))
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.ALERTING)

      // 上一通的 cancelCall 补投到达：callId 不匹配、来自主叫，但 ts 早于当前 invite
      await handlerMap.onCmdMessage({
        action: 'rtcCall',
        from: 'user_a',
        ext: {
          action: 'cancelCall',
          callId: 'call_old',
          callerDevId: 'dev_a',
          ts: Date.now() - 1000,
          msgType: 'rtcCallWithAgora',
        },
      })
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.ALERTING)
      expect(events.filter((e) => e.type === 'callEnded')).toHaveLength(0)

      // ts 新鲜的 cancelCall（callId 不匹配容错）→ 正常挂断
      await handlerMap.onCmdMessage({
        action: 'rtcCall',
        from: 'user_a',
        ext: {
          action: 'cancelCall',
          callId: 'call_old_2',
          callerDevId: 'dev_a',
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.IDLE)
    })
  })

  describe('hangup', () => {
    it('主叫 INVITING 时 hangup → 发送 cancelCall + CALL_ENDED', async () => {
      const { core, client, events } = createCore()
      await core.inviteCall({ calleeUserId: 'user_b', callType: CALL_TYPE.VIDEO_1V1 })
      events.length = 0

      await core.hangup()

      // 验证 cancelCall 已发送（通过检查 send 被额外调用一次）
      expect(client.send).toHaveBeenCalledTimes(2)

      expect(events.filter((e) => e.type === 'callEnded')).toHaveLength(1)
      expect(events.filter((e) => e.type === 'singleCallEnded')).toHaveLength(1)
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.IDLE)
    })

    it('通话中 hangup → 发送 leaveCall + CALL_ENDED', async () => {
      const { core, client, events } = createCore()

      await core.inviteCall({ calleeUserId: 'user_b', callType: CALL_TYPE.VIDEO_1V1 })

      const handlerMap = getHandlerMap(client)
      const state = core.getSingleCallState()

      // 收到 accept 进入 IN_CALL
      await handlerMap.onCmdMessage({
        action: 'rtcCall',
        from: 'user_b',
        ext: {
          action: 'answerCall',
          callId: state.callId,
          callerDevId: state.callerDevId,
          calleeDevId: 'dev_b',
          result: 'accept',
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })
      events.length = 0

      vi.advanceTimersByTime(5000)

      await core.hangup()

      // 验证 leaveCall 已发送
      expect(client.send).toHaveBeenCalledTimes(3)

      const callEndedEvents = events.filter((e) => e.type === 'callEnded')
      expect(callEndedEvents).toHaveLength(1)
      expect(events.filter((e) => e.type === 'singleCallEnded')).toHaveLength(1)
      expect((callEndedEvents[0] as any).payload.duration).toBeGreaterThanOrEqual(5000)
    })
  })

  describe('handleCmdMessage — cancelCall', () => {
    it('被叫收到 cancelCall → CALL_CANCELED + CALL_ENDED', async () => {
      const { core, client, events } = createCore()

      const handlerMap = getHandlerMap(client)
      await handlerMap.onTextMessage({
        from: 'user_a',
        id: 'msg_1',
        ext: {
          action: 'invite',
          callId: 'call_abc',
          callerIMName: 'user_a',
          calleeIMName: 'user_local',
          callerDevId: 'dev_a',
          channelName: 'ch_001',
          type: CALL_TYPE.VIDEO_1V1,
          chatType: CALL_TYPE.VIDEO_1V1,
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })
      events.length = 0

      await handlerMap.onCmdMessage({
        action: 'rtcCall',
        from: 'user_a',
        ext: {
          action: 'cancelCall',
          callId: 'call_abc',
          callerDevId: 'dev_a',
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })

      expect(events.filter((e) => e.type === 'callCanceled')).toHaveLength(1)
      expect(events.filter((e) => e.type === 'singleCallCanceled')).toHaveLength(1)
      expect(events.filter((e) => e.type === 'callEnded')).toHaveLength(1)
      expect(events.filter((e) => e.type === 'singleCallEnded')).toHaveLength(1)
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.IDLE)
    })
  })

  describe('handleCmdMessage — confirmCallee', () => {
    it('被叫收到 confirmCallee → IN_CALL + CALL_STARTED + SHOULD_JOIN_RTC', async () => {
      const { core, client, events } = createCore()

      const handlerMap = getHandlerMap(client)
      await handlerMap.onTextMessage({
        from: 'user_a',
        id: 'msg_1',
        ext: {
          action: 'invite',
          callId: 'call_abc',
          callerIMName: 'user_a',
          calleeIMName: 'user_local',
          callerDevId: 'dev_a',
          channelName: 'ch_001',
          type: CALL_TYPE.VIDEO_1V1,
          chatType: CALL_TYPE.VIDEO_1V1,
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })
      events.length = 0

      await handlerMap.onCmdMessage({
        action: 'rtcCall',
        from: 'user_a',
        ext: {
          action: 'confirmCallee',
          callId: 'call_abc',
          callerDevId: 'dev_a',
          calleeDevId: 'dev_web',
          result: 'accept',
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })

      expect(events.filter((e) => e.type === 'statusChanged')).toHaveLength(1)
      expect(events.filter((e) => e.type === 'callConnected')).toHaveLength(1)
      expect(events.filter((e) => e.type === 'singleCallConnected')).toHaveLength(1)
      const callStartedEvents = events.filter((e) => e.type === 'callStarted')
      expect(callStartedEvents).toHaveLength(1)
      expect(events.filter((e) => e.type === 'singleCallStarted')).toHaveLength(1)
      expect((callStartedEvents[0] as any).payload.isCaller).toBe(false)
      const shouldJoinRtcEvents = events.filter((e) => e.type === 'shouldJoinRtc')
      expect(shouldJoinRtcEvents).toHaveLength(1)
      expect((shouldJoinRtcEvents[0] as any).payload.role).toBe('callee')
    })
  })

  describe('inviteGroupCall', () => {
    it('发起群聊通话 → groupCallInit + statusChanged + IN_CALL + shouldJoinRtc', async () => {
      const { core, client, events } = createCore()

      await core.inviteGroupCall({
        groupId: 'group_001',
        participantIds: ['user_1', 'user_2'],
        callType: CALL_TYPE.VIDEO_MULTI,
      })

      // 验证 send 被调用
      expect(client.send).toHaveBeenCalledTimes(1)

      // 验证状态（群聊主叫方发 invite 后立即进入 IN_CALL）
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.IN_CALL)
      expect(core.getGroupCallSession()?.groupId).toBe('group_001')

      // 验证事件：groupCallInit + statusChanged(INVITING) + statusChanged(IN_CALL) + callAccepted + callStarted + shouldJoinRtc
      expect(events.length).toBeGreaterThanOrEqual(4)
      expect(events.some((e) => e.type === 'groupCallInit')).toBe(true)
      expect(events.some((e) => e.type === 'statusChanged')).toBe(true)
      expect(events.some((e) => e.type === 'shouldJoinRtc')).toBe(true)
    })
  })

  describe('群聊 invite 文本消息', () => {
    it('收到群聊 invite → groupCallInit 事件', async () => {
      const { core, client, events } = createCore()

      const handlerMap = getHandlerMap(client)
      await handlerMap.onTextMessage({
        from: 'user_caller',
        id: 'msg_1',
        ext: {
          action: 'invite',
          callId: 'call_group_001',
          callerIMName: 'user_caller',
          channelName: 'ch_group',
          type: CALL_TYPE.VIDEO_MULTI,
          chatType: CALL_TYPE.VIDEO_MULTI,
          invitedMembers: ['user_1', 'user_local'],
          callkitGroupInfo: {
            groupId: 'group_001',
            groupName: 'Test Group',
          },
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })

      const groupInitEvents = events.filter((e) => e.type === 'groupCallInit')
      expect(groupInitEvents).toHaveLength(1)
      expect((groupInitEvents[0] as any).payload.groupId).toBe('group_001')
      expect((groupInitEvents[0] as any).payload.invitedMembers).toContain('user_local')

      // 验证 session 已初始化
      const session = core.getGroupCallSession()
      expect(session).not.toBeNull()
      expect(session!.groupId).toBe('group_001')
    })

    const buildGroupInviteMsg = (callId: string) => ({
      from: 'user_caller',
      id: 'msg_g1',
      ext: {
        action: 'invite',
        callId,
        callerIMName: 'user_caller',
        channelName: 'ch_group',
        type: CALL_TYPE.VIDEO_MULTI,
        chatType: CALL_TYPE.VIDEO_MULTI,
        invitedMembers: ['user_1', 'user_local'],
        callkitGroupInfo: { groupId: 'group_001', groupName: 'Test Group' },
        ts: Date.now(),
        msgType: 'rtcCallWithAgora',
      },
    })

    /** 群聊被叫进入 IN_CALL */
    const joinGroupCallAsInCall = async (core: any, client: any, callId: string) => {
      const handlerMap = getHandlerMap(client)
      await handlerMap.onTextMessage(buildGroupInviteMsg(callId))
      await core.answerCall({ callId, accept: true })
      await handlerMap.onCmdMessage({
        action: 'rtcCall',
        from: 'user_caller',
        ext: {
          action: 'confirmCallee',
          callId,
          callerDevId: 'dev_caller',
          calleeDevId: 'dev_web',
          result: 'accept',
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })
    }

    it('H1: 群聊 IN_CALL 中收到 callId 匹配的 cancelCall → 不误杀群通话', async () => {
      const { core, client, events } = createCore()
      const handlerMap = getHandlerMap(client)

      await joinGroupCallAsInCall(core, client, 'call_group_x')
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.IN_CALL)

      events.length = 0
      await handlerMap.onCmdMessage({
        action: 'rtcCall',
        from: 'user_caller',
        ext: {
          action: 'cancelCall',
          callId: 'call_group_x',
          callerDevId: 'dev_caller',
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })

      expect(core.getSingleCallState().status).toBe(CALL_STATUS.IN_CALL)
      expect(events.filter((e) => e.type === 'callEnded')).toHaveLength(0)
    })

    it('H2: 通话中收到同 callId 重复 invite → 忽略，不回 busy、不移除成员', async () => {
      const { core, client, events } = createCore()
      const handlerMap = getHandlerMap(client)

      await joinGroupCallAsInCall(core, client, 'call_group_y')
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.IN_CALL)

      events.length = 0
      ;(client.send as any).mockClear()

      // 主叫"添加成员"重复邀请已在通话中的本机（同 callId）
      await handlerMap.onTextMessage(buildGroupInviteMsg('call_group_y'))

      expect(core.getSingleCallState().status).toBe(CALL_STATUS.IN_CALL)
      expect(client.send).not.toHaveBeenCalled()
      expect(events.filter((e) => e.type === 'participantLeft')).toHaveLength(0)
    })
  })

  describe('toggleAudio / toggleVideo', () => {
    it('toggleAudio → 触发 localAudioChanged 事件', () => {
      const { core, events } = createCore()

      // 使用内部状态机直接设置状态
      core['singleCallState']['state'].status = CALL_STATUS.IN_CALL
      core['singleCallState']['state'].callId = 'call_test'

      events.length = 0
      core.toggleAudio()

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('localAudioChanged')
      expect((events[0] as any).payload.enabled).toBe(false)

      core.toggleAudio()
      expect(events).toHaveLength(2)
      expect((events[1] as any).payload.enabled).toBe(true)
    })

    it('toggleVideo → 触发 localVideoChanged 事件', () => {
      const { core, events } = createCore()

      core['singleCallState']['state'].status = CALL_STATUS.IN_CALL
      core['singleCallState']['state'].callId = 'call_test'

      events.length = 0
      core.toggleVideo()

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('localVideoChanged')
      expect((events[0] as any).payload.enabled).toBe(false)
    })
  })

  describe('rtcAdapter 自动调用', () => {
    it('shouldJoinRtc 时自动调用 rtcAdapter.joinChannel', async () => {
      const mockAdapter = {
        joinChannel: vi.fn().mockResolvedValue(undefined),
        leaveChannel: vi.fn().mockResolvedValue(undefined),
        publishLocalTracks: vi.fn().mockResolvedValue(undefined),
        unpublishLocalTracks: vi.fn().mockResolvedValue(undefined),
        subscribeRemoteUser: vi.fn().mockResolvedValue(undefined),
        unsubscribeRemoteUser: vi.fn().mockResolvedValue(undefined),
        setAudioEnabled: vi.fn().mockResolvedValue(undefined),
        setVideoEnabled: vi.fn().mockResolvedValue(undefined),
      }

      const client = createMockIMClient()
      const adapterCore = new CallKitCore({
        imClient: client,
        onEvent: () => {},
        rtcAdapter: mockAdapter as any,
      })

      await adapterCore.inviteCall({ calleeUserId: 'user_b', callType: CALL_TYPE.VIDEO_1V1 })

      // 模拟收到 accept，触发 shouldJoinRtc
      const handlerMap = getHandlerMap(client)
      const state = adapterCore.getSingleCallState()
      await handlerMap.onCmdMessage({
        action: 'rtcCall',
        from: 'user_b',
        ext: {
          action: 'answerCall',
          callId: state.callId,
          callerDevId: state.callerDevId,
          calleeDevId: 'dev_b',
          result: 'accept',
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        },
      })

      expect(mockAdapter.joinChannel).toHaveBeenCalledTimes(1)
      const joinArgs = mockAdapter.joinChannel.mock.calls[0][0]
      expect(joinArgs.channel).toBe(state.channel)
      expect(joinArgs.token).toBe(state.token)
    })

    it('toggleAudio 时自动调用 rtcAdapter.setAudioEnabled', () => {
      const mockAdapter = {
        joinChannel: vi.fn().mockResolvedValue(undefined),
        leaveChannel: vi.fn().mockResolvedValue(undefined),
        publishLocalTracks: vi.fn().mockResolvedValue(undefined),
        unpublishLocalTracks: vi.fn().mockResolvedValue(undefined),
        subscribeRemoteUser: vi.fn().mockResolvedValue(undefined),
        unsubscribeRemoteUser: vi.fn().mockResolvedValue(undefined),
        setAudioEnabled: vi.fn().mockResolvedValue(undefined),
        setVideoEnabled: vi.fn().mockResolvedValue(undefined),
      }

      const client = createMockIMClient()
      const adapterCore = new CallKitCore({
        imClient: client,
        onEvent: () => {},
        rtcAdapter: mockAdapter as any,
      })

      adapterCore['singleCallState']['state'].status = CALL_STATUS.IN_CALL
      adapterCore['singleCallState']['state'].callId = 'call_test'

      adapterCore.toggleAudio()

      expect(mockAdapter.setAudioEnabled).toHaveBeenCalledTimes(1)
      expect(mockAdapter.setAudioEnabled).toHaveBeenCalledWith(false)
    })

    it('setVideoEnabled 失败 → 状态机回滚且不重复触发 adapter（防循环）', async () => {
      const mockAdapter = {
        joinChannel: vi.fn().mockResolvedValue(undefined),
        leaveChannel: vi.fn().mockResolvedValue(undefined),
        publishLocalTracks: vi.fn().mockResolvedValue(undefined),
        unpublishLocalTracks: vi.fn().mockResolvedValue(undefined),
        subscribeRemoteUser: vi.fn().mockResolvedValue(undefined),
        unsubscribeRemoteUser: vi.fn().mockResolvedValue(undefined),
        setAudioEnabled: vi.fn().mockResolvedValue(undefined),
        setVideoEnabled: vi.fn().mockRejectedValue(new Error('publish failed')),
      }

      const client = createMockIMClient()
      const events: CallKitEvent[] = []
      const adapterCore = new CallKitCore({
        imClient: client,
        onEvent: (e) => events.push(e),
        rtcAdapter: mockAdapter as any,
      })

      adapterCore['singleCallState']['state'].status = CALL_STATUS.IN_CALL
      adapterCore['singleCallState']['state'].callId = 'call_test'

      events.length = 0
      adapterCore.toggleVideo()

      // 等待 adapter promise reject 后的回滚逻辑执行（fake timers 下推进 0ms 并 flush 微任务）
      await vi.advanceTimersByTimeAsync(0)

      // adapter 只被调用一次：回滚走 setMediaEnabled 静默改状态，不再触发 adapter
      expect(mockAdapter.setVideoEnabled).toHaveBeenCalledTimes(1)
      expect(mockAdapter.setVideoEnabled).toHaveBeenCalledWith(false)

      // 状态机已回滚为原值（true）
      expect(adapterCore.getSingleCallState().videoEnabled).toBe(true)

      // UI 层收到：localVideoChanged(false) → callError → localVideoChanged(true 回滚)
      const videoEvents = events.filter((e) => e.type === 'localVideoChanged')
      expect(videoEvents).toHaveLength(2)
      expect((videoEvents[0] as any).payload.enabled).toBe(false)
      expect((videoEvents[1] as any).payload.enabled).toBe(true)
      expect(events.some((e) => e.type === 'callError')).toBe(true)
    })

    it('setAudioEnabled 失败 → 状态机回滚', async () => {
      const mockAdapter = {
        joinChannel: vi.fn().mockResolvedValue(undefined),
        leaveChannel: vi.fn().mockResolvedValue(undefined),
        publishLocalTracks: vi.fn().mockResolvedValue(undefined),
        unpublishLocalTracks: vi.fn().mockResolvedValue(undefined),
        subscribeRemoteUser: vi.fn().mockResolvedValue(undefined),
        unsubscribeRemoteUser: vi.fn().mockResolvedValue(undefined),
        setAudioEnabled: vi.fn().mockRejectedValue(new Error('setEnabled failed')),
        setVideoEnabled: vi.fn().mockResolvedValue(undefined),
      }

      const client = createMockIMClient()
      const events: CallKitEvent[] = []
      const adapterCore = new CallKitCore({
        imClient: client,
        onEvent: (e) => events.push(e),
        rtcAdapter: mockAdapter as any,
      })

      adapterCore['singleCallState']['state'].status = CALL_STATUS.IN_CALL
      adapterCore['singleCallState']['state'].callId = 'call_test'

      events.length = 0
      adapterCore.toggleAudio()

      await vi.advanceTimersByTimeAsync(0)

      expect(mockAdapter.setAudioEnabled).toHaveBeenCalledTimes(1)
      expect(adapterCore.getSingleCallState().audioEnabled).toBe(true)

      const audioEvents = events.filter((e) => e.type === 'localAudioChanged')
      expect(audioEvents).toHaveLength(2)
      expect((audioEvents[1] as any).payload.enabled).toBe(true)
    })
  })

  describe('destroy', () => {
    it('销毁后清理监听和状态', async () => {
      const { core, client } = createCore()

      await core.inviteCall({ calleeUserId: 'user_b', callType: CALL_TYPE.VIDEO_1V1 })
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.INVITING)

      await core.destroy()

      expect(client.removeEventHandler).toHaveBeenCalledTimes(1)
      expect(core.getSingleCallState().status).toBe(CALL_STATUS.IDLE)
    })
  })
})
