// 파일명 검색. git 저장소면 `git ls-files`(추적 + 무시되지 않은 새 파일), 아니면 제한된 BFS.
import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { runGit } from './git'
import { ALWAYS_HIDDEN, DEFAULT_IGNORED } from './ignore'

export type SearchMatch = { rel: string; dir: boolean }

const MAX_WALK_ENTRIES = 30000
const MAX_WALK_DEPTH = 12

/** 루트 아래의 모든 항목 상대경로(posix 구분자). */
export async function listAll(
  root: string,
  options: { showIgnored: boolean; signal?: AbortSignal }
): Promise<SearchMatch[] | null> {
  if (!options.showIgnored) {
    const git = await runGit(root, ['ls-files', '-co', '--exclude-standard', '-z'], { signal: options.signal })
    if (git.code === 0) {
      const files = git.stdout.split('\0').filter(Boolean)
      const dirs = new Set<string>()
      for (const file of files) {
        for (let d = posix.dirname(file); d !== '.' && !dirs.has(d); d = posix.dirname(d)) dirs.add(d)
      }
      return [...[...dirs].map((rel) => ({ rel, dir: true })), ...files.map((rel) => ({ rel, dir: false }))]
    }
  }
  return walk(root, options)
}

async function walk(root: string, options: { showIgnored: boolean; signal?: AbortSignal }): Promise<SearchMatch[]> {
  const out: SearchMatch[] = []
  let queue: { abs: string; rel: string }[] = [{ abs: root, rel: '' }]
  for (let depth = 0; depth <= MAX_WALK_DEPTH && queue.length && out.length < MAX_WALK_ENTRIES; depth++) {
    const next: typeof queue = []
    for (const { abs, rel } of queue) {
      if (options.signal?.aborted) return out
      let dirents: Dirent[]
      try {
        dirents = await readdir(abs, { withFileTypes: true })
      } catch {
        continue
      }
      for (const d of dirents) {
        if (ALWAYS_HIDDEN.has(d.name) || (!options.showIgnored && DEFAULT_IGNORED.has(d.name))) continue
        const childRel = rel ? `${rel}/${d.name}` : d.name
        const dir = d.isDirectory()
        out.push({ rel: childRel, dir })
        if (dir) next.push({ abs: join(abs, d.name), rel: childRel })
        if (out.length >= MAX_WALK_ENTRIES) break
      }
    }
    queue = next
  }
  return out
}

/**
 * 대소문자 무시 부분일치. `/` 가 들어간 질의는 상대경로 전체에, 아니면 이름에 맞춘다.
 * 이름이 질의로 시작하는 것, 짧은 경로를 앞에 둔다.
 */
export function matchEntries(entries: SearchMatch[], query: string): SearchMatch[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const byPath = q.includes('/')
  const scored: { m: SearchMatch; score: number }[] = []
  for (const m of entries) {
    const name = posix.basename(m.rel).toLowerCase()
    const hay = byPath ? m.rel.toLowerCase() : name
    const at = hay.indexOf(q)
    if (at < 0) continue
    const score = (name === q ? 0 : name.startsWith(q) ? 1 : 2) * 10000 + Math.min(m.rel.length, 9999)
    scored.push({ m, score })
  }
  scored.sort((a, b) => a.score - b.score || a.m.rel.localeCompare(b.m.rel))
  return scored.map((s) => s.m)
}
