<img src="assets/icon.svg" width="64" height="64" alt="">

# bigdata-analysis-cert-simulation

DataQ 실기 체험 UI를 참고한 **빅데이터분석기사 실기** 연습 앱입니다.  
**프로젝트(문제은행)** 와 **시험(응시)** 은 저장/ZIP 포맷이 분리되어 있습니다.

## 시작

```bash
bun install
bun run dev
```

| 경로 | 역할 | 패키지 |
|------|------|--------|
| `/` | 홈 | — |
| `/project` | CSV 라이브러리 · 문제은행 · 시험 조립 | `*.project.zip` (`project.json`) |
| `/exam` | 응시 · 실행 | `*.exam.zip` (`exam.json`) |

## 워크플로

1. **프로젝트**에서 CSV를 여러 개 라이브러리에 넣음  
2. 문제은행에서 문제 작성/복제, 문제마다 사용할 CSV 체크  
3. 시험 조립 후 **시험 ZIP 내보내기** 또는 **시험으로 보내기**  
4. **`/exam`** 에서 `.exam.zip` 만으로 풀이 (프로젝트 편집과 분리)

## 빌드

```bash
bun run build
```

## 기출 / 독자제공 프로젝트 (로컬 전용)

문제 원문과 생성된 패키지는 `private/` 에만 두며 **GitHub에 올리지 않습니다**.

```bash
bun run build:gichul    # 퇴딴짓 + part4
bun run build:golden    # 골든래빗 09 독자제공 (기출변형·수준별 모의고사)
```

- [docs/private-gichul.md](docs/private-gichul.md) — build then **프로젝트 불러오기** (`gichul.project.zip`)
- [docs/private-goldenrabbit.md](docs/private-goldenrabbit.md) — build then **프로젝트 불러오기** (`goldenrabbit.project.zip`)
