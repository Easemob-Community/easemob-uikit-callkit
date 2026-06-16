# @easemob-community/callkit-core

框架无关的通话信令核心库，仅依赖环信 IM SDK 作为信令通道，RTC 层通过抽象接口由上层自行接入。

## 安装

```bash
npm install @easemob-community/callkit-core
```

## 快速开始

```typescript
import { CallKitCore, CALL_STATUS, CALL_TYPE } from '@easemob-community/callkit-core'

const core = new CallKitCore({
  imClient: conn,        // 环信 IM SDK 连接实例
  inviteTimeout: 30000,  // 邀请超时时间（毫秒）
  onEvent: (event) => {
    console.log('事件:', event.type, event.payload)
  }
})

// 发起单聊通话
await core.inviteCall({
  calleeUserId: 'user123',
  callType: CALL_TYPE.VIDEO_1V1
})
```

## 核心概念

- **CallKitCore**：核心控制器，管理单聊和群聊的信令生命周期
- **SingleCallStateMachine**：单聊状态机，处理 INVITING → ALERTING → IN_CALL → IDLE 的状态流转
- **GroupCallSession**：群聊会话管理，跟踪参与者状态和会话元数据
- **SignalRouter**：信令路由器，将 IM 消息分发给对应的处理器
- **EventBus**：事件总线，所有状态变更和信令事件通过事件通知上层

## 文档导航

- [架构说明](./architecture.md) — 模块设计、状态机、信令路由
- [信令交互](./signaling.md) — 消息格式、交互流程、超时处理
- [RTC 接入](./integration.md) — 如何实现 RtcAdapter 接入 Agora 等 RTC SDK
- [事件参考](./events.md) — 完整事件类型、payload 结构、使用示例
- [API 参考](./api/) — TypeDoc 自动生成的完整 API 文档

## 平台支持

| 平台 | 状态 |
|------|------|
| Web (Vue3/React/Angular) | 已支持 |
| UniApp | 计划中 |
| 小程序 | 计划中 |

## License

MIT
