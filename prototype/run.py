"""用 9、10 月的實際資料回測：只保留月班表帶入的格子與外勤列，其餘由程式補。"""
import sys, time, statistics
from data import load, night_workers, ON_DUTY
from solver import prefill, solve, DUTY
from check import check

months = [load(f) for f in sys.argv[1:]]
summary = []
for mi, mo in enumerate(months):
    hist_auto, hist_human = {}, {}
    for d in sorted(mo['days']):
        rows = mo['days'][d]
        if d - 1 in mo['roster']:
            prev_st = mo['roster'][d - 1]['status']
        elif mi > 0 and d == 1:
            prev_st = months[mi - 1]['roster'][max(months[mi - 1]['roster'])]['status']
        else:
            continue
        st = mo['roster'][d]['status']
        workers = [p for p, v in st.items() if v in ON_DUTY]
        night = night_workers(prev_st) & set(workers)
        instr = mo['training'].get(d)
        human = [r['cells'] for r in rows[:9]]
        extra = rows[9:]
        grid = prefill(st)
        busy = {(p, h) for e in extra for h, p in enumerate(e['cells']) if p}
        for r in range(9):
            for h in range(24):
                if grid[r][h] is not None and (grid[r][h], h) in busy:
                    grid[r][h] = None
        t = time.time()
        out, status = solve(workers, grid, extra, night, instr, hist_auto)
        dt = time.time() - t
        su = grid[DUTY][14]
        e_h = check(human, extra, workers, night, instr, human[DUTY][14])
        e_a = check(out, extra, workers, night, instr, su) if out else ['無解']
        for hist, g in ((hist_auto, out), (hist_human, human)):
            if g:
                for h in range(4):
                    if g[DUTY][h]:
                        hist[g[DUTY][h]] = hist.get(g[DUTY][h], 0) + 1
        summary.append((mi, d, status, round(dt, 1), len(workers), e_h, e_a))
        print(f'M{mi} D{d:2d} {status:8s} {dt:4.1f}s 人數{len(workers):2d} 人工違規{len(e_h):2d} 程式違規{len(e_a):2d}', e_a[:3], '| 人工:', e_h[:4])
    # 08～12 值班分配（只看非 A/B/宿 的人）
    for name, hist in (('程式', hist_auto), ('人工', hist_human)):
        v = list(hist.values())
        print(f'M{mi} {name} 08-12值班：{len(v)}人，最多{max(v)}小時，最少{min(v)}，標準差{statistics.pstdev(v):.2f}')
