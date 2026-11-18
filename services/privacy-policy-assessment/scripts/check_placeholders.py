#!/usr/bin/env python3
"""전달 전 치환자·표 깨짐 검사 (QA Gate Q-3·Q-4 자동화).

사용: python3 scripts/check_placeholders.py <케이스폴더 또는 .md 파일...>
- 케이스폴더를 주면 output/*.md 를 검사한다.
- 검사 항목
  E1 템플릿 치환자 `{{...}}` 잔존                        (Q-3, 오류)
  E2 체크리스트 참조 표시 `[A-01]` 형식 잔존              (Q-3, 오류)
  E3 표 행의 열 수가 헤더와 다름(셀 안 `|` 등)            (Q-4, 오류)
  E4 원문 인용 칸 예시값 `"…"` 잔존                       (Q-3, 오류)
  W1 `확인 필요` 표기 수                                   (정보: 의도된 표기, 개수만 보고)
- 코드 블록(```) 안은 검사하지 않는다. 표 구분선은 헤더 다음 줄의 |---| 로 판단한다.
종료코드: 0 = 오류 없음, 1 = 오류 있음, 2 = 입력 없음. 네트워크 요청 없음.
"""
import glob
import os
import re
import sys

P_PH = re.compile(r"\{\{[^{}]*\}\}")
P_REF = re.compile(r"\[(?:[ABCDE]-\d{2})(?:\]\[[ABCDE]-\d{2})*\]")
P_EX = re.compile(r'"…"')
P_SEP = re.compile(r"^\|\s*:?-{2,}")


def cells(line):
    body = line.strip()
    if body.startswith("|"):
        body = body[1:]
    if body.endswith("|"):
        body = body[:-1]
    # 백슬래시로 이스케이프된 \| 와 인라인 코드 안의 | 는 셀 경계가 아니다
    body = re.sub(r"`[^`]*`", lambda m: m.group(0).replace("|", "¦"), body)
    return [c for c in re.split(r"(?<!\\)\|", body)]


def check(path):
    errs, info = [], 0
    lines = open(path, encoding="utf-8").read().split("\n")
    in_code, cols = False, None
    for i, line in enumerate(lines, 1):
        if line.strip().startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        for m in P_PH.finditer(line):
            errs.append((i, "E1 치환자", m.group(0)))
        for m in P_REF.finditer(line):
            errs.append((i, "E2 참조표시", m.group(0)))
        if P_EX.search(line):
            errs.append((i, "E4 예시값", '"…"'))
        info += line.count("확인 필요")
        if line.lstrip().startswith("|"):
            nxt = lines[i] if i < len(lines) else ""
            if P_SEP.match(nxt.strip()):
                cols = len(cells(line))
            elif P_SEP.match(line.strip()):
                pass
            elif cols is not None and len(cells(line)) != cols:
                errs.append((i, "E3 열수", f"{len(cells(line))}열 (헤더 {cols}열)"))
        else:
            cols = None
    return errs, info


def main(argv):
    targets = []
    for a in argv[1:]:
        if os.path.isdir(a):
            targets += sorted(glob.glob(os.path.join(a, "output", "*.md")))
        elif a.endswith(".md"):
            targets.append(a)
    if not targets:
        print(__doc__, file=sys.stderr)
        return 2
    total = 0
    print("| 파일 | 오류 | 확인 필요 표기 |\n|---|---|---|")
    detail = []
    for t in targets:
        errs, info = check(t)
        total += len(errs)
        print(f"| {os.path.basename(t)} | {len(errs)} | {info} |")
        detail += [(os.path.basename(t),) + e for e in errs]
    if detail:
        print("\n| 파일 | 줄 | 유형 | 내용 |\n|---|---|---|---|")
        for f, ln, kind, txt in detail[:200]:
            print(f"| {f} | {ln} | {kind} | `{txt.replace('|', '¦')}` |")
        if len(detail) > 200:
            print(f"\n… 외 {len(detail) - 200}건")
    print(f"\n결과: {'통과' if total == 0 else f'오류 {total}건 — 전달 불가 (QA Gate Q-3·Q-4)'}")
    return 0 if total == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
