// 파일 미리보기: 크기 상한, NUL 바이트로 바이너리 판정, 확장자로 언어 추정.
import { open, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { ExplorerPreview } from '../types'
import { ExplorerError } from './paths'

const LANGUAGES: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json', md: 'markdown', markdown: 'markdown',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin',
  swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
  php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini', xml: 'xml', html: 'html', htm: 'html',
  css: 'css', scss: 'scss', less: 'less', sql: 'sql', graphql: 'graphql', gql: 'graphql',
  vue: 'vue', svelte: 'svelte', dockerfile: 'dockerfile', gradle: 'groovy', groovy: 'groovy',
  lua: 'lua', dart: 'dart', r: 'r', scala: 'scala', ex: 'elixir', exs: 'elixir', tf: 'hcl'
}

export function languageOf(path: string): string | undefined {
  const name = basename(path).toLowerCase()
  if (name === 'dockerfile') return 'dockerfile'
  if (name === 'makefile') return 'makefile'
  return LANGUAGES[extname(name).slice(1)]
}

/** 패널 렌더 한도(텍스트당 16 KiB) 안에 들도록 줄 경계에서 자른다. */
export const PREVIEW_TEXT_BYTES = 15 * 1024

export function clipText(text: string): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= PREVIEW_TEXT_BYTES) return { text, truncated: false }
  let clipped = Buffer.from(text, 'utf8').subarray(0, PREVIEW_TEXT_BYTES).toString('utf8')
  clipped = clipped.replace(/\uFFFD$/, '')
  const lastNewline = clipped.lastIndexOf('\n')
  if (lastNewline > 0) clipped = clipped.slice(0, lastNewline)
  return { text: clipped, truncated: true }
}

export async function previewFile(path: string, maxBytes: number): Promise<ExplorerPreview> {
  const info = await stat(path)
  if (info.isDirectory()) throw new ExplorerError('invalid_params', `폴더는 미리볼 수 없습니다: ${path}`)
  if (info.size > maxBytes) return { kind: 'tooLarge', path, size: info.size }

  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(info.size)
    const { bytesRead } = await handle.read(buffer, 0, info.size, 0)
    const bytes = buffer.subarray(0, bytesRead)
    if (bytes.subarray(0, 8000).includes(0)) return { kind: 'binary', path, size: info.size }
    const { text, truncated } = clipText(bytes.toString('utf8'))
    return { kind: 'text', path, size: info.size, text, truncated, language: languageOf(path) }
  } finally {
    await handle.close()
  }
}
