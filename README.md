<img src="assets/icon.svg" width="64" height="64" alt="">

# bigdata-analysis-cert-simulation

DataQ([dataq.goorm.io](https://dataq.goorm.io)) 실기 체험 UI를 참고한 **빅데이터분석기사 실기 연습** 웹앱입니다.  
브라우저에서 **Pyodide(Python)** / **webR(R)** 로 코드를 실행합니다. VS Code / Monaco 소스는 사용하지 않으며, 코드 에디터는 DataQ와 같이 **CodeMirror + Monokai** 입니다.

## 요구 사항

- [Bun](https://bun.sh) 1.4+ (npm/yarn 대신 bun)

## 시작하기

```bash
bun install
bun run dev
```

```bash
bun run typecheck
bun run build
bun run preview
```

정적 호스팅(Cloudflare Pages, Netlify, GitHub Pages 등)에는 `dist/` 를 배포하면 됩니다.  
Pyodide / webR Worker를 위해 COOP/COEP 헤더가 필요할 수 있습니다 (`vite.config.ts` 참고).

## 주요 기능

- DataQ 유사 레이아웃: 헤더 / 좌측 문항 / 문제 패널 / Monokai 코드 에디터 / 실행 결과
- 에디터 단축키: `Tab` / `Shift+Tab` 들여쓰기, `Ctrl+Z` / `Ctrl+Shift+Z` undo·redo
- 문제 편집기: WYSIWYG(TipTap) + Source(CodeMirror), Readonly 토글 ([Haim Editor](https://github.com/explainpark101/DocuHaim) 패턴) 
- 시험 세트 / 개별 문제 JSON 가져오기·내보내기
- 패키지 핀: `C:\projects\bigdata-knight\config\requirements.txt` 와 맞춘 목록을 Pyodide에서 가능한 범위로 로드

## REA

UI 근거는 `docs/rea/` (DataQ quiz settle 캡처)를 참고했습니다. 에디터 클래스는 `CodeMirror cm-s-monokai CodeMirror-wrap` 이었습니다.

## 스키마

시험 세트 JSON은 `schemaVersion: 1` 이며 `quizzes[]` 를 포함합니다. 샘플은 `src/data/sampleExam.ts` 입니다.
