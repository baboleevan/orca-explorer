// 어떤 항목을 숨길지 판정한다. git 저장소 안이면 .gitignore 규칙(git check-ignore)을 따르고,
// 아니면 기본 목록을 쓴다. `.git` 폴더는 항상 숨긴다.
import { runGit } from './git'

export const ALWAYS_HIDDEN = new Set(['.git'])
export const DEFAULT_IGNORED = new Set(['node_modules', '.DS_Store', '__pycache__', '.venv', '.idea'])

/** `dir` 바로 아래의 `names` 중 숨길 이름들. */
export async function ignoredNames(dir: string, names: string[]): Promise<Set<string>> {
  const hidden = new Set(names.filter((n) => ALWAYS_HIDDEN.has(n)))
  const candidates = names.filter((n) => !hidden.has(n))
  if (candidates.length === 0) return hidden

  // -z: NUL 구분 입출력, --stdin: 경로 목록. 종료 코드 0=하나 이상 무시, 1=없음, 128=저장소 아님.
  const result = await runGit(dir, ['check-ignore', '-z', '--stdin'], {
    input: candidates.join('\0') + '\0'
  })
  if (result.code === 0 || result.code === 1) {
    for (const name of result.stdout.split('\0')) if (name) hidden.add(name)
    if (candidates.includes('.DS_Store')) hidden.add('.DS_Store')
    return hidden
  }
  for (const n of candidates) if (DEFAULT_IGNORED.has(n)) hidden.add(n)
  return hidden
}
