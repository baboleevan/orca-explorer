# Workspace Explorer

Orca 오른쪽 사이드바 패널에서 **모든 워크스페이스**와 **직접 추가한 폴더 경로**를 한 트리로 탐색하는 플러그인입니다.

## 설치

```sh
orca plugin install baboleevan/orca-explorer
```

코드를 실행하는 플러그인이라 처음에는 `approval_required`로 멈추고 요구하는 권한과 fingerprint를 보여줍니다.
내용을 확인한 뒤 출력된 명령(`--approve <fingerprint>`)으로 다시 실행하면 설치됩니다. 패널은 오른쪽 사이드바의 폴더 아이콘입니다.

## 기능

- 프로젝트별로 묶은 전체 로컬 워크스페이스 트리(현재 워크스페이스에 "현재" 표시), 폴더는 펼칠 때 읽음
- `+` 버튼으로 워크스페이스 밖 폴더 추가(`~/Downloads` 처럼 `~` 사용 가능), 선택 후 `-` 로 목록에서 빼기
- 파일 이름 검색: 2자 이상 입력하거나 Enter. `/`를 넣으면 경로로 검색. 범위는 전체 또는 루트 하나
- `.gitignore` 숨김(git 저장소가 아니면 `node_modules` 등 기본 목록). "무시된 파일 표시"로 전환
- 새 파일·새 폴더·이름 변경·삭제(휴지통으로 이동)
- 미리보기(앞부분 15 KB까지), Enter·더블클릭·"Orca에서 열기"로 에디터 탭 열기

## 제약

- 파일을 Orca 탭으로 열 수 있는 것은 **워크스페이스 안의 파일만**입니다(`editor.open` API 제약). 직접 추가한 경로의 파일은 미리보기로 봅니다.
- SSH·원격 런타임 워크스페이스는 비활성으로 표시됩니다(worker가 로컬 파일시스템만 읽음).
- 다른 볼륨의 파일은 휴지통으로 옮길 수 없어서 오류를 보여줍니다. 몰래 영구 삭제로 바꾸지 않습니다.
- 파일 변경 감시는 아직 없습니다. 이 패널이 아닌 곳에서 바꾼 내용은 새로고침 버튼으로 반영합니다.

## 설정 (Settings → Plugins → Workspace Explorer)

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `showIgnored` | `false` | 무시된 파일 표시 |
| `maxEntriesPerDir` | `500` | 폴더당 최대 항목 수 |
| `previewMaxKB` | `256` | 이보다 큰 파일은 미리보기를 하지 않음 |

## 구조

```
src/protocol.ts     패널 ↔ worker 요청 계약
src/types.ts        공유 데이터 타입
src/worker.ts       요청 처리 (Node)
src/fs/*            경로 가드·목록·무시 판정·검색·미리보기·파일 조작
src/panel.tsx       components 패널 UI
src/panel/*         atom 상태, 트리 변환, 동작
```

모든 fs 요청은 `src/fs/paths.ts`의 가드를 거칩니다. 경로는 등록된 루트 안이어야 하고, 루트 밖을 가리키는 심볼릭 링크와 `..` 탈출은 거부합니다.

## 개발

```sh
./scripts/typecheck.sh      # 타입 검사 (typescript·@types/node 를 ~/.cache 에 한 번 설치)
orca plugin test . --json   # fs·worker·패널 테스트
orca plugin check . --json  # 시나리오 렌더 검사 (src/panel.check.ts)
orca plugin dev watch . --check --shot ./.orca/shots --json
```

Orca 는 플러그인 폴더 안의 `node_modules`(숨김 폴더 안이어도)를 콘텐츠로 보고 심볼릭 링크 때문에 거부합니다.
그래서 이 폴더에서는 `npm install` 을 하지 않습니다.
