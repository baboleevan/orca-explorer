// `orca plugin check` 가 시나리오마다 패널을 한 번씩 그린다. worker 는 같은 stand-in host 위에서
// 실제 파일시스템을 읽으므로, 이 플러그인 폴더 자체를 워크스페이스로 쓴다.
import { defineCheck, hostError } from 'orca/testing'

const repo = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '')
const rootKey = (path: string) => `ws:w1\u0000${path}`

const workspaces = {
  'workspace.list': {
    workspaces: [
      { id: 'w1', kind: 'worktree', name: 'main', project: 'orca-explorer', projectId: 'p1', path: repo, branch: 'refs/heads/main', hostId: 'local' },
      { id: 'w2', kind: 'worktree', name: 'remote-box', project: 'server', projectId: 'p2', path: '/srv/app', branch: 'refs/heads/dev', hostId: 'ssh:box' }
    ],
    truncated: false
  },
  'project.list': { projects: [], truncated: false }
}

export default defineCheck({
  empty: {
    results: { 'workspace.list': { workspaces: [], truncated: false }, 'project.list': { projects: [], truncated: false } }
  },
  tree: {
    results: workspaces,
    storage: { 'roots.custom': [`${repo}/src/fs`] },
    persisted: { plugin: { expanded: [rootKey(repo), rootKey(`${repo}/src`)] } }
  },
  listError: {
    results: { 'workspace.list': hostError('unavailable', 'Orca 런타임에 연결할 수 없습니다') }
  }
})
