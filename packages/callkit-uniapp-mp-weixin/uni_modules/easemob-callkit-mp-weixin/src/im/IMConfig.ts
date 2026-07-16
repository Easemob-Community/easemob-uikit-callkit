/**
 * 环信 IM 数据中心配置
 */

export interface IMDataCenterConfig {
  url: string
  apiUrl: string
}

export const IM_DATA_CENTER: Record<string, IMDataCenterConfig> = {
  cn1: {
    url: 'wss://im-api-wechat.easemob.com/websocket',
    apiUrl: 'https://a1.easemob.com'
  },
  cn2: {
    url: 'wss://ngi-im-api-wechat.easemob.com/websocket',
    apiUrl: 'https://ngi-a1.easemob.com'
  },
  sg1: {
    url: 'wss://im-api-wechat-sgp.easemob.com/websocket',
    apiUrl: 'https://a1-sgp.easemob.com'
  }
}

export type IMDataCenter = keyof typeof IM_DATA_CENTER

export interface IMConfig {
  appKey: string
  dataCenter?: IMDataCenter
}

export function getIMConfig(config: IMConfig) {
  const dc = config.dataCenter || 'cn1'
  return {
    appKey: config.appKey,
    url: IM_DATA_CENTER[dc].url,
    apiUrl: IM_DATA_CENTER[dc].apiUrl,
    useOwnUploadFun: true,
    isHttpDNS: false,
    isAutoLogin: false
  }
}
