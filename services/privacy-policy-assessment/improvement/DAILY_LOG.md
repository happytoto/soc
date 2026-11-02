# 일일 개선 기록

| 날짜 | 서비스 점수 | 변경 내용 | 다음 할 일 |
|---|---|---|---|
| 2026-11-02 | 38 | 서비스 매뉴얼 v0.1.0 최초 작성: README, MANUAL(Phase 0~7, 게이트 G0~G5), SKILL, 체크리스트 3종, 템플릿 6종, QA 게이트, 점수표, 보안 수칙, 스크립트 2종, 백로그 12건 | BACKLOG #1 법 §30·§30의2·시행령 §31 원문 검증 |
| 2026-11-02 (2차) | 46 | 법령 검색 확인 7건(L-01~04, L-10, L-11, L-14 → `[검색확인]`, 2026-09-11 개정법·2026-04 작성지침 파악), SEARCH-NOTES 저장. BACKLOG #3 완료(모의심사 21항목 관찰 포인트), #9 완료(교차검증 프롬프트). 체크리스트 E 섹션 2026 개정 반영. 원문 대조는 네트워크 차단(law.go.kr DNS)으로 불가 → 환경 Allowed domains 추가 필요 | BACKLOG #1 원문 대조(도메인 허용 후) 또는 #6 샘플 케이스 수행 |
| 2026-11-02 (3차) | 55 | 자동화 3종 추가·검증: `score.py`(체크리스트→점수, 합성 데이터 73.7점 산출 확인), `render_diagram.sh`(Mermaid→PNG/SVG, Chromium 사용 확인), `export_pdf.sh`(pandoc+Chromium PDF). 표지 블록 `_cover-block.md` 신설, `new_case.sh`가 6종 템플릿에 자동 삽입. BACKLOG #8·#11·#12 완료. 일일 개선 세션 수동 실행(cse_01S5uMGRkS4FHyWh2CDVUzah)으로 law.go.kr 원문 대조 시도 중 | #1 원문 대조 결과 확인 → #6 샘플 케이스 |
| 2026-11-03 | 55 | law.go.kr 접근: 불가(curl 000, 프록시 CONNECT 403 · WebFetch ENOTFOUND) · pipc.go.kr 접근: 불가(curl 000, 프록시 CONNECT 403) | 법령 원문 대조(L-01~03) 건너뜀, law-watch 상태 변경 없음. 법령 근거 검증률 재계산: 1×1.0 + 7×0.5 = 4.5/14 × 25 = 8.0점(변동 없음), 합계 55 유지 | 환경 Allowed domains에 law.go.kr·pipc.go.kr 추가 후 BACKLOG #1 재시도, 또는 #6 샘플 케이스 |
