// 패널 상태(atom)와 트리 키 규칙.
import { atom } from 'orca'
import type { ExplorerEntry, ExplorerHit, ExplorerRoot } from '../types'

/** 루트·폴더·파일 노드 키: `${rootId}\0${absPath}`. 같은 경로도 루트가 다르면 다른 노드. */
export const nodeKey = (rootId: string, path: string) => `${rootId}\u0000${path}`
/** 그룹 노드 키. */
export const groupKey = (group: string) => `\u0001${group}`
export const moreKey = (dirKey: string) => `${dirKey}\u0000…`
/** Finder 식 위치 루트 id. worker 의 LOCATION_PREFIX 와 같다. */
export const locId = (path: string) => `loc:${path}`
export const isLocId = (rootId: string) => rootId.startsWith('loc:')

export function parseNodeKey(key: string): { rootId: string; path: string } | null {
  if (key.startsWith('\u0001')) return null
  const parts = key.split('\u0000')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return { rootId: parts[0], path: parts[1] }
}

export type DirState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; entries: ExplorerEntry[]; truncated: number }

export type Selection = { rootId: string; path: string; dir: boolean; isRoot: boolean }

export type Mode =
  | { kind: 'idle' }
  | { kind: 'create'; type: 'file' | 'dir' }
  | { kind: 'rename' }
  | { kind: 'delete' }

export type Message = { tone: 'success' | 'danger' | 'neutral'; text: string }

export type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'error'; query: string; message: string }
  | { status: 'ready'; query: string; hits: ExplorerHit[]; truncated: boolean }

export const roots = atom<ExplorerRoot[] | null>(null)
export const rootsError = atom<string | null>(null)
export const dirs = atom<Record<string, DirState>>({})
/** 펼친 노드 키. 패널을 다시 열어도 유지(plugin 범위 저장). */
export const expanded = atom<string[]>('expanded', [], { persist: 'plugin' })
/** 접은 그룹. 그룹은 기본으로 펼쳐 둔다. */
export const collapsedGroups = atom<string[]>('collapsedGroups', [], { persist: 'plugin' })
export const selection = atom<Selection | null>(null)
export const mode = atom<Mode>({ kind: 'idle' })
export const message = atom<Message | null>(null)
export const query = atom('')
/** 검색 범위: 'all' 또는 루트 id. */
export const searchScope = atom('searchScope', 'all', { persist: 'plugin' })
export const search = atom<SearchState>({ status: 'idle' })
export const showIgnored = atom(false)
export const currentWorkspaceId = atom<string | null>(null)
/** 이름 입력 폼의 초안. */
export const draft = atom('')
/** Finder 식 현재 위치(절대경로). null 이면 모든 워크스페이스 트리. */
export const location = atom<string | null>('location', null, { persist: 'plugin' })
/** 위치 입력창 내용. */
export const locationDraft = atom('')
