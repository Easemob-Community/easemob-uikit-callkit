<template>
  <div class="easemob-chat-member-list-modal" @click.self="resetAndClose">
    <div class="member-list-container">
      <div class="member-list-header">
        <h3>邀请成员</h3>
        <button class="close-btn" @click="resetAndClose">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div class="member-list-content">
        <div v-if="loading" class="loading-state">
          <div class="spinner" />
          <span>加载中...</span>
        </div>
        <div v-else-if="displayMembers.length === 0" class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span>暂无可选成员</span>
        </div>
        <div v-else class="list">
          <div
            v-for="member in displayMembers"
            :key="member.userId"
            class="member-item"
            :class="{
              selected: selectedUsers.includes(member.userId),
              disabled: existingUserIds.includes(member.userId),
              inviting: invitingUserIds?.includes(member.userId)
            }"
            @click="toggleSelect(member.userId)"
          >
            <div class="member-avatar-wrap">
              <img v-if="member.avatar" :src="member.avatar" class="member-avatar" />
              <div v-else class="member-avatar-fallback" :style="{ background: getAvatarGradient(member.userId) }">
                {{ getFirstChar(member.userName) }}
              </div>
            </div>
            <span class="name">{{ member.userName }}</span>
            <div class="status">
              <span v-if="existingUserIds.includes(member.userId)" class="status-text">已在通话中</span>
              <span v-else-if="invitingUserIds?.includes(member.userId)" class="status-text inviting">
                <span class="mini-spinner" />
                邀请中
              </span>
              <div v-else class="custom-checkbox" :class="{ checked: selectedUsers.includes(member.userId) }">
                <svg v-if="selectedUsers.includes(member.userId)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="member-list-footer">
        <button class="cancel-btn" @click="resetAndClose">取消</button>
        <button
          class="invite-btn"
          :disabled="selectedUsers.length === 0"
          @click="handleInvite"
        >
          确定{{ selectedUsers.length > 0 ? ` (${selectedUsers.length})` : '' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useChatClientStore } from '../../store/chatClient'
import { resolveUserProfiles } from '../../services/UserProfileService'
import { logger } from '../../utils/logger'
import { getGroupMembers } from '../../utils/imSdkAdapter'

function getFirstChar(name: string) {
  return name?.charAt(0)?.toUpperCase() || '?'
}

function getAvatarGradient(userId: string) {
  const hash = userId.split('').reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc)
  }, 0)
  const h1 = Math.abs(hash % 360)
  const h2 = (h1 + 40) % 360
  return `linear-gradient(135deg, hsl(${h1}, 60%, 45%) 0%, hsl(${h2}, 60%, 35%) 100%)`
}

interface Member {
  userId: string
  userName: string
  avatar?: string
}

const props = defineProps<{
  groupId: string
  members?: Member[] // 外部传入的群成员列表（双轨制：传了直接用，不传内部获取）
  existingUserIds: string[] // 已经在通话中的用户ID
  invitingUserIds?: string[] // 邀请中的用户ID
}>()

const emit = defineEmits<{
  close: []
  invite: [userIds: string[]]
}>()

const chatClientStore = useChatClientStore()
const internalMembers = ref<Member[]>([])
const selectedUsers = ref<string[]>([])
const loading = ref(false)

// 双轨制：优先使用外部传入的 members，无则使用内部获取的
const displayMembers = computed<Member[]>(() => {
  if (props.members && props.members.length > 0) {
    return props.members
  }
  return internalMembers.value
})

const fetchGroupMembers = async () => {
  const client = chatClientStore.getChatClient
  if (!client || !props.groupId) {
    logger.warn('EasemobChatGroupMemberList: 无法获取群成员，client或groupId未提供', {
      hasClient: !!client,
      groupId: props.groupId
    })
    return
  }

  loading.value = true
  try {
    const currentUserId = client.user
    const isMiniCore = chatClientStore.getIsMiniCore
    const allMembers: Array<{ userId: string }> = []
    let cursor: string | null = null
    const pageSize = 100

    do {
      // 环信 SDK 4.x 获取群成员列表（兼容 full/miniCore）
      const response = await getGroupMembers(client, {
        groupId: props.groupId,
        pageSize,
        cursor,
      }, isMiniCore)

      // 兼容两种 SDK 返回格式：
      // 1. 新 SDK: response.data.members = [{ role, userId, joinedTime }, ...]
      // 2. 旧 SDK: response.data = [{ member: 'x' }, { owner: 'x' }, ...]
      const memberList = Array.isArray(response.data?.members)
        ? response.data.members
        : Array.isArray(response.data)
          ? response.data
          : []
      memberList.forEach((m: any) => {
        const userId = m.userId || m.member || m.owner
        if (userId && userId !== currentUserId) {
          allMembers.push({ userId })
        }
      })

      cursor = response.data?.cursor || null
    } while (cursor)

    // 通过 UserProfileService 批量 enrich 昵称头像
    if (allMembers.length > 0) {
      const profiles = await resolveUserProfiles(allMembers.map(m => m.userId))
      const profileMap = new Map(profiles.map(p => [p.userId, p]))
      internalMembers.value = allMembers.map(m => {
        const profile = profileMap.get(m.userId)
        return {
          userId: m.userId,
          userName: profile?.nickname || m.userId,
          avatar: profile?.avatarUrl,
        }
      })
      logger.info('EasemobChatGroupMemberList: 获取并 enrich 群成员成功', {
        groupId: props.groupId,
        count: allMembers.length,
      })
    } else {
      internalMembers.value = []
    }
  } catch (error) {
    logger.error('EasemobChatGroupMemberList: 获取群成员失败', error)
  } finally {
    loading.value = false
  }
}

const toggleSelect = (userId: string) => {
  // 已在通话中的用户不能选择
  if (props.existingUserIds.includes(userId)) return

  const index = selectedUsers.value.indexOf(userId)
  if (index > -1) {
    selectedUsers.value.splice(index, 1)
  } else {
    selectedUsers.value.push(userId)
  }
}

const resetSelection = () => {
  selectedUsers.value = []
}

const resetAndClose = () => {
  resetSelection()
  emit('close')
}

const handleInvite = () => {
  emit('invite', [...selectedUsers.value])
  resetAndClose()
}

onMounted(() => {
  // 双轨制：外部传了 members 就不内部获取
  if (props.members && props.members.length > 0) {
    logger.info('EasemobChatGroupMemberList: 使用外部传入的成员列表', {
      count: props.members.length,
    })
    return
  }
  fetchGroupMembers()
})
</script>

<style scoped src="./styles/EasemobChatGroupMemberList.css"></style>
