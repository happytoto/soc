#!/usr/bin/env python3
"""fetch_policy.sh 산출(input/policy_*.md 헤더)로 03 보고서의 "대상"·"비교 버전" 행을 채운다.

사용: python3 scripts/fill_target_row.py <케이스폴더>

- 가장 먼저 저장한 policy_<날짜>.md 를 현행본, 같은 날 `_2` 이후 파일을 이전 버전으로 본다.
- 채우는 값: 처리방침 URL(출처 URL), 확인일(확인일시의 날짜), 시행일(본문에서 "시행일"·"시행일자"·"적용일" 뒤의 날짜를 찾은 경우만).
  시행일을 찾지 못하면 `{{}}`를 "확인 필요"로 바꾼다. 추정하지 않는다.
- 이미 채워진 칸(치환자가 없는 칸)은 건드리지 않는다. 단, 이 스크립트가 넣은 "없음 (이전 버전 미수집…"은 이전 버전 수집 후 다시 채운다. 네트워크 요청 없음.
"""
import glob
import os
import re
import sys

AUTO_NONE = "없음 (이전 버전 미수집"  # 자동 기입 표시: 이후 이전 버전을 수집하면 다시 채운다
DATE = r"(20\d\d)\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})"


def header(md):
    t = open(md, encoding="utf-8").read()
    url = re.search(r"^\| 출처 URL \| (.+?) \|$", t, re.M)
    chk = re.search(r"^\| 확인일시 \| (\d{4}-\d{2}-\d{2})", t, re.M)
    body = t.split("\n---\n", 1)[-1]
    ef = re.search(r"(시행\s*일자?|적용\s*일자?)\s*[:：]?\s*" + DATE, body)
    efd = f"{ef.group(2)}-{int(ef.group(3)):02d}-{int(ef.group(4)):02d}" if ef else None
    return (url.group(1).strip() if url else None, chk.group(1) if chk else None, efd)


def main(argv):
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 1
    case = argv[1].rstrip("/")
    files = sorted(glob.glob(f"{case}/input/policy_*.md"),
                   key=lambda p: (os.path.basename(p)[:17], int((re.search(r"_(\d+)\.md$", os.path.basename(p)[17:]) or [0, 1])[1])))
    report = f"{case}/output/03_policy-evaluation-report.md"
    if not files or not os.path.exists(report):
        print("건너뜀: input/policy_*.md 또는 03 보고서 없음", file=sys.stderr)
        return 3
    cur, prev = files[0], (files[1] if len(files) > 1 else None)
    url, chk, efd = header(cur)
    s = open(report, encoding="utf-8").read()
    changed = []
    m = re.search(r"^\| 대상 \| (.*) \|$", s, re.M)
    if m and "{{" in m.group(1):
        row = m.group(1)
        if url:
            row = row.replace("{{처리방침 URL}}", url)
        row = row.replace("시행일 {{}}", f"시행일 {efd or '확인 필요'}", 1)
        if chk:
            row = row.replace("확인일 {{}}", f"확인일 {chk}", 1)
        s = s[:m.start(1)] + row + s[m.end(1):]
        changed.append("대상")
    m = re.search(r"^\| 비교 버전 \| (.*) \|$", s, re.M)
    if m and ("{{" in m.group(1) or m.group(1).startswith(AUTO_NONE)):
        if prev:
            purl, pchk, pefd = header(prev)
            val = f"{purl} (시행일 {pefd or '확인 필요'} / 확인일 {pchk}) — input/{os.path.basename(prev)}"
        else:
            val = AUTO_NONE + " — 공개되어 있으면 fetch_policy.sh <이전버전URL>로 저장)"
        s = s[:m.start(1)] + val + s[m.end(1):]
        changed.append("비교 버전")
    open(report, "w", encoding="utf-8").write(s)
    print("채움: " + (", ".join(changed) if changed else "없음(이미 채워짐)"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
