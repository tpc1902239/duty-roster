"""檢查排班結果（對應 VBA cheakWork 與新增限制式），回傳違規清單。"""
from solver import DUTY, R1A, R1B, R2A, R2B, REST_ROWS, NIGHT_REST, R2_HOURS, TRAINING_REST


def check(grid, extra, workers, night, instructor, su, cadre_max=9):
    errs = []
    W = set(workers)
    occ = {}
    for r in range(9):
        for h in range(24):
            p = grid[r][h]
            if p is not None:
                occ.setdefault((p, h), []).append(r)
    for row in extra:
        for h, p in enumerate(row['cells']):
            if p is not None:
                occ.setdefault((p, h), []).append('外' + row['flag'])
    for (p, h), rs in occ.items():
        if len(rs) > 1:
            errs.append(f'C01 重複 {p} @{h}')
        if p not in W:
            errs.append(f'C09 未上班 {p} @{h}')
    for h in range(24):
        for r in (DUTY, R1A, R1B):
            if grid[r][h] is None:
                errs.append(f'C08 空缺 列{r} @{h}')
        if h in R2_HOURS:
            for r in (R2A, R2B):
                if grid[r][h] is None:
                    errs.append(f'C08 空缺 列{r} @{h}')
    for h in range(1, 24):
        p = grid[DUTY][h]
        if p and p != grid[DUTY][h - 1] and p in [grid[r][h - 1] for r in (R1A, R1B, R2A, R2B)]:
            errs.append(f'C02 救護接值班 {p} @{h}')
    def is_duty(p, h):
        return any(r in (DUTY, R1A, R1B, R2A, R2B) or (isinstance(r, str) and r != '外C') for r in occ.get((p, h), []))
    for p in W:
        if p != su:
            run = 0
            for h in range(24):
                run = run + 1 if is_duty(p, h) else 0
                if run > 8:
                    errs.append(f'C03 連續超過8小時 {p}')
                    break
        rest = [h for h in range(24) for r in REST_ROWS if grid[r][h] == p]
        if not rest:
            errs.append(f'C05 沒排休息 {p}')
        if p > cadre_max and any(h in NIGHT_REST for h in rest) and len(rest) <= 2:
            errs.append(f'C15 夜間休息 {p}')
        if p in night and any(is_duty(p, h) for h in range(4)):
            errs.append(f'C10 深夜勤後12時前排勤 {p}')
        if p == instructor and any(r in (R1A, R1B, R2A, R2B) for h in (8, 9) for r in occ.get((p, h), [])):
            errs.append(f'C07 救護訓練教官排救護 {p}')
        if p == su and any(r != DUTY for r in occ.get((p, 7), [])):
            errs.append(f'C07 體技能教官15時不在分隊 {p}')
        if any(h in TRAINING_REST for h in rest) and len(rest) <= 2:
            errs.append(f'C16提醒 14～16時休息 {p}')
    return errs
