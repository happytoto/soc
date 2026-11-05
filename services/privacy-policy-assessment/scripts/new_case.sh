#!/usr/bin/env bash
# 케이스 폴더 생성: 템플릿을 복사하고 접수 양식을 만든다.
# 사용: scripts/new_case.sh "<기업명>" <도메인> [--mode new|upgrade]
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "사용법: $0 \"<기업명>\" <도메인> [--mode new|upgrade]" >&2
  exit 1
fi

COMPANY="$1"; DOMAIN="$2"; MODE="new"
if [ "${3:-}" = "--mode" ] && [ -n "${4:-}" ]; then MODE="$4"; fi

BASE="$(cd "$(dirname "$0")/.." && pwd)"
SAFE_NAME="$(echo "$COMPANY" | tr -cd '[:alnum:]가-힣_-' )"
CASE_DIR="$BASE/cases/$(date +%F)_${SAFE_NAME}"

if [ -e "$CASE_DIR" ]; then
  echo "이미 존재: $CASE_DIR" >&2
  exit 1
fi

mkdir -p "$CASE_DIR"/{input,osint/captures,review,delivery,output}
# 표준 표지 블록을 각 산출물 템플릿 앞에 붙여 복사 (_cover-block.md 자체는 제외)
for t in "$BASE"/templates/0*.md; do
  { cat "$BASE/templates/_cover-block.md" "$t"; } | sed -e "s/{{기업명}}/$COMPANY/g" -e "s/{{도메인}}/$DOMAIN/g" -e "s/{{YYYY-MM-DD}}/$(date +%F)/g" > "$CASE_DIR/output/$(basename "$t")"
done
cp "$BASE/review/cross-check-prompt.md" "$CASE_DIR/review/" 2>/dev/null || true

cat > "$CASE_DIR/00_intake.md" <<EOF
# 접수 (Intake)

| 항목 | 내용 |
|---|---|
| 기업명 | $COMPANY |
| 도메인 | $DOMAIN |
| 모드 | $MODE (new=신규 작성, upgrade=기존 문서 고도화·현행화) |
| 접수일 | $(date +%F) |
| 서비스 목록 (웹·앱·오프라인) | |
| 보유 인증 (ISMS/ISMS-P/간편) | |
| 고객 담당자 | |
| 계약 범위 (policy / flow / full) | |
| 납기 | |
| 법령 기준일 (law-watch) | |
| 담당 컨설턴트 / 검증자 | |
| 이해충돌 확인 (심사 참여 금지 대상) | |

## OSINT 범위 통지
- 통지일:
- 통지 대상 도메인: $DOMAIN
- 방식: 비침투·수동(passive). 로그인·인증·폼 제출·스캔 없음.
EOF

cat > "$CASE_DIR/access-log.md" <<EOF
# 열람 기록
| 일시 | 이름 | 목적 |
|---|---|---|
| $(date '+%F %H:%M') | $(whoami) | 케이스 생성 |
EOF

cat > "$CASE_DIR/interview-questions.md" <<EOF
# 인터뷰 질문 (공개정보로 확인 불가 항목)
| 질문 | 관련 기준 | 필요한 증적 |
|---|---|---|
EOF

cat > "$CASE_DIR/review/cross-check.md" <<EOF
# 교차검증 기록 (G4)
검증자: · 일시:

| # | 결함 | 반박 | 결과 (유지/강등/삭제) | 사유 |
|---|---|---|---|---|
EOF

cat > "$CASE_DIR/delivery/approval.md" <<EOF
# 전달 승인
| 항목 | 값 |
|---|---|
| QA 게이트 통과 | |
| 케이스 점수 | /100 |
| 승인자 | |
| 승인 일시 | |
| 전달 채널 | |
| 전달 파일 | |
EOF

echo "케이스 생성: $CASE_DIR"
echo "다음: scripts/osint_collect.sh $DOMAIN \"$CASE_DIR\""
