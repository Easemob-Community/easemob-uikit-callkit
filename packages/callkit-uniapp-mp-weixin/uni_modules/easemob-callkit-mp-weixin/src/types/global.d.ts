import type { CallKitInstance } from './core-adapter'

declare global {
  interface UniApp {
    /**
     * 全局 CallKit 实例，由宿主项目通过 createUniappMpWeixinCallKit 初始化后挂载
     */
    $callKit?: CallKitInstance
    /**
     * 全局 IM 适配器实例，由宿主项目挂载
     */
    $imClient?: any
  }
}

export {}
