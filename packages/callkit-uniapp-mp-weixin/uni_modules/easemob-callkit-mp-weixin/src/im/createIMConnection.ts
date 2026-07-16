import SDK from 'easemob-websdk/uniApp/Easemob-chat'
import { getIMConfig, type IMConfig } from './IMConfig'

/**
 * 创建环信 IM 连接实例
 */
export function createIMConnection(config: IMConfig) {
  const WebIM = (uni.WebIM = SDK)
  const conn = new WebIM.connection({
    ...getIMConfig(config),
    appKey: config.appKey
  })

  return conn
}

export type IMConnection = ReturnType<typeof createIMConnection>
