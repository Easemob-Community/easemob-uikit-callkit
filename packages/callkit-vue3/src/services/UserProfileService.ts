import { logger } from '../utils/logger'
import { useGlobalCallStore } from '../store/globalCall'

export interface UserProfile {
  userId: string
  nickname?: string
  avatarUrl?: string
}

export interface GroupProfile {
  groupId: string
  groupName?: string
  groupAvatar?: string
}

export type UserInfo = { nickname?: string; avatarURL?: string }

export type UserInfoProvider = (userIds: string[]) => Promise<UserProfile[]>
export type GroupInfoProvider = (groupIds: string[]) => Promise<GroupProfile[]>

let _userInfoProvider: UserInfoProvider | undefined
let _groupInfoProvider: GroupInfoProvider | undefined

/**
 * 注册用户信息查询 Provider
 * 由 EasemobChatCallKitProvider.vue 在初始化时调用
 */
export function registerUserInfoProvider(provider: UserInfoProvider | undefined) {
  _userInfoProvider = provider
}

export function getUserInfoProvider(): UserInfoProvider | undefined {
  return _userInfoProvider
}

/**
 * 注册群组信息查询 Provider
 */
export function registerGroupInfoProvider(provider: GroupInfoProvider | undefined) {
  _groupInfoProvider = provider
}

export function getGroupInfoProvider(): GroupInfoProvider | undefined {
  return _groupInfoProvider
}

/**
 * 通过 Provider 批量解析用户信息
 * 优先读取 GlobalCallStore 缓存，未命中部分调用 Provider，获取后写入缓存
 * @returns 解析后的用户信息，失败时返回 userId 兜底
 */
export async function resolveUserProfiles(userIds: string[]): Promise<UserProfile[]> {
  if (!userIds.length) return []

  // 1. 先查 GlobalCallStore 缓存
  const globalCallStore = useGlobalCallStore()

  const cachedProfiles = new Map<string, UserProfile>()
  const missingUserIds: string[] = []

  for (const id of userIds) {
    const cached = globalCallStore.getUserInfo(id)
    if (cached.nickname || cached.avatarURL) {
      cachedProfiles.set(id, {
        userId: id,
        nickname: cached.nickname,
        avatarUrl: cached.avatarURL,
      })
    } else {
      missingUserIds.push(id)
    }
  }

  // 2. 全部命中缓存，直接返回
  if (!missingUserIds.length) {
    return userIds.map(id => cachedProfiles.get(id) || { userId: id })
  }

  // 3. 无 Provider，只能返回已有缓存 + userId 兜底
  if (!_userInfoProvider) {
    return userIds.map(id => cachedProfiles.get(id) || { userId: id })
  }

  // 4. 调用 Provider 获取未缓存的部分
  try {
    const profiles = await _userInfoProvider(missingUserIds)
    const fetchedMap = new Map(profiles.map(p => [p.userId, p]))

    // 5. 写入 GlobalCallStore 缓存
    for (const id of missingUserIds) {
      const profile = fetchedMap.get(id)
      if (profile?.nickname || profile?.avatarUrl) {
        globalCallStore.setUserInfo(id, {
          nickname: profile.nickname,
          avatarURL: profile.avatarUrl,
        })
        cachedProfiles.set(id, profile)
      }
    }

    logger.debug('[UserProfileService] 批量解析用户资料完成', {
      total: userIds.length,
      cached: userIds.length - missingUserIds.length,
      fetched: missingUserIds.length,
    })

    return userIds.map(id => cachedProfiles.get(id) || { userId: id })
  } catch (error) {
    logger.warn('[UserProfileService] 获取用户信息失败', error)
    return userIds.map(id => cachedProfiles.get(id) || { userId: id })
  }
}

/**
 * 通过 Provider 批量解析群组信息
 * @returns 解析后的群组信息，失败时返回 groupId 兜底
 */
export async function resolveGroupProfiles(groupIds: string[]): Promise<GroupProfile[]> {
  if (!groupIds.length) return []
  if (!_groupInfoProvider) {
    return groupIds.map(id => ({ groupId: id }))
  }
  try {
    const profiles = await _groupInfoProvider(groupIds)
    const profileMap = new Map(profiles.map(p => [p.groupId, p]))
    return groupIds.map(id => profileMap.get(id) || { groupId: id })
  } catch (error) {
    logger.warn('[UserProfileService] 获取群组信息失败', error)
    return groupIds.map(id => ({ groupId: id }))
  }
}

/**
 * 主动设置单个用户资料（注入到 GlobalCallStore，优先级高于 Provider 拉取）
 * 适合业务方在通话前/通话中动态设置 nickname / avatarURL
 */
export function setUserInfo(userId: string, userInfo: UserInfo) {
  const globalCallStore = useGlobalCallStore()
  globalCallStore.setUserInfo(userId, userInfo)
  logger.info('[UserProfileService] 已设置用户资料', { userId, ...userInfo })
}

/**
 * 批量设置用户资料（Map 形式，key 为 userId）
 */
export function setUserInfoMap(map: Record<string, UserInfo>) {
  const globalCallStore = useGlobalCallStore()
  const entries = Object.entries(map)
  entries.forEach(([userId, userInfo]) => {
    globalCallStore.setUserInfo(userId, userInfo)
  })
  logger.info('[UserProfileService] 已批量设置用户资料', { count: entries.length })
}

/**
 * 清理已注册的 Provider（Provider 卸载时调用）
 */
export function clearProfileProviders() {
  _userInfoProvider = undefined
  _groupInfoProvider = undefined
}
