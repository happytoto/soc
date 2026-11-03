#!/usr/bin/env python3
"""crt.sh 인증서 투명성 로그(JSON) → 서브도메인 목록 정리.

사용: python3 scripts/parse_crtsh.py <도메인> <crtsh.json> <출력폴더>
생성:
  <출력폴더>/subdomains.txt  — 대상 도메인 범위 내 호스트명, 한 줄에 하나, 정렬·중복 제거 (와일드카드 `*.`는 제거)
  <출력폴더>/subdomains.md   — 호스트명별 인증서 수·최초 발급일·최종 만료일·와일드카드 여부·만료 여부 표

규칙:
- name_value(줄바꿈 구분)와 common_name을 모두 읽는다.
- 소문자화, 앞뒤 공백·점 제거, `*.` 접두 제거. 이메일·IP·빈 값은 버린다.
- 대상 도메인과 같거나 그 하위(`.<도메인>`으로 끝남)인 이름만 남긴다. 같은 인증서의 타 도메인 SAN은 제외한다.
- 입력이 JSON이 아니면(crt.sh 오류 HTML 등) 종료코드 2, 빈 배열이면 종료코드 3. 파일은 만들지 않는다.
- 네트워크 요청을 하지 않는다. 입력 파일만 읽는다.
"""
import json
import re
import sys
from datetime import date, datetime

HOST_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$")
IP_RE = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")


def norm(name: str):
    n = name.strip().lower().strip(".")
    wildcard = n.startswith("*.")
    if wildcard:
        n = n[2:]
    if not n or "@" in n or IP_RE.match(n) or not HOST_RE.match(n):
        return None, wildcard
    return n, wildcard


def in_scope(n: str, domain: str) -> bool:
    return n == domain or n.endswith("." + domain)


def parse_ts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "")).date()
    except ValueError:
        return None


def main(argv):
    if len(argv) != 4:
        print(__doc__, file=sys.stderr)
        return 1
    domain = argv[1].strip().lower().strip(".")
    src, out_dir = argv[2], argv[3].rstrip("/")
    try:
        with open(src, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        print(f"crt.sh 응답이 JSON이 아님 또는 읽기 실패: {e}", file=sys.stderr)
        return 2
    if not isinstance(data, list) or not data:
        print("crt.sh 결과 없음(빈 배열)", file=sys.stderr)
        return 3

    rows = {}  # name -> dict(certs, first, last, wildcard)
    for e in data:
        if not isinstance(e, dict):
            continue
        cands = str(e.get("name_value", "")).split("\n") + [str(e.get("common_name", ""))]
        nb, na = parse_ts(e.get("not_before")), parse_ts(e.get("not_after"))
        seen = set()
        for c in cands:
            n, wc = norm(c)
            if n is None or n in seen or not in_scope(n, domain):
                continue
            seen.add(n)
            r = rows.setdefault(n, {"certs": 0, "first": None, "last": None, "wildcard": False})
            r["certs"] += 1
            r["wildcard"] = r["wildcard"] or wc
            if nb and (r["first"] is None or nb < r["first"]):
                r["first"] = nb
            if na and (r["last"] is None or na > r["last"]):
                r["last"] = na

    names = sorted(rows)
    today = date.today()
    with open(f"{out_dir}/subdomains.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(names) + ("\n" if names else ""))
    with open(f"{out_dir}/subdomains.md", "w", encoding="utf-8") as f:
        f.write(f"# crt.sh 서브도메인 정리 — {domain}\n\n")
        f.write(f"원본: crtsh.json ({len(data)}건) · 정리일: {today} · 범위 내 호스트명 {len(names)}건\n")
        f.write("만료된 인증서만 있는 이름은 현재 미사용일 수 있다. 실제 운영 여부는 DNS·HTTP로 별도 확인한다(수동 단계).\n\n")
        f.write("| 호스트명 | 인증서 수 | 최초 발급 | 최종 만료 | 와일드카드 | 상태 |\n|---|---|---|---|---|---|\n")
        for n in names:
            r = rows[n]
            status = "-" if r["last"] is None else ("만료" if r["last"] < today else "유효")
            f.write(f"| {n} | {r['certs']} | {r['first'] or '-'} | {r['last'] or '-'} | {'예' if r['wildcard'] else ''} | {status} |\n")
    print(f"{len(names)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
