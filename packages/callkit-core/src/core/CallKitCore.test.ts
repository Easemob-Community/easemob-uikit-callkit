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

      // 验证事件
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('statusChanged')
      expect((events[0] as any).payload.to).toBe(String(CALL_STATUS.INVITING))
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
