#!/usr/bin/env bash
# 수동(passive) 공개정보 수집 래퍼. 대상 서비스에 부하를 주거나 인증을 시도하지 않는다.
# 사용: scripts/osint_collect.sh <도메인> <케이스폴더>
# 수행: DNS, WHOIS, crt.sh 인증서 로그, robots.txt, sitemap.xml, 메인 페이지 헤더, (있으면) spiderfoot passive
set -euo pipefail

DOMAIN="${1:?도메인 필요}"; CASE_DIR="${2:?케이스 폴더 필요}"
OUT="$CASE_DIR/osint"; mkdir -p "$OUT"
LOG="$OUT/00_collection-log.md"
UA="RocketSec-PassiveCheck/0.1 (+contact@aplusnet.net)"
SLEEP=1.5   # 요청 간 최소 간격(초). 초당 1요청 이하 유지.

ts(){ date '+%F %H:%M:%S'; }
log(){ echo "| $(ts) | $1 | $2 | $3 |" >> "$LOG"; }
fetch(){ # fetch <url> <outfile>  — 단일 GET, 리다이렉트 5회, 타임아웃 15초
  sleep "$SLEEP"
  curl -sS -L --max-redirs 5 --max-time 15 -A "$UA" -o "$2" -w '%{http_code}' "$1" 2>/dev/null || echo "ERR"
}

if [ ! -f "$LOG" ]; then
  cat > "$LOG" <<EOF
# 공개정보 수집 로그 — $DOMAIN
방식: passive only (로그인·인증·폼 제출·스캔 없음). 요청 간격 ${SLEEP}초.

| 시각 | 대상 | 방법 | 결과 |
|---|---|---|---|
EOF
fi

# 1. DNS
for t in A AAAA MX NS TXT CNAME; do
  if command -v dig >/dev/null; then dig +short "$DOMAIN" "$t" > "$OUT/dns_$t.txt" 2>/dev/null || true; fi
done
log "$DOMAIN" "dig A/AAAA/MX/NS/TXT/CNAME" "dns_*.txt"

# 2. WHOIS
if command -v whois >/dev/null; then whois "$DOMAIN" > "$OUT/whois.txt" 2>/dev/null || true; log "$DOMAIN" "whois" "whois.txt"; else log "$DOMAIN" "whois" "도구 없음"; fi

# 3. 인증서 투명성 로그 (서브도메인 단서) → scripts/parse_crtsh.py 로 정리
code=$(fetch "https://crt.sh/?q=%25.$DOMAIN&output=json" "$OUT/crtsh.json")
log "crt.sh" "GET json" "HTTP $code"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if command -v python3 >/dev/null && [ -s "$OUT/crtsh.json" ]; then
  if n=$(python3 "$SCRIPT_DIR/parse_crtsh.py" "$DOMAIN" "$OUT/crtsh.json" "$OUT" 2>"$OUT/crtsh.err"); then
    log "crt.sh" "서브도메인 정리(parse_crtsh.py)" "${n}건 → subdomains.txt, subdomains.md"
  else
    log "crt.sh" "서브도메인 정리(parse_crtsh.py)" "실패: $(head -c 120 "$OUT/crtsh.err" | tr '\n' ' ')"
  fi
  rm -f "$OUT/crtsh.err"
else
  log "crt.sh" "서브도메인 정리" "건너뜀 (응답 없음 또는 python3 없음)"
fi

# 4. robots.txt / sitemap.xml / 메인 헤더
for p in robots.txt sitemap.xml; do
  code=$(fetch "https://$DOMAIN/$p" "$OUT/$p")
  log "https://$DOMAIN/$p" "GET" "HTTP $code"
done
sleep "$SLEEP"
curl -sS -I -L --max-redirs 5 --max-time 15 -A "$UA" "https://$DOMAIN/" > "$OUT/headers.txt" 2>/dev/null || true
log "https://$DOMAIN/" "HEAD (헤더만)" "headers.txt"

# 5. 메인 페이지 1회 GET → 처리방침 링크 후보 추출 (열람은 수동 단계에서)
code=$(fetch "https://$DOMAIN/" "$OUT/index.html")
log "https://$DOMAIN/" "GET 1회" "HTTP $code"
grep -oiE 'href="[^"]*(privacy|개인정보)[^"]*"' "$OUT/index.html" 2>/dev/null | sort -u > "$OUT/policy-link-candidates.txt" || true
log "index.html" "처리방침 링크 후보 추출" "$(wc -l < "$OUT/policy-link-candidates.txt" 2>/dev/null || echo 0)건"

# 6. spiderfoot (있을 때만, passive 모듈만)
if command -v sf.py >/dev/null || command -v spiderfoot >/dev/null; then
  SF=$(command -v sf.py || command -v spiderfoot)
  MODS="sfp_dnsresolve,sfp_crt,sfp_whois,sfp_sslcert,sfp_dnscommonsrv"
  "$SF" -s "$DOMAIN" -m "$MODS" -o csv > "$OUT/spiderfoot.csv" 2>/dev/null || true
  log "spiderfoot" "passive 모듈만: $MODS" "spiderfoot.csv"
else
  log "spiderfoot" "미설치" "건너뜀 (기본 도구 결과만 사용)"
fi

cat > "$OUT/surface-inventory.md" <<EOF
# 수집 접점 목록 (수동 확인 체크리스트)
상태: 확인함 / 미확인 / 접근불가 / 해당없음. 모든 행에 URL·확인일시·캡처 파일명.

| 접점 | URL | 상태 | 확인일시 | 캡처 | 비고 |
|---|---|---|---|---|---|
| 개인정보처리방침 (현재) | | | | | policy-link-candidates.txt 참고 |
| 개인정보처리방침 (이전 버전) | | | | | |
| 회원가입 화면 | | | | | 입력란·동의문구 |
| 간편가입(소셜 로그인) | | | | | 제공 항목 |
| 주문·결제 화면 | | | | | 비로그인 진입 가능 범위 |
| 고객센터·채팅 위젯 | | | | | 위젯 스크립트 도메인 |
| 이벤트·뉴스레터 폼 | | | | | |
| 채용 페이지 | | | | | |
| 앱스토어 (iOS/Android) 라벨 | | | | | |
| 공식 SNS | | | | | |
| 오프라인 안내 (매장·행사·CCTV) | | | | | |
| 유출·처분 이력 (뉴스·공시) | | | | | |
| 인증 현황 (isms.kisa.or.kr) | | | | | |
EOF

echo "완료: $OUT"
echo "다음: $OUT/surface-inventory.md 를 브라우저(비로그인)로 채우고 캡처를 $OUT/captures/ 에 저장"
