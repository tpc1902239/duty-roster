// 一鍵補空缺：已填的格子不動，補值班、救護、休息的空格。
// 與 prototype/solver.py 相同的模型，改用 HiGHS（整數規劃）求解，可在瀏覽器執行。

export const DUTY = 0, R1A = 1, R1B = 2, R2A = 3, R2B = 4;
export const REST_ROWS = [5, 6, 7, 8];                 // 休息1～4
export const AMB_ROWS = [R1A, R1B, R2A, R2B];
export const DUTY_ROWS = [DUTY, R1A, R1B, R2A, R2B];
export const NIGHT_REST = [14, 15, 16, 17, 18, 19, 20, 21];   // 22 時～隔日 06 時（C15）
export const TRAINING_REST = [6, 7];                   // 14～16 時（C19）
const R2_HOURS = 12;                                    // 二救只排 08～19

const W_HARD = 1000;    // 明文規定但被固定格子逼到時才放寬（C03、C07、C10、C15）
const W_PREFER = 50;    // 小原則（C19、C20）
const W_LOAD = 10;      // 當天工作量平均

// 依月班表帶入固定格子（同 VBA TodatTotal）：宿、A1/A2、B1/B2、長
export function prefill(status) {
  const grid = Array.from({ length: 9 }, () => Array(24).fill(null));
  const who = {};
  for (const [p, v] of Object.entries(status)) if (['宿', 'A1', 'A2', 'B1', 'B2'].includes(v)) who[v] = Number(p);
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  if (who['宿']) for (const h of range(14, 24)) grid[DUTY][h] = who['宿'];
  for (const [code, row] of [['A1', R1A], ['A2', R1B]]) {
    if (who[code]) for (const h of [...range(0, 8), ...range(12, 16)]) grid[row][h] = who[code];
  }
  for (const [code, row] of [['B1', R1A], ['B2', R1B]]) {
    if (who[code]) for (const h of [...range(8, 12), ...range(16, 24)]) grid[row][h] = who[code];
  }
  const longs = Object.entries(status).filter(([, v]) => v === '長').map(([p]) => Number(p));
  longs.slice(0, 4).forEach((p, i) => { for (const h of range(12, 24)) grid[REST_ROWS[i]][h] = p; });
  return grid;
}

/**
 * workers: 今天上班的番號；grid: 9×24（null 為空格）；extra: 外勤列（全部視為已排定）
 * night: 前一天 B 班、值宿；instructor: 救護訓練教官；history: {番號: 本月 08～12 值班時數}
 * highs: 已載入的 HiGHS 物件
 */
export function solve(highs, { workers, grid, extra, night, instructor, history, cadreMax = 9 }) {
  const W = [...workers];
  const Wset = new Set(W);
  const su = grid[DUTY][14];
  const x = new Map();                                   // key "p,r,h" → 變數名
  const key = (p, r, h) => `${p},${r},${h}`;
  const bins = [];
  for (let r = 0; r < 9; r++) {
    for (let h = 0; h < 24; h++) {
      if ((r === R2A || r === R2B) && h >= R2_HOURS) continue;
      if (grid[r][h] !== null) continue;
      for (const p of W) {
        const name = `x_${p}_${r}_${h}`;
        x.set(key(p, r, h), name);
        bins.push(name);
      }
    }
  }
  const v = (p, r, h) => x.get(key(p, r, h));
  const fixedAt = (p, r, h) => (grid[r][h] === p ? 1 : 0);

  const busyExtra = new Map();
  const dutyExtra = new Map();
  for (const row of extra) {
    row.cells.forEach((p, h) => {
      if (p === null || !Wset.has(p)) return;
      busyExtra.set(key(p, 0, h), (busyExtra.get(key(p, 0, h)) || 0) + 1);
      if (row.flag !== 'C') dutyExtra.set(key(p, 0, h), 1);
    });
  }
  const bx = (p, h) => busyExtra.get(key(p, 0, h)) || 0;
  const dx = (p, h) => dutyExtra.get(key(p, 0, h)) || 0;

  const cons = [];
  const generals = [];
  const obj = [];
  let n = 0;
  // terms: [[coef, name]...]；const: 已固定的部分移到右邊
  const add = (terms, op, rhs) => {
    const t = terms.filter(([, name]) => name);
    if (!t.length) return;
    const lhs = t.map(([c, name], i) => `${c < 0 ? '-' : i ? '+' : ''} ${Math.abs(c)} ${name}`).join(' ');
    cons.push(` c${n++}: ${lhs} ${op} ${rhs}`);
  };
  const sumFixed = (p, rows, h) => rows.reduce((s, r) => s + fixedAt(p, r, h), 0);
  const varsAt = (p, rows, h) => rows.map((r) => [1, v(p, r, h)]).filter(([, nm]) => nm);

  // 每格最多一人；值班、救護必須補滿（C08）
  for (let r = 0; r < 9; r++) {
    for (let h = 0; h < 24; h++) {
      if (grid[r][h] !== null) continue;
      const t = W.map((p) => [1, v(p, r, h)]).filter(([, nm]) => nm);
      if (!t.length) continue;
      add(t, REST_ROWS.includes(r) ? '<=' : '=', 1);
    }
  }
  // 值班、救護、休息以兩小時為一段
  for (const r of [...DUTY_ROWS, ...REST_ROWS]) {
    for (let h = 0; h < 24; h += 2) {
      for (const p of W) {
        const a = v(p, r, h), b = v(p, r, h + 1);
        if (a && b) add([[1, a], [-1, b]], '=', 0);
      }
    }
  }
  // C01、C09：同一小時一人只做一件事（只用今天上班的人）
  for (const p of W) {
    for (let h = 0; h < 24; h++) {
      const rhs = 1 - sumFixed(p, [...Array(9).keys()], h) - bx(p, h);
      add(varsAt(p, [...Array(9).keys()], h), '<=', Math.max(0, rhs));
    }
  }
  const dutyTerms = (p, h) => varsAt(p, DUTY_ROWS, h);
  const dutyConst = (p, h) => sumFixed(p, DUTY_ROWS, h) + dx(p, h);
  for (const p of W) {
    // C02：救護下一小時不能接值班
    for (let h = 0; h < 23; h++) {
      const t = [...varsAt(p, AMB_ROWS, h), ...varsAt(p, [DUTY], h + 1)];
      const c = sumFixed(p, AMB_ROWS, h) + fixedAt(p, DUTY, h + 1);
      if (t.length) add(t, '<=', Math.max(0, 1 - c));
    }
    // C03：連續服勤不超過 8 小時（值宿者除外）；只有固定格子本身就超時才會用到 over
    if (p !== su) {
      for (let h = 0; h + 9 <= 24; h++) {
        const t = [];
        let c = 0;
        for (let k = h; k < h + 9; k++) { t.push(...dutyTerms(p, k)); c += dutyConst(p, k); }
        if (!t.length) continue;
        const over = `o_${p}_${h}`;
        generals.push([over, 0, 24]);
        obj.push([W_HARD, over]);
        add([...t, [-1, over]], '<=', 8 - c);
      }
    }
    // C14：每人休息 2 小時（「長」已固定休息者除外）
    let fixedRest = 0;
    for (const r of REST_ROWS) for (let h = 0; h < 24; h++) fixedRest += fixedAt(p, r, h);
    if (fixedRest === 0) {
      const t = [];
      for (let h = 0; h < 24; h++) t.push(...varsAt(p, REST_ROWS, h));
      add(t, '=', 2);
      // C15：22 時以後不排休息，幹部（番號個位數）除外
      if (p > cadreMax) for (const h of NIGHT_REST) for (const [, nm] of varsAt(p, REST_ROWS, h)) obj.push([W_HARD, nm]);
    }
    // C10：前一天 B 班、值宿，12 時前不排勤務
    if (night.has(p)) for (let h = 0; h < 4; h++) for (const [, nm] of dutyTerms(p, h)) obj.push([W_HARD, nm]);
    // C07：救護訓練教官 16～17 時不排救護
    if (p === instructor) for (const h of [8, 9]) for (const [, nm] of varsAt(p, AMB_ROWS, h)) obj.push([W_HARD, nm]);
    // C19：14～16 時盡量不排休息
    for (const h of TRAINING_REST) for (const [, nm] of varsAt(p, REST_ROWS, h)) obj.push([W_PREFER, nm]);
    // C20：08～12 值班原則上一人四小時
    const a = v(p, DUTY, 0), b = v(p, DUTY, 2);
    if (a && b) {
      const d = `d_${p}`;
      bins.push(d);
      obj.push([W_PREFER, d]);
      add([[1, a], [-1, b], [-1, d]], '<=', 0);
      add([[1, b], [-1, a], [-1, d]], '<=', 0);
    }
    // 公平性：08～12 值班依本月累計輪流
    const hist = history[p] || 0;
    if (hist) for (let h = 0; h < 4; h++) { const nm = v(p, DUTY, h); if (nm) obj.push([hist, nm]); }
  }
  // C07：體技能教官（值宿者）15 時要在分隊授課，不排救護、休息
  if (su) for (const r of [...AMB_ROWS, ...REST_ROWS]) { const nm = v(su, r, 7); if (nm) obj.push([W_HARD, nm]); }
  // 公平性：當天工作量盡量平均（最大工作量最小化）
  generals.push(['mx', 0, 24]);
  obj.push([W_LOAD, 'mx']);
  for (const p of W) {
    const t = [];
    let c = 0;
    for (let h = 0; h < 24; h++) { t.push(...dutyTerms(p, h)); c += dutyConst(p, h); }
    add([...t, [-1, 'mx']], '<=', -c);
  }

  // 組成 LP 格式
  const objMap = new Map();
  for (const [c, nm] of obj) objMap.set(nm, (objMap.get(nm) || 0) + c);
  const objStr = [...objMap].map(([nm, c], i) => `${i ? '+ ' : ''}${c} ${nm}`).join(' ') || '0 mx';
  const lp = [
    'Minimize', ` obj: ${objStr}`,
    'Subject To', ...cons,
    'Bounds', ...generals.map(([nm, lo, hi]) => ` ${lo} <= ${nm} <= ${hi}`),
    'General', ...generals.map(([nm]) => ` ${nm}`),
    'Binary', ...bins.map((b) => ` ${b}`),
    'End',
  ].join('\n');

  const res = highs.solve(lp, { time_limit: 20, mip_rel_gap: 0 });
  if (res.Status !== 'Optimal' && !(res.Status === 'Time limit reached' && res.ObjectiveValue !== undefined)) {
    return { grid: null, status: res.Status };
  }
  const out = grid.map((row) => row.slice());
  for (const [k, nm] of x) {
    const col = res.Columns[nm];
    if (col && col.Primal > 0.5) {
      const [p, r, h] = k.split(',').map(Number);
      out[r][h] = p;
    }
  }
  return { grid: out, status: res.Status, objective: res.ObjectiveValue };
}
