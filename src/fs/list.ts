// 한 폴더의 항목 목록: 폴더 먼저, 이름순(자연 정렬), 상한 적용.
import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExplorerEntry } from '../types'
import { ignoredNames } from './ignore'
import { ExplorerError } from './paths'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function sortEntries(entries: ExplorerEntry[]): ExplorerEntry[] {
  return entries.sort((a, b) => (a.dir === b.dir ? collator.compare(a.name, b.name) : a.dir ? -1 : 1))
}

async function isDirectory(dir: string, entry: Dirent): Promise<boolean> {
  if (entry.isDirectory()) return true
  if (!entry.isSymbolicLink()) return false
  try {
    return (await stat(join(dir, entry.name))).isDirectory()
  } catch {
    return false // 깨진 링크는 파일처럼 보여준다
  }
}

export async function listDir(
  dir: string,
  options: { showIgnored: boolean; limit: number }
): Promise<{ entries: ExplorerEntry[]; truncated: number }> {
  let dirents: Dirent[]
  try {
    dirents = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOTDIR') throw new ExplorerError('invalid_params', `폴더가 아닙니다: ${dir}`)
    if (code === 'EACCES' || code === 'EPERM') throw new ExplorerError('not_permitted', `읽을 권한이 없습니다: ${dir}`)
    throw new ExplorerError('action_failed', `폴더를 읽지 못했습니다: ${dir}`)
  }

  const hidden = options.showIgnored
    ? new Set(dirents.filter((d) => d.name === '.git').map((d) => d.name))
    : await ignoredNames(dir, dirents.map((d) => d.name))

  const visible = dirents.filter((d) => !hidden.has(d.name))
  const entries = await Promise.all(
    visible.map(async (d) => ({ name: d.name, path: join(dir, d.name), dir: await isDirectory(dir, d) }))
  )
  sortEntries(entries)
  const truncated = Math.max(0, entries.length - options.limit)
  return { entries: truncated ? entries.slice(0, options.limit) : entries, truncated }
}
