// 트리 루트 = Orca 워크스페이스 ∪ 사용자가 추가한 경로.
import type { HostMethods } from 'orca/host'
import { homedir } from 'node:os'
import { dirname, parse } from 'node:path'
import { CUSTOM_GROUP, type ExplorerRoot } from '../types'
import { ExplorerError, isInside } from './paths'

type Workspace = HostMethods['workspace.list']['result']['workspaces'][number]
type Project = HostMethods['project.list']['result']['projects'][number]

export const CUSTOM_ROOTS_KEY = 'roots.custom'
const OTHER_GROUP = '기타'

function shortBranch(branch: string | null): string | null {
  return branch ? branch.replace(/^refs\/heads\//, '') : null
}

export function buildRoots(workspaces: Workspace[], projects: Project[], customPaths: string[]): ExplorerRoot[] {
  const projectNames = new Map(projects.map((p) => [p.id, p.name]))
  // Orca 사이드바에서 숨긴 프로젝트의 워크스페이스는 트리에도 보이지 않게 한다.
  const hidden = new Set(projects.filter((p) => p.hidden).map((p) => p.id))
  const fromWorkspaces = workspaces.filter((w) => !(w.projectId && hidden.has(w.projectId))).map<ExplorerRoot>((w) => {
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

/** Finder 식 "위치" 루트 id 접두어: `loc:<절대경로>`. 등록된 루트가 아니어도 어떤 폴더든 된다. */
export const LOCATION_PREFIX = 'loc:'

export function locationRoot(path: string): ExplorerRoot {
  return { id: `${LOCATION_PREFIX}${path}`, kind: 'custom', label: path, group: '위치', path }
}

/** 프로젝트로 등록하기엔 너무 넓은 폴더: 파일시스템 루트, 홈, /Users 같은 홈의 부모. */
export function tooBroad(dir: string, home = homedir()): boolean {
  return dir === parse(dir).root || dir === home || isInside(dir, home)
}

/**
 * 워크스페이스 밖 파일을 탭으로 열 때 Orca 폴더 프로젝트로 등록할 폴더.
 * 보고 있던 루트(위치·내 경로)를 쓰되, 너무 넓으면 파일이 든 폴더를 쓴다.
 */
export function projectDirFor(rootPath: string, file: string, home = homedir()): string {
  if (!tooBroad(rootPath, home)) return rootPath
  const parent = dirname(file)
  if (!tooBroad(parent, home)) return parent
  throw new ExplorerError(
    'not_permitted',
    `${parent} 는 너무 넓어서 Orca 프로젝트로 등록하지 않습니다. 하위 폴더 안의 파일만 탭으로 열 수 있습니다.`
  )
}
