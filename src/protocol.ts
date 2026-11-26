// 패널 <-> worker 계약. src/panel.tsx 와 src/worker.ts 가 함께 읽는다.
import type { ExplorerEntry, ExplorerHit, ExplorerRoot } from './types'

declare module 'orca' {
  interface PluginRequests {
    'roots.list': { output: { roots: ExplorerRoot[] } }
    /** 절대경로(~ 허용)를 사용자 경로로 추가. */
    'roots.add': { input: { path: string }; output: { roots: ExplorerRoot[]; added: string } }
    'roots.remove': { input: { id: string }; output: { roots: ExplorerRoot[] } }
    'fs.list': {
      input: { rootId: string; path: string }
      output: { entries: ExplorerEntry[]; truncated: number }
    }
    /** rootId 가 없으면 사용 가능한 모든 루트를 검색. */
    'fs.search': {
      input: { query: string; rootId?: string }
      output: { hits: ExplorerHit[]; truncated: boolean }
    }
    /** 위치 입력창 경로(~ 허용)를 실제 폴더 절대경로로. */
    'fs.resolveDir': { input: { path: string }; output: { path: string } }
    /** Orca 메인 창에 탭으로 연다. 워크스페이스 밖이면 폴더를 프로젝트로 등록하고 `registered` 에 알린다. */
    'fs.open': { input: { rootId: string; path: string }; output: { opened: boolean; registered?: string } }
    'fs.create': {
      input: { rootId: string; dir: string; name: string; kind: 'file' | 'dir' }
      output: { path: string }
    }
    'fs.rename': {
      input: { rootId: string; path: string; newName: string }
      output: { path: string }
    }
    'fs.delete': { input: { rootId: string; path: string }; output: { trashedTo: string } }
  }
  interface PluginPanelEvents {
    /** worker 가 파일을 바꾼 뒤 알린다: 해당 폴더들의 목록을 다시 읽어야 한다. */
    'fs.changed': { rootId: string; dirs: string[] }
  }
}
