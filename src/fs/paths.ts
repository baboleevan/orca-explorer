// 경로 정규화와 "루트 안쪽인지" 검사. 모든 fs 핸들러가 이 가드를 거친다.
import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** host 가 패널로 그대로 전달하는 오류. code 는 Orca host 오류 코드여야 한다. */
export class ExplorerError extends Error {
  constructor(
    readonly code: 'invalid_params' | 'not_permitted' | 'conflict' | 'too_large' | 'action_failed',
    message: string
  ) {
    super(message)
  }
}

/** `~` 를 홈으로 바꾸고 절대경로로 정규화한다. 상대경로는 거부. */
export function expandPath(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new ExplorerError('invalid_params', '경로를 입력하세요.')
  const expanded =
    trimmed === '~' ? homedir() : trimmed.startsWith('~/') ? join(homedir(), trimmed.slice(2)) : trimmed
  if (!isAbsolute(expanded)) throw new ExplorerError('invalid_params', `절대경로가 아닙니다: ${input}`)
  return resolve(expanded)
}

export function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

async function realOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path)
  } catch {
    return null
  }
}

/**
 * 존재하는 `target` 이 `root` 안에 있는지 실제 경로(심볼릭 링크 해석 후)로 확인하고 정규화된
 * 경로를 돌려준다. 바깥을 가리키는 링크나 `..` 탈출은 거부한다.
 */
export async function resolveExisting(root: string, target: string): Promise<string> {
  const realRoot = await realOrNull(root)
  if (!realRoot) throw new ExplorerError('invalid_params', `루트를 찾을 수 없습니다: ${root}`)
  const lexical = resolve(root, target)
  if (!isInside(resolve(root), lexical) && !isInside(realRoot, lexical)) {
    throw new ExplorerError('not_permitted', `루트 밖 경로입니다: ${target}`)
  }
  const real = await realOrNull(lexical)
  if (!real) throw new ExplorerError('invalid_params', `존재하지 않는 경로입니다: ${target}`)
  if (!isInside(realRoot, real)) {
    throw new ExplorerError('not_permitted', `루트 밖을 가리키는 링크입니다: ${target}`)
  }
  return lexical
}

/** 새로 만들 항목 이름 검사: 경로 구분자·`.`/`..`·빈 이름 거부. */
export function validateName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..' || /[/\\\0]/.test(trimmed)) {
    throw new ExplorerError('invalid_params', `사용할 수 없는 이름입니다: ${name}`)
  }
  return trimmed
}

/** `dir`(루트 안, 존재) 아래에 만들 `name` 의 경로. */
export async function resolveChild(root: string, dir: string, name: string): Promise<string> {
  const parent = await resolveExisting(root, dir)
  return join(parent, validateName(name))
}

export { basename, dirname, relative }
