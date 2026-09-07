# FE 각성 메시지 실시간 검수기

Fire Emblem Awakening 렌더링 규칙과 필요한 에셋을 자체 포함해 브라우저 Canvas에서 사용하는 스탠드얼론 로컬 도구입니다. Java, 별도 패키지 설치, 원본 에디터 폴더가 필요하지 않습니다.

모바일 `FE-Awakening-Reviewer`와 **동일한 4상태 검수 기록**을 사용합니다. 번역 소스가 있는 `main`과 검수 상태 저장소를 분리하고, GitHub `review-state` 브랜치에서 PC/모바일 전용 진행도 파일을 따로 운용합니다.

## 실행

1. `Awakening` 폴더 바로 아래의 `Awakening-Live-Renderer.bat` 또는 이 폴더의 `start.bat`을 더블클릭합니다.
2. 열린 브라우저에서 **번역 폴더 열기**로 `Messages (K)` 또는 DLC 번역 폴더를 지정합니다.
3. **일본어 폴더 열기**로 대응하는 일본어 폴더를 지정합니다.
4. 상단 `검수 PAT`에 FE-Awakening 저장소 **Contents: Read and write** 권한이 있는 Fine-grained PAT를 처음 한 번만 입력합니다. 이 브라우저에 기억됩니다.
5. **검수 기록 동기화**를 한 번 눌러 PC 로컬 기록과 GitHub `review-state` 기록을 병합합니다.
6. 파일과 메시지 키를 선택해 검수/수정합니다.
7. 번역 텍스트는 **저장** 또는 `Ctrl+S`, 검수 상태는 로컬에 즉시 저장되고 GitHub PC 진행도 파일에는 짧은 지연 뒤 자동 동기화됩니다.

브라우저의 File System Access API가 필요하므로 최신 Microsoft Edge 또는 Chrome을 권장합니다. `index.html`을 직접 더블클릭하지 말고 반드시 `start.bat`으로 실행하세요.

## 모바일과 공용 검수 상태

검수 상태는 다음 네 가지로 통일되어 있습니다.

- **미검수**
- **확인 완료**
- **수정 필요**
- **보류**

공용 기록에서는 `한국어 파일 경로 + 실제 MID`를 식별자로 사용합니다. 각 상태에는 `updatedAt`이 들어가며 PC와 폰 기록을 합칠 때 MID별 최신 상태가 우선합니다. `미검수`로 되돌린 상태도 기록으로 남아 다른 기기의 오래된 완료 체크가 되살아나는 일을 막습니다.

`Message Name`과 `_PCM2`, `_PCM3`, `_PCF2`, `_PCF3` 등 진행도 제외 항목은 완료율에서 제외합니다.

## 진행률

FILES 상단 큰 퍼센트는 모바일과 동일하게 **검수 완료 파일 / 전체 파일**입니다.

보조 줄은 **확인 완료 MID / 전체 검수 대상 MID** 기준 퍼센트를 표시합니다. 모든 검수 대상 MID가 `확인 완료`인 파일만 완료 파일로 계산됩니다. 오늘 확인 완료한 단계 수도 공용 기록의 타임스탬프로 표시합니다.

## PC ↔ 폰 동기화

검수 상태는 `main`이 아니라 `review-state` 브랜치의 다음 두 파일로 분리합니다.

- `Awakening/review-progress-pc.json` — **PC만 씀**
- `Awakening/review-progress-mobile.json` — **모바일만 씀**

PC와 모바일은 둘 다 두 파일을 읽어 MID별 `updatedAt`이 더 최신인 상태를 최종 상태로 사용합니다. 한쪽이 다른 쪽의 상태를 읽어 자기 전용 파일에 스냅샷으로 포함할 수는 있지만, **각 장치가 실제로 갱신하는 Git 파일은 자기 파일 하나뿐**입니다.

예전 단일 `Awakening/review-progress.json`은 기존 진행도를 잃지 않기 위한 **읽기 전용 마이그레이션 원본**으로만 남겨 둡니다. 새 버전은 이 파일을 수정하지 않습니다.

### 폰 → PC

1. 폰 Reviewer에서 검수합니다.
2. `GitHub에 반영`을 누르면 번역 수정은 `main`, 검수 상태는 `review-state`의 `review-progress-mobile.json`에 각각 반영됩니다.
3. PC는 `main`을 Pull하지 않아도 라이브 렌더러를 시작하거나 창으로 돌아올 때 PC/모바일 진행도 파일을 다시 읽습니다.
4. 따라서 폰에서 완료한 MID는 PC에서도 완료로 표시됩니다.

### PC → 폰

1. PC 라이브 렌더러에서 검수 상태를 바꾸면 브라우저 로컬 기록에 즉시 저장됩니다.
2. PAT가 설정되어 있으면 짧은 지연 뒤 `review-state`의 `review-progress-pc.json`에 자동 동기화합니다.
3. 폰 Reviewer는 앱을 열거나 다시 전면으로 가져올 때 PC/모바일 진행도를 다시 합쳐 읽습니다.
4. 따라서 PC에서 완료한 MID도 폰에서 완료로 표시됩니다.

핵심은 **번역 Git 작업과 검수 상태 쓰기가 같은 파일이나 같은 브랜치를 공유하지 않는 것**입니다. 검수 상태가 바뀌어도 PC 워킹트리의 `review-progress.json`이 dirty해지지 않으며, 검수 진행도 때문에 번역 파일 Pull/Push가 충돌하는 구조를 제거했습니다.

## 기존 검수 기록 마이그레이션

업데이트 직후에는 기존 브라우저의 `fe13-live:sharedProgress:v2`, 예전 `fe13-live:reviewStatuses:main/dlc`, 이전에 연결해 두었던 로컬 `Awakening/review-progress.json`, 그리고 `review-state`의 예전 단일 `Awakening/review-progress.json`을 가능한 범위에서 **읽기 전용으로 병합**합니다.

그 뒤의 새 상태 변경은 PC/모바일 전용 파일에만 기록됩니다. 기존 상태 중 정확한 시각 정보가 없는 기록은 오늘 작업량으로 잡히지 않도록 오래된 타임스탬프를 사용합니다. 최근 공용 기록과 로컬 기록에는 기존 `updatedAt`이 그대로 유지됩니다.

## 검수 단축키

- `Ctrl+Enter`: 현재 항목 확인 완료 + 다음 보이는 항목
- `F3`: 현재 항목 확인 완료 + 다음 검수 대상
- `F2`: 현재 항목 수정 필요
- `Alt+↑` / `Alt+↓`: 이전·다음 메시지
- `Alt+←` / `Alt+→`: 이전·다음 파일
- `Ctrl+←` / `Ctrl+→`: 이전·다음 회화 화면
- `Ctrl+S`: 현재 번역 파일 저장
- `F8`: 수정 편의 모드

상태 드롭다운에서 `보류`와 `미검수`도 직접 지정할 수 있습니다.

## 파일 보존 방식

- 메시지 키와 콜론 오른쪽 값만 편집합니다.
- 선택 항목 외의 텍스트, 빈 줄, CRLF/LF, UTF-8 BOM 유무는 바꾸지 않습니다.
- 번역 저장은 다운로드 사본이 아니라 열었던 원본 파일에 기록합니다.
- 검수 상태는 번역 텍스트와 분리된 브라우저 로컬 기록 + GitHub `review-state`의 PC/모바일 전용 파일에 저장합니다.
- `main`의 `Awakening/review-progress.json`과 `review-state`의 예전 단일 파일은 새 버전에서 쓰지 않습니다.

## 일본어 자동 매칭

1. 선택 폴더 안의 동일 상대 경로
2. 동일 파일명
3. 첫 줄의 `MESS_ARCHIVE_...` 식별자

자동 매칭되지 않으면 **일본어 파일 지정**으로 직접 선택할 수 있습니다.

## 렌더 범위

`$t0`, `$t1`, `$Wm`, `$Ws`, `$E`, `$Wd`, `$Nu`, `$G`, `$c`, `\\n`, `$k$p`, `$k\\n` 등을 화면 상태에 반영합니다. 얼굴/감정/글꼴 에셋이 없으면 해당 레이어만 건너뛰고 렌더 진단에 표시합니다.

## 테스트

```bash
node test-format.mjs
node test-review-progress.mjs
```

## 라이선스

렌더링 동작은 Secretive Cactus의 *Fire Emblem Conversation Editor* GPLv3 소스를 바탕으로 JavaScript로 다시 구현했습니다. 이 파생 구현 역시 GPLv3 조건을 따릅니다.
