"""把程式結果的違規分成：程式自己排出來的 vs. 原本就固定的格子（行事曆外勤、月班表）造成的。"""
import sys, re
from data import load, night_workers, ON_DUTY
from solver import prefill, solve, DUTY
from check import check

months = [load(f) for f in sys.argv[1:]]
tot = {'days': 0, 'clean': 0, 'fixed_only': 0, 'solver': 0}
solver_issues = []
for mi, mo in enumerate(months):
    hist = {}
    for d in sorted(mo['days']):
        if d - 1 in mo['roster']:
            prev_st = mo['roster'][d - 1]['status']
        elif mi > 0 and d == 1:
            prev_st = months[mi - 1]['roster'][max(months[mi - 1]['roster'])]['status']
        else:
            continue
        st = mo['roster'][d]['status']
        W = [p for p, v in st.items() if v in ON_DUTY]
        night = night_workers(prev_st) & set(W)
        instr = mo['training'].get(d)
        extra = mo['days'][d][9:]
        g = prefill(st)
        busy = {(p, h) for e in extra for h, p in enumerate(e['cells']) if p}
        for r in range(9):
            for h in range(24):
                if g[r][h] is not None and (g[r][h], h) in busy:
                    g[r][h] = None
        out, _ = solve(W, g, extra, night, instr, hist)
        for h in range(4):
            if out[DUTY][h]:
                hist[out[DUTY][h]] = hist.get(out[DUTY][h], 0) + 1
        filled = {(out[r][h], h) for r in range(9) for h in range(24) if g[r][h] is None and out[r][h]}
        filled_duty = {(out[r][h], h) for r in range(5) for h in range(24) if g[r][h] is None and out[r][h]}
        errs = check(out, extra, W, night, instr, g[DUTY][14])
        mine = []
        for e in errs:
            m = re.match(r'(C\d+) \S+ (\d+)(?: @(\d+))?', e)
            code, p, h = m.group(1), int(m.group(2)), m.group(3)
            hs = [int(h)] if h else {'C10': range(4), 'C07': (7, 8, 9)}.get(code, range(24))
            pool = filled_duty if code in ('C10', 'C07', 'C03') else filled
            if any((p, k) in pool for k in hs):
                mine.append(e)
        tot['days'] += 1
        if not errs:
            tot['clean'] += 1
        elif not mine:
            tot['fixed_only'] += 1
        else:
            tot['solver'] += 1
            solver_issues.append((mi, d, mine))
print(tot)
for x in solver_issues:
    print(x)
