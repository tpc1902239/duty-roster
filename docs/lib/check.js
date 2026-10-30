// 檢查排班結果（對應 VBA cheakWork 與新增限制式），回傳違規清單。
import { DUTY, R1A, R1B, R2A, R2B, REST_ROWS, NIGHT_REST, TRAINING_REST, AMB_ROWS } from './solver.js';

export function check(grid, { extra, workers, night, instructor, cadreMax = 9 }) {
  const errs = [];
  const W = new Set(workers);
  const su = grid[DUTY][14];
  const occ = new Map();
  const put = (p, h, r) => { const k = `${p},${h}`; if (!occ.has(k)) occ.set(k, []); occ.get(k).push(r); };
  for (let r = 0; r < 9; r++) for (let h = 0; h < 24; h++) if (grid[r][h] !== null) put(grid[r][h], h, r);
  for (const row of extra) row.cells.forEach((p, h) => { if (p !== null) put(p, h, '外' + row.flag); });
  for (const [k, rs] of occ) {
    const [p, h] = k.split(',').map(Number);
    if (rs.length > 1) errs.push({ code: 'C01', p, h, msg: `${p} 號在 ${hh(h)} 時重複排兩件勤務` });
    if (!W.has(p)) errs.push({ code: 'C09', p, h, msg: `${p} 號今天沒上班，卻排在 ${hh(h)} 時` });
  }
  for (let h = 0; h < 24; h++) {
    for (const r of [DUTY, R1A, R1B]) if (grid[r][h] === null) errs.push({ code: 'C08', h, msg: `${ROW_NAMES[r]} ${hh(h)} 時沒人` });
    if (h < 12) for (const r of [R2A, R2B]) if (grid[r][h] === null) errs.push({ code: 'C08', h, msg: `${ROW_NAMES[r]} ${hh(h)} 時沒人` });
  }
  for (let h = 1; h < 24; h++) {
    const p = grid[DUTY][h];
    if (p !== null && p !== grid[DUTY][h - 1] && AMB_ROWS.some((r) => grid[r][h - 1] === p)) {
      errs.push({ code: 'C02', p, h, msg: `${p} 號救護完 ${hh(h)} 時直接接值班` });
    }
  }
  const isDuty = (p, h) => (occ.get(`${p},${h}`) || []).some((r) => (typeof r === 'number' ? r <= R2B : r !== '外C'));
  for (const p of W) {
    if (p !== su) {
      let run = 0;
      for (let h = 0; h < 24; h++) {
        run = isDuty(p, h) ? run + 1 : 0;
        if (run > 8) { errs.push({ code: 'C03', p, msg: `${p} 號連續服勤超過 8 小時` }); break; }
      }
    }
    const rest = [];
    for (let h = 0; h < 24; h++) for (const r of REST_ROWS) if (grid[r][h] === p) rest.push(h);
    if (!rest.length) errs.push({ code: 'C05', p, msg: `${p} 號沒有排到休息` });
    if (p > cadreMax && rest.length <= 2 && rest.some((h) => NIGHT_REST.includes(h))) errs.push({ code: 'C15', p, msg: `${p} 號休息排在 22 時以後` });
    if (night.has(p) && [0, 1, 2, 3].some((h) => isDuty(p, h))) errs.push({ code: 'C10', p, msg: `${p} 號昨天 B 班／值宿，12 時前排了勤務` });
    if (p === instructor && [8, 9].some((h) => AMB_ROWS.some((r) => grid[r][h] === p))) errs.push({ code: 'C07', p, msg: `${p} 號是救護訓練教官，16～17 時排到救護` });
    if (p === su && (occ.get(`${p},7`) || []).some((r) => r !== DUTY)) errs.push({ code: 'C07', p, msg: `${p} 號（值宿、體技能教官）15 時不在分隊` });
    if (rest.length <= 2 && rest.some((h) => TRAINING_REST.includes(h))) errs.push({ code: 'C19', p, msg: `${p} 號休息排在 14～16 時（提醒）` });
  }
  return errs;
}

export const ROW_NAMES = ['值班', '一救', '一救', '二救', '二救', '休息1', '休息2', '休息3', '休息4'];
const HH = ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '00', '01', '02', '03', '04', '05', '06', '07'];
export const hh = (h) => HH[h];
