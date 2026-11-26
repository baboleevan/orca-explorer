// 트리 루트 = Orca 워크스페이스 ∪ 사용자가 추가한 경로.
import type { HostMethods } from 'orca/host'
import { CUSTOM_GROUP, type ExplorerRoot } from '../types'
import { isInside } from './paths'

type Workspace = HostMethods['workspace.list']['result']['workspaces'][number]
type Project = HostMethods['project.list']['result']['projects'][number]

export const CUSTOM_ROOTS_KEY = 'roots.custom'
const OTHER_GROUP = '기타'

function shortBranch(branch: string | null): string | null {
  return branch ? branch.replace(/^refs\/heads\//, '') : null
}

export function buildRoots(workspaces: Workspace[], projects: Project[], customPaths: string[]): ExplorerRoot[] {
  const projectNames = new Map(projects.map((p) => [p.id, p.name]))
  const fromWorkspaces = workspaces.map<ExplorerRoot>((w) => {
    const remote = w.hostId !== null && w.hostId !== 'local'
    return {
      id: `ws:${w.id}`,
      kind: 'workspace',
      label: w.name,
      group: (w.projectId && projectNames.get(w.projectId)) || w.project || OTHER_GROUP,
      path: w.path,
      workspaceId: w.id,
      branch: shortBranch(w.branch),
      ...(w.kind === 'folder' ? { folder: true } : {}),
      ...(remote ? { disabled: true, reason: `원격 호스트(${w.hostId})는 지원하지 않습니다` } : {})
    }
  })
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  fromWorkspaces.sort((a, b) => collator.compare(a.group, b.group) || collator.compare(a.label, b.label))

  const fromCustom = customPaths.map<ExplorerRoot>((path) => ({
    id: `p:${path}`,
    kind: 'custom',
    label: path,
    group: CUSTOM_GROUP,
    path
  }))
  return [...fromWorkspaces, ...fromCustom]
}

/** `path` 를 담은 로컬 워크스페이스 루트 중 가장 안쪽 것: 사용자 경로 안의 파일도 탭으로 열 수 있게. */
export function containingWorkspace(roots: ExplorerRoot[], path: string): ExplorerRoot | undefined {
  return roots
    .filter((r) => r.kind === 'workspace' && !r.disabled && isInside(r.path, path))
    .sort((a, b) => b.path.length - a.path.length)[0]
}
