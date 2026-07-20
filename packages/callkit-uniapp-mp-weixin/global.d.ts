import type { CallKitInstance } from './uni_modules/em-callkit-weixin'
import type { IMAdaptedConnection } from './uni_modules/em-callkit-weixin'

declare global {
  interface Uni {
    $callKit?: CallKitInstance
    $imClient?: IMAdaptedConnection
    /** demo 首页输入的群成员列表，供 getGroupMembers 兜底 */
    $lastGroupMembers?: string[]
  }
}

export {}
