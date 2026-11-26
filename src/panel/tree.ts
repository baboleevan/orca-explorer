// 상태 → Tree 항목. 순수 함수라 단독으로 테스트할 수 있다.
import type { TreeItem } from 'orca'
import { CUSTOM_GROUP, type ExplorerRoot } from '../types'
import { type DirState, groupKey, locId, moreKey, nodeKey } from './state'

function childrenOf(rootId: string, path: string, dirs: Record<string, DirState>): Partial<TreeItem> {
  const key = nodeKey(rootId, path)
  const state = dirs[key]
  if (!state || state.status === 'loading') return { hasChildren: true }
  if (state.status === 'error') {
    return { children: [{ key: `${key}\u0000!`, label: state.message, icon: 'warning', disabled: true }] }
  }
  const children: TreeItem[] = state.entries.map((e) => ({
    key: nodeKey(rootId, e.path),
    label: e.name,
    icon: e.dir ? 'folder' : 'file',
    ...(e.dir ? childrenOf(rootId, e.path, dirs) : {})
  }))
  if (state.truncated > 0) {
    children.push({ key: moreKey(key), label: `… ${state.truncated}개 더 (설정에서 상한 조정)`, icon: 'more', disabled: true })
  }
  return { children }
}

function rootItem(root: ExplorerRoot, dirs: Record<string, DirState>, currentWorkspaceId: string | null): TreeItem {
  const current = root.workspaceId !== undefined && root.workspaceId === currentWorkspaceId
  const description = root.disabled
    ? root.reason
    : [current ? '현재' : null, root.branch && root.branch !== root.label ? root.branch : null].filter(Boolean).join(' · ') ||
      undefined
  const base: TreeItem = {
    key: nodeKey(root.id, root.path),
    label: root.label,
    icon: root.kind === 'custom' || root.folder ? 'folder' : 'branch',
    ...(description ? { description } : {})
  }
  return root.disabled ? { ...base, disabled: true } : { ...base, ...childrenOf(root.id, root.path, dirs) }
}

/** 그룹(프로젝트, "내 경로") → 루트 → 폴더/파일. */
export function buildTree(
  roots: ExplorerRoot[],
  dirs: Record<string, DirState>,
  currentWorkspaceId: string | null
): TreeItem[] {
  const groups = new Map<string, ExplorerRoot[]>()
  for (const root of roots) {
    const list = groups.get(root.group) ?? []
    list.push(root)
    groups.set(root.group, list)
  }
  return [...groups].map(([group, members]) => ({
    key: groupKey(group),
    label: group,
    icon: group === CUSTOM_GROUP ? 'star' : 'layers',
    description: `${members.length}`,
    children: members.map((r) => rootItem(r, dirs, currentWorkspaceId))
  }))
}

/** 실제로 Tree 에 펼쳐 보일 키: 저장된 펼침 + 접지 않은 그룹. */
export function expandedKeys(roots: ExplorerRoot[], expanded: string[], collapsedGroups: string[]): string[] {
  const groups = [...new Set(roots.map((r) => r.group))].filter((g) => !collapsedGroups.includes(g)).map(groupKey)
  return [...groups, ...expanded]
}

/** 위치 모드: 그 폴더의 내용만 최상위로. 아직 못 읽었으면 null. */
export function buildLocationTree(path: string, dirs: Record<string, DirState>): TreeItem[] | null {
  const items = childrenOf(locId(path), path, dirs)
  return items.children ? [...items.children] : null
}
