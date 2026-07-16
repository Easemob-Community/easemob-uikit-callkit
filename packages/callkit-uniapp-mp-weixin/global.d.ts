import type { CallKitInstance } from './uni_modules/easemob-callkit-mp-weixin'
import type { IMAdaptedConnection } from './uni_modules/easemob-callkit-mp-weixin'

declare global {
  interface Uni {
    $callKit?: CallKitInstance
    $imClient?: IMAdaptedConnection
  }
}

export {}
