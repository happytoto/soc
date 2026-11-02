#!/usr/bin/env bash
# 흐름도(Mermaid) → PNG/SVG 변환. 05_data-flow-diagram.md 안의 ```mermaid 블록을 모두 추출해 각각 이미지로 만든다.
# 사용: scripts/render_diagram.sh <05_data-flow-diagram.md> [출력폴더]
# 요구: Node(npx), Chromium. 클라우드 환경은 /opt/pw-browsers/chromium 을 쓰고, 로컬 PC는 puppeteer 기본 브라우저를 쓴다.
set -euo pipefail
SRC="${1:?흐름도 md 파일 필요}"; OUT="${2:-$(dirname "$SRC")/diagrams}"
mkdir -p "$OUT"
CFG="$OUT/.puppeteer.json"
if [ -x /opt/pw-browsers/chromium ]; then
  echo '{"executablePath":"/opt/pw-browsers/chromium","args":["--no-sandbox","--disable-setuid-sandbox"]}' > "$CFG"
else
  echo '{"args":["--no-sandbox"]}' > "$CFG"
fi

# 블록 추출
n=0
awk -v out="$OUT" '
  /^```mermaid/ {inb=1; n++; f=sprintf("%s/flow-%02d.mmd", out, n); next}
  /^```/ && inb {inb=0; close(f); next}
  inb {print > f}
' "$SRC"
ls "$OUT"/flow-*.mmd >/dev/null 2>&1 || { echo "mermaid 블록 없음: $SRC" >&2; exit 1; }

for f in "$OUT"/flow-*.mmd; do
  base="${f%.mmd}"
  npx -y @mermaid-js/mermaid-cli -p "$CFG" -i "$f" -o "$base.png" -b white >/dev/null
  npx -y @mermaid-js/mermaid-cli -p "$CFG" -i "$f" -o "$base.svg" -b white >/dev/null
  echo "생성: $base.png, $base.svg"
done
