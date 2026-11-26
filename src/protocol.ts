// 패널 <-> worker 계약. src/panel.tsx 와 src/worker.ts 가 함께 읽는다.
import type { ExplorerEntry, ExplorerHit, ExplorerPreview, ExplorerRoot } from './types'

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
    'fs.preview': { input: { rootId: string; path: string }; output: ExplorerPreview }
    'fs.open': { input: { rootId: string; path: string }; output: { opened: boolean } }
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
