// 패널과 worker 가 함께 쓰는 데이터 모양.

/** 트리 최상위 루트: Orca 워크스페이스 또는 사용자가 추가한 경로. */
export type ExplorerRoot = {
  id: string
  kind: 'workspace' | 'custom'
  label: string
  /** 트리에서 묶어 보여줄 그룹 이름(프로젝트 이름 또는 "내 경로"). */
  group: string
  path: string
  workspaceId?: string
  /** Git worktree 가 아닌 폴더 워크스페이스. */
  folder?: boolean
  branch?: string | null
  /** 원격 호스트처럼 이 worker 가 읽을 수 없는 루트. */
  disabled?: boolean
  reason?: string
}

export type ExplorerEntry = { name: string; path: string; dir: boolean }

export type ExplorerHit = { rootId: string; path: string; rel: string; dir: boolean }


export const CUSTOM_GROUP = '내 경로'
