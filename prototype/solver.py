"""一鍵補空缺：讀當天排班區（已填的格子不動），補值班、救護、休息的空格。"""
from ortools.sat.python import cp_model

DUTY, R1A, R1B, R2A, R2B = 0, 1, 2, 3, 4          # 值班、一救×2、二救×2
REST_ROWS = [5, 6, 7, 8]                           # 休息1～4
NIGHT_REST = range(14, 22)                         # 22 時～隔日 06 時（C15）
TRAINING_REST = (6, 7)                             # 14～16 時（C16，十五十體技能訓練）
R2_HOURS = range(0, 12)                            # 二救只排 08～19


def prefill(status, rows=None):
    """依月班表帶入固定格子（同 VBA TodatTotal）：宿、A1/A2、B1/B2、長。"""
    grid = [[None] * 24 for _ in range(9)]
    who = {v: p for p, v in status.items() if v in ('宿', 'A1', 'A2', 'B1', 'B2')}
    if '宿' in who:
        for h in range(14, 24):
            grid[DUTY][h] = who['宿']
    for code, row in (('A1', R1A), ('A2', R1B)):
        if code in who:
            for h in list(range(0, 8)) + list(range(12, 16)):
                grid[row][h] = who[code]
    for code, row in (('B1', R1A), ('B2', R1B)):
        if code in who:
            for h in list(range(8, 12)) + list(range(16, 24)):
                grid[row][h] = who[code]
    longs = [p for p, v in status.items() if v == '長']
    for i, p in enumerate(longs[:4]):
        for h in range(12, 24):
            grid[REST_ROWS[i]][h] = p
    return grid


def solve(workers, grid, extra, night, instructor, history, cadre_max=9, time_limit=10, disable=()):
    """
    workers: 今天上班的番號
    grid: 9×24，None 為空格（要補），數字為已排定
    extra: 外勤列 [{'cells': [...], 'flag': 'C'...}]，全部視為已排定
    night: 前一天 B 班、值宿人員（C10：12 時前不排勤務）
    instructor: 今天救護訓練教官（C07：16～17 時不排救護）
    history: {番號: 本月已排 08～12 值班時數}，用來平均分配
    """
    m = cp_model.CpModel()
    hard_over = []
    soft = []   # 明文規定但人力不足時只能放寬的（C07、C10、C15），每違反一小時扣 1000 分
    prefer = []  # 小原則（C16、08～12 值班一次四小時），每違反一次扣 50 分
    _add = m.Add

    def add(expr):
        if isinstance(expr, bool):
            if not expr:
                raise ValueError('固定格子本身就違反限制')
            return
        _add(expr)
    m.Add = add
    W = list(workers)
    x = {}
    for r in range(9):
        for h in range(24):
            if r in (R2A, R2B) and h not in R2_HOURS:
                continue
            for p in W:
                if grid[r][h] is None:
                    x[p, r, h] = m.NewBoolVar(f'x{p}_{r}_{h}')
    def at(p, r, h):
        if grid[r][h] == p:
            return 1
        return x.get((p, r, h), 0)
    busy_extra = {(p, h): 0 for p in W for h in range(24)}
    duty_extra = {(p, h): 0 for p in W for h in range(24)}
    for row in extra:
        for h, p in enumerate(row['cells']):
            if (p, h) in busy_extra:
                busy_extra[p, h] += 1
                if row['flag'] != 'C':
                    duty_extra[p, h] = 1

    # 每格最多一人；值班、救護必須補滿（C08）；休息列可空
    for r in range(9):
        for h in range(24):
            if grid[r][h] is not None:
                continue
            vs = [x[p, r, h] for p in W if (p, r, h) in x]
            if not vs:
                continue
            if r in REST_ROWS:
                m.Add(sum(vs) <= 1)
            else:
                m.Add(sum(vs) == 1)
    # 值班、二救、休息以兩小時為一段
    for r in [DUTY, R1A, R1B, R2A, R2B] + REST_ROWS:
        for h in range(0, 24, 2):
            for p in W:
                a, b = x.get((p, r, h)), x.get((p, r, h + 1))
                if a is not None and b is not None:
                    m.Add(a == b)
    # C01、C09：同一小時一人只做一件事（只用今天上班的人）
    for p in W if 'C01' not in disable else []:
        for h in range(24):
            m.Add(sum(at(p, r, h) for r in range(9)) + busy_extra[p, h] <= 1)
    duty = {(p, h): sum(at(p, r, h) for r in (DUTY, R1A, R1B, R2A, R2B)) + duty_extra[p, h]
            for p in W for h in range(24)}
    rest = {(p, h): sum(at(p, r, h) for r in REST_ROWS) for p in W for h in range(24)}
    su = grid[DUTY][14]
    for p in W:
        # C02：救護下一小時不能接值班
        for h in range(23 if 'C02' not in disable else 0):
            amb = sum(at(p, r, h) for r in (R1A, R1B, R2A, R2B))
            m.Add(amb + at(p, DUTY, h + 1) <= 1)
        # C03：連續服勤不超過 8 小時（值宿者除外）
        if p != su and 'C03' not in disable:
            for h in range(24 - 8):
                over = m.NewIntVar(0, 1, '')     # 只有固定格子本身就超時才會用到
                hard_over.append(over)
                m.Add(sum(duty[p, k] for k in range(h, h + 9)) <= 8 + over)
        # C14：每人休息 2 小時（「長」已固定休息者除外）
        fixed_rest = sum(1 for r in REST_ROWS for h in range(24) if grid[r][h] == p)
        if fixed_rest == 0 and 'C14' not in disable:
            m.Add(sum(rest[p, h] for h in range(24)) == 2)
            # C15：22～06 時不排休息，幹部（番號個位數）除外
            if p > cadre_max:
                for h in NIGHT_REST:
                    for r in REST_ROWS:
                        if (p, r, h) in x:
                            soft.append(x[p, r, h])
        # C10：前一天深夜勤，12 時前不排勤務
        if p in night:
            for h in range(4):
                for r in (DUTY, R1A, R1B, R2A, R2B):
                    if (p, r, h) in x:
                        soft.append(x[p, r, h])
        # C07：救護訓練教官 16～17 時不排救護
        if p == instructor:
            for h in (8, 9):
                for r in (R1A, R1B, R2A, R2B):
                    if (p, r, h) in x:
                        soft.append(x[p, r, h])

    # C07：體技能教官（值宿者）15 時要在分隊授課，不排救護、休息
    for r in (R1A, R1B, R2A, R2B) + tuple(REST_ROWS):
        if (su, r, 7) in x:
            soft.append(x[su, r, 7])
    # C16：14～16 時盡量不排休息
    for p in W:
        for r in REST_ROWS:
            for h in TRAINING_REST:
                if (p, r, h) in x:
                    prefer.append(x[p, r, h])
    # 08～12 值班原則上一人四小時
    for p in W:
        a, b = x.get((p, DUTY, 0)), x.get((p, DUTY, 2))
        if a is not None and b is not None:
            d = m.NewBoolVar('')
            m.Add(a - b <= d)
            m.Add(b - a <= d)
            prefer.append(d)

    # 公平性：08～12 值班依本月累計平均；當天工作量盡量平均
    load = {p: sum(duty[p, h] for h in range(24)) for p in W}
    mx = m.NewIntVar(0, 24, 'mx')
    for p in W:
        m.Add(load[p] <= mx)
    morning = sum(history.get(p, 0) * x[p, DUTY, h] for p in W for h in range(4) if (p, DUTY, h) in x)
    m.Minimize(1000 * sum(hard_over) + 1000 * sum(soft) + 50 * sum(prefer) + 10 * mx + morning)

    s = cp_model.CpSolver()
    s.parameters.max_time_in_seconds = time_limit
    s.parameters.num_workers = 8
    st = s.Solve(m)
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None, s.StatusName(st)
    out = [row[:] for row in grid]
    for (p, r, h), v in x.items():
        if s.Value(v):
            out[r][h] = p
    return out, s.StatusName(st)
