// 智能勤務表：在 Apps Script 網頁裡執行的主程式（由 Index.html 從 GitHub Pages 載入）。
// 後台函式用 window.api('函式名', ...參數) 呼叫，回傳 Promise。
(() => {
  const app = document.getElementById('app');
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) { /* 無痕視窗 */ } },
  };
  let me = null;   // {token, user, name, roles}
  const isAdmin = () => me && me.roles.includes('管理員');
  const call = (fn, ...args) => api(fn, me.token, ...args).catch(e => {
    if (/登入已過期/.test(e.message)) { logout(); }
    throw e;
  });

  // ---------- 登入 ----------

  function loginForm(setup) {
    app.innerHTML = `<div class="card narrow">
      <h1>智能勤務表</h1>
      <div class="muted">${setup ? '第一次使用：請建立管理員帳號。' : '請登入。'}</div>
      <label class="f">帳號<input id="u" autocomplete="username"></label>
      ${setup ? '<label class="f">姓名<input id="n"></label>' : ''}
      <label class="f">密碼<input id="p" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}"></label>
      <div class="err" id="e"></div>
      <button id="go">${setup ? '建立並登入' : '登入'}</button></div>`;
    const go = () => {
      const u = app.querySelector('#u').value.trim(), p = app.querySelector('#p').value;
      const req = setup ? api('setupAdmin', u, app.querySelector('#n').value.trim(), p) : api('login', u, p);
      app.querySelector('#e').textContent = '';
      req.then(s => { me = s; store.set('me', JSON.stringify(s)); route('month'); })
         .catch(e => { app.querySelector('#e').textContent = e.message; });
    };
    app.querySelector('#go').onclick = go;
    app.querySelector('#p').onkeydown = e => { if (e.key === 'Enter') go(); };
  }

  function logout() {
    if (me) api('logout', me.token);
    me = null; store.set('me', null);
    loginForm(false);
  }

  // ---------- 外框 ----------

  const PAGES = [
    { id: 'day', name: '排班區', show: () => true },
    { id: 'month', name: '月班表', show: () => true },
    { id: 'shiftdefs', name: '固定排班設定', show: () => true },
    { id: 'items', name: '外勤項目設定', show: () => true },
    { id: 'colors', name: '排班區顏色', show: () => true },
    { id: 'staff', name: '編制人員', show: () => true },
    { id: 'leave', name: '匯入假表', show: () => has('假表承辦') },
    { id: 'tables', name: '車輛／救護訓練', show: () => has('車輛承辦') || has('救護訓練承辦') },
    { id: 'read', name: '讀取測試', show: () => true },
    { id: 'accounts', name: '帳號管理', show: isAdmin },
    { id: 'log', name: '操作紀錄', show: isAdmin },
    { id: 'password', name: '改密碼', show: () => true },
  ];

  function route(id) {
    app.innerHTML = `<header><span class="brand">智能勤務表</span><nav>${
      PAGES.filter(p => p.show()).map(p => `<a data-p="${p.id}" class="${p.id === id ? 'on' : ''}">${p.name}</a>`).join('')
    }<a data-p="logout">登出</a></nav><span class="who">${esc(me.name)}（${esc(me.roles.join('、'))}）</span></header><main id="main"></main>`;
    app.querySelectorAll('nav a').forEach(a => { a.onclick = () => (a.dataset.p === 'logout' ? logout() : route(a.dataset.p)); });
    ({ day: pageDay, items: pageItems, colors: pageColors, month: pageMonth, shiftdefs: pageShiftDefs, staff: pageUnitStaff, leave: pageLeave, tables: pageTables, read: pageRead, accounts: pageAccounts, log: pageLog, password: pagePassword })[id](document.getElementById('main'));
  }

  // ---------- 讀取測試 ----------

  function pageRead(main) {
    main.innerHTML = `<h1>讀取測試</h1><div class="muted">確認資料庫和日曆讀得到。這頁只讀資料。</div>
      <div class="card"><input type="date" id="date"> <button id="go">讀取</button> <span id="msg" class="muted"></span></div><div id="out"></div>`;
    const $ = s => main.querySelector(s);
    $('#date').value = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    $('#go').onclick = () => {
      $('#msg').textContent = '讀取中…';
      call('loadDay', $('#date').value).then(d => { $('#msg').textContent = ''; $('#out').innerHTML = renderDay(d); })
        .catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
    };
  }

  function renderDay(d) {
    const num = Object.fromEntries(d.month.people.map(p => [p.name, p.num]));
    const ev = d.events.map(e => `<tr class="${e.unknown.length ? 'warn' : ''}">
        <td>${esc(e.kind)}</td><td class="l">${esc(e.duty)}</td>
        <td>${e.start == null ? '' : esc(e.start + '–' + e.end)}</td>
        <td>${e.people.map(n => esc(num[n] + '.' + n)).join('、')}</td>
        <td>${e.unknown.map(esc).join('、')}</td><td class="l muted">${esc(e.title)}</td></tr>`).join('');
    const [yy, mm] = d.date.split('-').map(Number);
    return `
      <div class="card"><h2>${esc(d.date)} 在隊 ${d.here.length} 人</h2>
        <div>${d.here.map(p => esc(p.num + '.' + p.name)).join('　')}</div>
        ${d.away.length ? `<div class="muted">不在隊：${d.away.map(a => esc(a.num + '.' + a.name)).join('、')}</div>` : ''}
      </div>
      <div class="card"><h2>日曆</h2>
        ${d.events.length ? `<div class="scroll"><table><tr><th>類型</th><th>勤務</th><th>時間</th><th>人員</th><th>對不到的人名</th><th>原標題</th></tr>${ev}</table></div>`
                          : '<div class="muted">這天日曆沒有活動。</div>'}
      </div>
      <div class="card">${rosterTable(yy, mm, d.month.people, d.month.days.map(day => ({
        d: Number(day.date.slice(8)), codes: day.codes.map(c => c ?? ''), away: day.codes.map(c => c == null) })),
        { today: Number(d.date.slice(8)) })}</div>`;
  }

  // ---------- 共用：月班表表格 ----------

  const WEEK = '日一二三四五六';
    const has = role => me.roles.includes(role) || isAdmin();
  // 番號依十位數分組上色（個位數＝幹部、1x、2x、3x、4x…），同 4.2 版月班表
  const grp = p => `g${Math.min(Math.floor(p.num / 10), 5)}`;
  const weekdayOf = (y, m, d) => WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const ym = v => v.split('-').map(Number);
  const nextMonth = () => { const t = new Date(Date.now() + 8 * 3600e3); t.setUTCDate(1); t.setUTCMonth(t.getUTCMonth() + 1); return t.toISOString().slice(0, 7); };

  /**
   * people:[{num,name}]、days:[{d, weekday, codes, away}]
   * opts.today：粗體的日；opts.mark(d, i) 回傳格子額外的 class；opts.title
   */
  // 固定欄寬，讓月班表和已排次數上下對齊：前兩欄（日、星期／標題）＋每人一欄
  const cols = n => `<colgroup><col style="width:24px"><col style="width:26px">${'<col style="width:24px">'.repeat(n)}</colgroup>`;

  function rosterTable(y, m, people, days, opts = {}) {
    const nums = people.map(p => `<th class="${grp(p)}">${esc(p.num)}</th>`).join('');
    const names = people.map(p => `<th class="${grp(p)} name">${[...p.name].map(esc).join('<br>')}</th>`).join('');
    const body = days.map(day => {
      const w = weekdayOf(y, m, day.d);
      return `<tr class="${day.d === opts.today ? 'today' : ''}"><td>${day.d}</td><td class="${w === '六' || w === '日' ? 'wkend' : ''}">${w}</td>` +
        day.codes.map((c, i) => (day.away[i]
          ? `<td class="off" data-d="${day.d}" data-i="${i}">—</td>`
          : `<td class="${grp(people[i])} ${opts.mark ? opts.mark(day.d, i) : ''} ${opts.shift && opts.shift(c) ? 'shift' : ''}" data-d="${day.d}" data-i="${i}">${esc(c)}</td>`)).join('') + '</tr>';
    }).join('');
    return `<h2>${opts.title || `${y}年${m}月班表`}</h2><div class="scroll${opts.grid ? ' gridwrap' : ''}"><table class="roster${opts.grid ? ' grid' : ''}">${opts.grid ? cols(people.length) : ''}
      <tr><th rowspan="2">日</th><th rowspan="2">星期</th>${nums}</tr><tr>${names}</tr>${body}</table></div>`;
  }

  // ---------- 月班表（檢視、填固定排班） ----------

  // 「已排次數」分組：名稱去掉尾巴的數字（A1、A2 → A；B1 → B），有「宿」的都算宿，同 4.2 版月班表下方
  const group = name => (/宿/.test(name) ? '宿' : (name.replace(/\d+$/, '') || name));
  const GROUP_ORDER = ['宿', 'A', 'B'];

  function pageMonth(main) {
    const edit = has('排班');
    main.classList.add('wide');
    main.innerHTML = `<h1>月班表</h1>
      <div class="muted">${edit ? '用法跟 Excel 一樣：點格子或拖曳選範圍，直接打字、Delete 清除、Ctrl+C／Ctrl+V 複製貼上（可以從 Excel 貼一整塊），方向鍵移動；雙擊格子跳出固定排班選單。黑格不能改。改完按「儲存」。'
        : '只能檢視；可以選取後 Ctrl+C 複製。'}</div>
      <div class="card bar"><input type="month" id="mon"> <button class="plain" id="go">重新整理</button>
        ${edit ? '<button id="save" disabled>儲存</button> <button class="plain" id="undo" disabled>放棄修改</button>' : ''}
        <button class="plain" id="cnt">已排次數</button>
        <span id="msg" class="muted"></span></div>
      <div class="card" id="out" hidden></div><div class="card" id="stats" hidden></div><div id="pick" class="picker" hidden></div>`;
    const $ = s => main.querySelector(s);
    $('#mon').value = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
    let data = null, defs = [], before = {}, baseMonth = 0, pending = {};   // pending['d|姓名'] = code
    let sel = null, dragging = false;   // sel = {d0, i0, d1, i1}：選取範圍（d 是日、i 是第幾個人）
    const key = (d, i) => d + '|' + data.people[i].name;
    const orig = (d, i) => data.days[d - 1].codes[i];
    const codeAt = (d, i) => (key(d, i) in pending ? pending[key(d, i)] : orig(d, i));
    const isAway = (d, i) => data.days[d - 1].away[i];
    const names = () => defs.map(x => x.name);
    const td = (d, i) => $(`#out td[data-d="${d}"][data-i="${i}"]`);
    const nDays = () => data.days.length, nPeople = () => data.people.length;

    const refreshButtons = () => {
      const n = Object.keys(pending).length;
      if (edit) { $('#save').disabled = $('#undo').disabled = !n; $('#save').textContent = n ? `儲存（${n} 格）` : '儲存'; }
      if (!$('#stats').hidden) drawStats();
    };
    // 只改那一格，不重畫整張表（畫面才不會跳回左邊）
    const setCell = (d, i, code) => {
      if (!edit || isAway(d, i)) return false;
      code = String(code ?? '').trim();
      if (code === orig(d, i)) delete pending[key(d, i)]; else pending[key(d, i)] = code;
      const c = td(d, i);
      c.textContent = code;
      c.classList.toggle('changed', key(d, i) in pending);
      c.classList.toggle('shift', names().includes(code));
      return true;
    };
    const draw = () => {
      const [y, m] = ym($('#mon').value);
      const wrap = $('#out .scroll'), left = wrap ? wrap.scrollLeft : 0, top = wrap ? wrap.scrollTop : 0;
      const days = data.days.map(day => Object.assign({}, day, { codes: day.codes.map((c, i) => codeAt(day.d, i)) }));
      $('#out').innerHTML = rosterTable(y, m, data.people, days, {
        grid: true, mark: (d, i) => (key(d, i) in pending ? 'changed' : ''), shift: c => names().includes(c) });
      const w = $('#out .scroll');
      w.tabIndex = 0; w.scrollLeft = left; w.scrollTop = top;
      paintSel(); refreshButtons();
    };

    // ---- 選取 ----
    const range = () => sel && { da: Math.min(sel.d0, sel.d1), db: Math.max(sel.d0, sel.d1), ia: Math.min(sel.i0, sel.i1), ib: Math.max(sel.i0, sel.i1) };
    const paintSel = () => {
      main.querySelectorAll('#out td.sel, #out td.cur').forEach(c => c.classList.remove('sel', 'cur'));
      const r = range(); if (!r) return;
      for (let d = r.da; d <= r.db; d++) for (let i = r.ia; i <= r.ib; i++) td(d, i).classList.add('sel');
      const cur = td(sel.d1, sel.i1); cur.classList.add('cur');
      cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    const cellOf = e => { const c = e.target.closest('#out td[data-d]'); return c && { d: Number(c.dataset.d), i: Number(c.dataset.i) }; };
    const eachSel = fn => { const r = range(); for (let d = r.da; d <= r.db; d++) for (let i = r.ia; i <= r.ib; i++) fn(d, i); };

    // ---- 打字編輯 ----
    let editing = null;
    const startEdit = (text) => {
      if (!edit || !sel || isAway(sel.d1, sel.i1)) return;
      const { d1: d, i1: i } = sel, c = td(d, i);
      c.innerHTML = '<input class="cell">';
      const inp = c.firstChild;
      inp.value = text ?? codeAt(d, i);
      inp.focus();
      editing = { d, i, inp };
      const done = (save, move) => {
        if (!editing) return;
        editing = null;
        if (!save || !setCell(d, i, inp.value)) c.textContent = codeAt(d, i);
        if (save) refreshButtons();
        if (move) { sel = { d0: Math.min(d + 1, nDays()), i0: i, d1: Math.min(d + 1, nDays()), i1: i }; }
        paintSel(); $('#out .scroll').focus({ preventScroll: true });
      };
      inp.onkeydown = e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); done(true, true); }
        else if (e.key === 'Escape') done(false);
        else if (e.key === 'Tab') { e.preventDefault(); done(true); move(0, e.shiftKey ? -1 : 1, false); }
      };
      inp.onblur = () => done(true);
    };
    const move = (dd, di, extend) => {
      if (!sel) return;
      const d1 = Math.max(1, Math.min(nDays(), sel.d1 + dd)), i1 = Math.max(0, Math.min(nPeople() - 1, sel.i1 + di));
      sel = extend ? Object.assign(sel, { d1, i1 }) : { d0: d1, i0: i1, d1, i1 };
      paintSel();
    };

    // ---- 固定排班選單（雙擊） ----
    const picker = (d, i) => {
      if (!edit || isAway(d, i)) return;
      const rest = new Set(defs.filter(x => x.kind === '休息').map(x => x.name));   // 休息類（長）可以好幾個人
      const used = new Set(data.people.map((p, j) => (j === i ? '' : codeAt(d, j))).filter(c => !rest.has(c)));   // 同一天別人已經選的
      const pick = $('#pick'), r = td(d, i).getBoundingClientRect();
      pick.innerHTML = `<div class="muted">${d} 日 ${esc(data.people[i].name)}</div>` +
        (defs.length ? names().map(c => `<button class="plain" data-c="${esc(c)}" ${used.has(c) ? 'disabled title="這天已經有人選了"' : ''}>${esc(c)}</button>`).join('')
          : '<div class="muted">還沒有固定排班設定</div>') + '<button class="plain" data-c="">清除</button>';
      pick.style.left = Math.min(r.left + scrollX, innerWidth - 260) + 'px';
      pick.style.top = r.bottom + scrollY + 4 + 'px';
      pick.hidden = false;
      pick.onclick = e2 => {
        const b = e2.target.closest('button'); if (!b || b.disabled) return;
        setCell(d, i, b.dataset.c); refreshButtons(); pick.hidden = true; $('#out .scroll').focus({ preventScroll: true });
      };
    };

    $('#out').addEventListener('mousedown', e => {
      if (e.target.closest('input')) return;
      const c = cellOf(e); if (!c) return;
      e.preventDefault();
      $('#out .scroll').focus({ preventScroll: true });
      sel = e.shiftKey && sel ? Object.assign(sel, { d1: c.d, i1: c.i }) : { d0: c.d, i0: c.i, d1: c.d, i1: c.i };
      dragging = true; paintSel();
    });
    $('#out').addEventListener('mouseover', e => {
      if (!dragging) return;
      const c = cellOf(e); if (!c) return;
      Object.assign(sel, { d1: c.d, i1: c.i }); paintSel();
    });
    const up = () => { dragging = false; };
    $('#out').addEventListener('dblclick', e => { const c = cellOf(e); if (c) picker(c.d, c.i); });
    $('#out').addEventListener('keydown', e => {
      if (!sel || editing) return;
      const k = e.key, ctrl = e.ctrlKey || e.metaKey;
      const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (arrows[k]) { e.preventDefault(); move(...arrows[k], e.shiftKey); }
      else if (k === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1, false); }
      else if (k === 'Enter') { e.preventDefault(); move(e.shiftKey ? -1 : 1, 0, false); }
      else if (k === 'F2') { e.preventDefault(); startEdit(); }
      else if ((k === 'Delete' || k === 'Backspace') && edit) { e.preventDefault(); eachSel((d, i) => setCell(d, i, '')); refreshButtons(); }
      else if (k === 'Escape') { $('#pick').hidden = true; }
      else if (k.length === 1 && !ctrl && !e.altKey && edit) { e.preventDefault(); startEdit(k); }
    });
    // 中文輸入法打字時 keydown 拿不到字，用 compositionstart 先開輸入框
    $('#out').addEventListener('compositionstart', () => { if (!editing && sel && edit) startEdit(''); });
    const onCopy = e => {
      if (!main.isConnected) return document.removeEventListener('copy', onCopy);
      if (!sel || editing || !main.querySelector('#out .scroll:focus')) return;
      const r = range(), rows = [];
      for (let d = r.da; d <= r.db; d++) { const row = []; for (let i = r.ia; i <= r.ib; i++) row.push(isAway(d, i) ? '' : codeAt(d, i)); rows.push(row.join('\t')); }
      e.clipboardData.setData('text/plain', rows.join('\n'));
      e.preventDefault();
      $('#msg').textContent = `已複製 ${(r.db - r.da + 1) * (r.ib - r.ia + 1)} 格。`;
    };
    const onPaste = e => {
      if (!main.isConnected) return document.removeEventListener('paste', onPaste);
      if (!edit || !sel || editing || !main.querySelector('#out .scroll:focus')) return;
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain').replace(/\r/g, '').replace(/\n$/, '');
      const block = text.split('\n').map(r => r.split('\t'));
      const r = range();
      let n = 0, skip = 0;
      if (block.length === 1 && block[0].length === 1) {   // 一格貼到整個選取範圍
        eachSel((d, i) => { setCell(d, i, block[0][0]) ? n++ : skip++; });
      } else {
        block.forEach((row, a) => row.forEach((v, b) => {
          const d = r.da + a, i = r.ia + b;
          if (d > nDays() || i >= nPeople()) return;
          setCell(d, i, v) ? n++ : skip++;
        }));
        sel = { d0: r.da, i0: r.ia, d1: Math.min(nDays(), r.da + block.length - 1), i1: Math.min(nPeople() - 1, r.ia + Math.max(...block.map(x => x.length)) - 1) };
        paintSel();
      }
      refreshButtons();
      $('#msg').textContent = `已貼上 ${n} 格` + (skip ? `，黑格 ${skip} 格沒有改。` : '。');
    };
    const close = e => {   // 換頁後這頁的元素就不在了，順便拿掉監聽
      if (!main.isConnected) { document.removeEventListener('click', close); document.removeEventListener('mouseup', up); return; }
      if (!e.target.closest('#pick, #out td')) $('#pick').hidden = true;
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    document.addEventListener('click', close);
    document.addEventListener('mouseup', up);

    // ---- 已排次數：當月（含還沒儲存的修改）＋全年累計，欄位跟月班表一樣 ----
    const drawStats = () => {
      const counted = defs.filter(x => x.kind !== '休息').map(x => x.name);
      const groups = [...new Set(GROUP_ORDER.concat(counted.map(group)))];
      const now = data.people.map(() => ({}));
      data.days.forEach(day => data.people.forEach((p, i) => {
        const c = codeAt(day.d, i);
        if (counted.includes(c)) now[i][group(c)] = (now[i][group(c)] || 0) + 1;
      }));
      const total = data.people.map((p, i) => {
        const t = Object.assign({}, now[i]);
        Object.entries(before[p.name] || {}).forEach(([c, n]) => { t[group(c)] = (t[group(c)] || 0) + n; });
        return t;
      });
      const rows = (label, arr, cls) => groups.map((g, k) => `<tr class="${k ? '' : cls}">${k ? '' : `<th rowspan="${groups.length}" class="lbl">${label}</th>`}<th>${esc(g)}</th>` +
        data.people.map((p, i) => `<td class="${grp(p)}">${arr[i][g] || ''}</td>`).join('') + '</tr>').join('');
      const [y] = ym($('#mon').value);
      const wrap = $('#stats .scroll'), left = wrap ? wrap.scrollLeft : 0;
      $('#stats').innerHTML = `<h2>已排次數</h2>
        <div class="muted">全年累計${baseMonth ? `：以累計基準（${y}年1～${baseMonth}月，4.2 版匯入）為準，加減之後或之前各月` : `：${y}年1月起（還沒匯入累計基準）`}，含這個月還沒儲存的修改。</div>
        <div class="scroll"><table class="roster grid stats">${cols(data.people.length)}
        <tr><th colspan="2" class="lbl"></th>${data.people.map(p => `<th class="${grp(p)}">${esc(p.num)}</th>`).join('')}</tr>
        ${rows('當月', now, 'top')}${rows('全年<br>累計', total, 'top')}</table></div>` +
        (edit ? `<p class="muted">匯入累計基準：上傳 4.2 版的月班表檔（例如 10 月），讀它的「累計」宿／A／B 列。
          <label>截至 <input type="number" id="bm" min="1" max="12" value="10" style="width:60px"> 月</label>
          <input type="file" id="bf" accept=".xlsm,.xlsx"></p>` : '');
      $('#stats .scroll').scrollLeft = left;
      if (edit) $('#bf').onchange = () => importBase($('#bf').files[0], Number($('#bm').value));
    };
    const importBase = (file, bm) => {
      if (!file) return;
      const [y, m] = ym($('#mon').value);
      $('#msg').textContent = '讀取中…';
      readBook(file).then(wb => {
        const rows = parseBase(wb);
        if (!confirm(`讀到 ${rows.length} 人的累計（宿／A／B），存成 ${y} 年 1～${bm} 月的累計基準？`)) { $('#msg').textContent = ''; return; }
        return call('saveBase', y, bm, rows).then(r => load(`已存累計基準 ${r.count} 人。`));
      }).catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
    };

    const load = (done = '') => {
      const [y, m] = ym($('#mon').value);
      $('#msg').textContent = '讀取中…'; pending = {}; sel = null;
      Promise.all([call('getMonth', y, m), call('getShiftDefs'), call('getShiftCounts', y, m)]).then(([d, sd, sc]) => {
        data = d; defs = sd.defs; before = sc.before; baseMonth = sc.baseMonth || 0;
        if (!d.exists) { $('#out').hidden = $('#stats').hidden = true; $('#msg').textContent = `${y} 年 ${m} 月還沒有月班表，請先匯入假表。`; return; }
        $('#msg').textContent = done; $('#out').hidden = false; draw();
      }).catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
    };
    $('#go').onclick = () => {
      if (Object.keys(pending).length && !confirm('還有沒儲存的修改，重新整理會放棄，確定嗎？')) return;
      load();
    };
    $('#mon').onchange = () => load();
    $('#cnt').onclick = () => {
      if (!data || !data.exists) return;
      $('#stats').hidden = !$('#stats').hidden;
      if (!$('#stats').hidden) { drawStats(); $('#stats').scrollIntoView({ behavior: 'smooth' }); }
    };
    if (edit) {
      $('#undo').onclick = () => { pending = {}; draw(); };
      $('#save').onclick = () => {
        const [y, m] = ym($('#mon').value);
        const changes = Object.entries(pending).map(([k, code]) => { const [d, name] = k.split('|'); return { d: Number(d), name, code }; });
        $('#msg').textContent = '儲存中…';
        call('saveShifts', y, m, changes, data.version)
          .then(r => load(`已儲存 ${r.saved} 格。`))
          .catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
      };
    }
    load();
  }

  /** 從 4.2 版月班表讀「累計」區的宿／A／B 列：A 欄「累計」那列是宿，往下 B 欄是 A、B 的列。 */
  function parseBase(wb) {
    const name = wb.SheetNames.find(n => /月班表/.test(n)) || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    const head = rows.findIndex(r => r.slice(2).filter(v => Number(v) > 0).length >= 5);
    if (head < 0) throw new Error('找不到番號列');
    const start = rows.findIndex(r => String(r[0]).trim() === '累計');
    if (start < 0) throw new Error('找不到 A 欄是「累計」的列');
    const find = label => { for (let r = start; r < Math.min(rows.length, start + 10); r++) if (String(rows[r][1]).trim() === label) return rows[r]; return null; };
    const lines = { '宿': find('宿'), A: find('A'), B: find('B') };
    if (!lines['宿'] || !lines.A || !lines.B) throw new Error('「累計」區找不到宿、A、B 三列');
    const out = [];
    for (let c = 2; c < rows[head].length; c++) {
      const nm = String(rows[head + 1][c] || '').replace(/\s+/g, '');
      if (!(Number(rows[head][c]) > 0) || !nm) continue;
      out.push({ name: nm, '宿': Number(lines['宿'][c]) || 0, A: Number(lines.A[c]) || 0, B: Number(lines.B[c]) || 0 });
    }
    return out;
  }

  // ---------- 編制人員 ----------

  const STAFF_STATUS = ['在隊', '不在隊', '算人力', '不計人力'];

  function pageUnitStaff(main) {
    const edit = isAdmin();
    main.innerHTML = `<h1>編制人員</h1>
      <div class="muted">分隊編制的人員和番號（取代 4.2 版的「番名」）。「限排時間」「限排勤務」是給自動填空用的限制：有勾時間的人只排那些時段，有選勤務的人只排那種勤務；都空白＝不限。</div>
      <div class="card"><div class="scroll" id="list"></div>
        ${edit ? '<p><button class="plain" id="add">＋ 新增</button> <button class="plain" id="fill">從月班表帶入</button> <button id="save">儲存</button> <span id="msg" class="muted"></span></p>'
          : '<p class="muted">只有管理員可以修改。</p>'}</div>`;
    const $ = s => main.querySelector(s);
    let staff = [], version = 0;
    const dis = edit ? '' : 'disabled';
    const draw = () => {
      $('#list').innerHTML = `<table class="defs"><tr><th>姓名</th><th>番號</th><th>在勤狀況</th><th colspan="${HOURS.length}">限排時間</th><th>限排勤務</th>${edit ? '<th></th>' : ''}</tr>
        <tr><th></th><th></th><th></th>${HOURS.map(h => `<th>${h}</th>`).join('')}<th></th>${edit ? '<th></th>' : ''}</tr>` +
        staff.map((p, k) => `<tr data-k="${k}">
          <td><input class="nm" value="${esc(p.name)}" size="5" ${dis}></td>
          <td><input class="no" value="${esc(p.num)}" size="3" inputmode="numeric" ${dis}></td>
          <td><select class="st" ${dis}>${STAFF_STATUS.map(x => `<option ${x === p.status ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
          ${HOURS.map(h => `<td><input type="checkbox" data-h="${h}" ${p.hours.includes(h) ? 'checked' : ''} ${dis}></td>`).join('')}
          <td><select class="kd" ${dis}><option value="">不限</option>${KINDS.map(x => `<option ${x === p.kind ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
          ${edit ? '<td><button class="plain del">刪除</button></td>' : ''}</tr>`).join('') + '</table>' +
        (staff.length ? '' : '<div class="muted">還沒有資料。可以按「從月班表帶入」。</div>');
    };
    const read = () => {
      main.querySelectorAll('tr[data-k]').forEach(tr => {
        const p = staff[Number(tr.dataset.k)];
        p.name = tr.querySelector('.nm').value.trim();
        p.num = tr.querySelector('.no').value.trim();
        p.status = tr.querySelector('.st').value;
        p.kind = tr.querySelector('.kd').value;
        p.hours = [...tr.querySelectorAll('input[data-h]:checked')].map(x => x.dataset.h);
      });
    };
    const load = (done = '') => call('getUnitStaff').then(r => {
      staff = r.staff; version = r.version; draw();
      if ($('#msg')) $('#msg').textContent = done;
    });
    if (edit) {
      $('#add').onclick = () => { read(); staff.push({ name: '', num: '', status: '在隊', hours: [], kind: '' }); draw(); main.querySelector('tr[data-k]:last-child .nm').focus(); };
      $('#fill').onclick = () => {
        read();
        const [y, m] = ym(new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7));
        call('getMonth', y, m).then(mo => {
          if (!mo.exists) throw new Error(`${y} 年 ${m} 月還沒有月班表`);
          const have = new Set(staff.map(p => p.name));
          const add = mo.people.filter(p => !have.has(p.name));
          add.forEach(p => staff.push({ name: p.name, num: p.num, status: '在隊', hours: [], kind: '' }));
          draw(); $('#msg').textContent = `從 ${m} 月月班表帶入 ${add.length} 人，按「儲存」才會存。`;
        }).catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
      };
      $('#list').onclick = e => {
        const b = e.target.closest('.del'); if (!b) return;
        read(); staff.splice(Number(b.closest('tr').dataset.k), 1); draw();
      };
      $('#save').onclick = () => {
        read(); $('#msg').textContent = '儲存中…';
        call('saveUnitStaff', staff, version).then(r => load(`已儲存 ${r.count} 人。`))
          .catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
      };
    }
    load();
  }

  // ---------- 固定排班設定 ----------

  const HOURS = ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '00', '01', '02', '03', '04', '05', '06', '07'];
  const KINDS = ['值班', '救護'];   // 編制人員的限排勤務
  const SHIFT_KINDS = ['值班', '一救', '二救', '休息'];   // 固定排班放到排班區哪一列

  function pageShiftDefs(main) {
    const edit = has('排班');
    main.innerHTML = `<h1>固定排班設定</h1>
      <div class="muted">月班表點格子時，只會出現這裡設定的名稱。時間從早上 08 到隔天 07，勾選這個班要上的小時。<br>排班區讀取當天時，會照「勤務別」和「第幾位」把人放進值班、一救、二救或休息列（例如 A1 放一救第 1 位、A2 放一救第 2 位）。勤務別選「休息」的（例如「長」）同一天可以好幾個人，也不算在已排次數。</div>
      <div class="card"><div class="scroll" id="list"></div>
        ${edit ? '<p><button class="plain" id="add">＋ 新增</button> <button id="save">儲存</button> <span id="msg" class="muted"></span></p>' : ''}</div>`;
    const $ = s => main.querySelector(s);
    let defs = [], version = 0;
    const draw = () => {
      $('#list').innerHTML = `<table class="defs"><tr><th>名稱</th>${HOURS.map(h => `<th>${h}</th>`).join('')}<th>勤務別</th><th>第幾位</th>${edit ? '<th></th>' : ''}</tr>` +
        defs.map((d, k) => `<tr data-k="${k}">
          <td><input class="nm" value="${esc(d.name)}" size="5" ${edit ? '' : 'disabled'}></td>
          ${HOURS.map(h => `<td><input type="checkbox" data-h="${h}" ${d.hours.includes(h) ? 'checked' : ''} ${edit ? '' : 'disabled'}></td>`).join('')}
          <td><select class="kd" ${edit ? '' : 'disabled'}>${SHIFT_KINDS.map(x => `<option ${x === d.kind ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
          <td><select class="ps" ${edit ? '' : 'disabled'}>${[1, 2, 3, 4].map(x => `<option ${x === d.pos ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
          ${edit ? '<td><button class="plain del">刪除</button></td>' : ''}</tr>`).join('') + '</table>' +
        (defs.length ? '' : '<div class="muted">還沒有設定。</div>');
    };
    const read = () => {   // 畫面上的值讀回 defs
      main.querySelectorAll('tr[data-k]').forEach(tr => {
        const d = defs[Number(tr.dataset.k)];
        d.name = tr.querySelector('.nm').value.trim();
        d.kind = tr.querySelector('.kd').value;
        d.pos = Number(tr.querySelector('.ps').value);
        d.hours = [...tr.querySelectorAll('input[data-h]:checked')].map(x => x.dataset.h);
      });
    };
    const load = (done = '') => call('getShiftDefs').then(r => {
      defs = r.defs; version = r.version; draw();
      if ($('#msg')) $('#msg').textContent = done;
    });
    if (edit) {
      $('#add').onclick = () => { read(); defs.push({ name: '', hours: [], kind: SHIFT_KINDS[0], pos: 1 }); draw(); main.querySelector('tr[data-k]:last-child .nm').focus(); };
      $('#list').onclick = e => {
        const b = e.target.closest('.del'); if (!b) return;
        read(); defs.splice(Number(b.closest('tr').dataset.k), 1); draw();
      };
      $('#save').onclick = () => {
        read(); $('#msg').textContent = '儲存中…';
        call('saveShiftDefs', defs, version).then(r => load(`已儲存 ${r.count} 個。`))
          .catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
      };
    }
    load();
  }

  // ---------- 外勤項目設定 ----------

  function pageItems(main) {
    const edit = has('排班');
    main.innerHTML = `<h1>外勤項目設定</h1>
      <div class="muted">排班區「新增外勤」的選單就是這張表，同 4.2 版表單 4 的選項。以後多一種勤務，在這裡新增一列就好。<br>
      <b>列名格式</b>：空白＝用名稱；有 {} 的，排班時會請你輸入內容換掉 {}（例如「水源第{}梯」輸入 8 → 水源第8梯）。<br>
      <b>勤務表列</b>：輸出勤務表時放哪一列；選值班、一救、二救的（第二位值班、第三位 91／92）會併進那一列。
      <b>文字欄</b>：輸出時這項的文字寫在「備註」還是「搶救演練及訓練」。<b>大隊代碼</b>：大隊報表用（同 4.2 版 AB 欄）。<b>勤務類別</b>：我們自己統計用；填「訓練」的不算連續 8 小時。</div>
      <div class="card"><div class="scroll" id="list"></div>
        ${edit ? '<p><button class="plain" id="add">＋ 新增</button> <button id="save">儲存</button> <span id="msg" class="muted"></span></p>' : ''}</div>`;
    const $ = s => main.querySelector(s);
    let items = [], version = 0, places = [], texts = [];
    const dis = edit ? '' : 'disabled';
    const opt = (list, v) => list.map(x => `<option value="${esc(x)}" ${x === v ? 'selected' : ''}>${esc(x || '（不寫）')}</option>`).join('');
    const draw = () => {
      $('#list').innerHTML = `<table class="defs items"><tr><th>名稱</th><th>列名格式</th><th>勤務表列</th><th>文字欄</th><th>大隊代碼</th><th>勤務類別</th>${edit ? '<th></th>' : ''}</tr>` +
        items.map((x, k) => `<tr data-k="${k}">
          <td><input class="nm" value="${esc(x.name)}" size="10" ${dis}></td>
          <td><input class="lb" value="${esc(x.label)}" size="10" ${dis}></td>
          <td><select class="pl" ${dis}>${opt(places, x.place)}</select></td>
          <td><select class="tx" ${dis}>${opt(texts, x.text)}</select></td>
          <td><input class="cd" value="${esc(x.code)}" size="3" ${dis}></td>
          <td><input class="ct" value="${esc(x.category)}" size="6" ${dis}></td>
          ${edit ? '<td><button class="plain del">刪除</button></td>' : ''}</tr>`).join('') + '</table>';
    };
    const read = () => main.querySelectorAll('tr[data-k]').forEach(tr => {
      const x = items[Number(tr.dataset.k)];
      x.name = tr.querySelector('.nm').value.trim(); x.label = tr.querySelector('.lb').value.trim();
      x.place = tr.querySelector('.pl').value; x.text = tr.querySelector('.tx').value;
      x.code = tr.querySelector('.cd').value.trim(); x.category = tr.querySelector('.ct').value.trim();
    });
    const load = (done = '') => call('getItems').then(r => {
      items = r.items; version = r.version; places = r.places; texts = r.texts; draw();
      if ($('#msg')) $('#msg').textContent = done || (version ? '' : '目前是預設值（照 4.2 版），按「儲存」後才會存進資料庫。');
    });
    if (edit) {
      $('#add').onclick = () => { read(); items.push({ name: '', label: '', place: places[2], text: texts[0], code: '', category: '' }); draw(); main.querySelector('tr[data-k]:last-child .nm').focus(); };
      $('#list').onclick = e => { const b = e.target.closest('.del'); if (!b) return; read(); items.splice(Number(b.closest('tr').dataset.k), 1); draw(); };
      $('#save').onclick = () => {
        read(); $('#msg').textContent = '儲存中…';
        call('saveItems', items, version).then(r => load(`已儲存 ${r.count} 項。`)).catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
      };
    }
    load();
  }

  // ---------- 排班區顏色 ----------

  function pageColors(main) {
    const edit = has('排班');
    main.innerHTML = `<h1>排班區顏色</h1>
      <div class="muted"><b>列的顏色</b>：排班區最左邊列名那一格的底色。<b>固定班的顏色</b>：A1、B1、宿…這些人在自己班的時段、自己那一列的格子底色（同 4.2 版，一眼看得出是誰的班）。不想上色就勾「不上色」。</div>
      <div class="card"><div id="list"></div>
        ${edit ? '<p><button id="save">儲存</button> <span id="msg" class="muted"></span></p>' : ''}</div>`;
    const $ = s => main.querySelector(s);
    const ROWS = ['時間', '備勤人員', '值班', '一救', '二救', '休息', '外勤'];
    let colors = {}, version = 0, defs = [];
    const line = (key, name) => {
      const c = colors[key] || '';
      return `<tr data-k="${esc(key)}"><td class="l">${esc(name)}</td>
        <td><input type="color" value="${esc(c || '#ffffff')}" ${edit ? '' : 'disabled'} ${c ? '' : 'class="dim"'}></td>
        <td><label><input type="checkbox" class="none" ${c ? '' : 'checked'} ${edit ? '' : 'disabled'}> 不上色</label></td>
        <td><span class="swatch" style="${c ? `background:${esc(c)}` : ''}">16</span></td></tr>`;
    };
    const draw = () => {
      $('#list').innerHTML = `<h2>列的顏色</h2><table class="defs colors">${ROWS.map(r => line('列:' + r, r)).join('')}</table>
        <h2 style="margin-top:12px">固定班的顏色</h2>` + (defs.length ? `<table class="defs colors">${defs.map(d => line('班:' + d, d)).join('')}</table>` : '<div class="muted">還沒有固定排班設定。</div>');
    };
    $('#list').addEventListener('input', e => {
      const tr = e.target.closest('tr[data-k]'); if (!tr) return;
      const col = tr.querySelector('input[type=color]'), none = tr.querySelector('.none');
      if (e.target === col) none.checked = false;
      colors[tr.dataset.k] = none.checked ? '' : col.value;
      col.classList.toggle('dim', none.checked);
      tr.querySelector('.swatch').style.background = colors[tr.dataset.k] || '';
    });
    const load = (done = '') => call('getColors').then(r => {
      colors = r.colors; version = r.version; defs = r.defs; draw();
      if ($('#msg')) $('#msg').textContent = done || (version ? '' : '目前是預設顏色（照 4.2 版），按「儲存」後才會存進資料庫。');
    });
    if (edit) $('#save').onclick = () => {
      const out = {};
      ROWS.forEach(r => { out['列:' + r] = colors['列:' + r] || ''; });
      defs.forEach(d => { out['班:' + d] = colors['班:' + d] || ''; });
      $('#msg').textContent = '儲存中…';
      call('saveColors', out, version).then(r => load(`已儲存 ${r.count} 項。`)).catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
    };
    load();
  }

  // ---------- 排班區（輸入） ----------

  const FIXED_TYPES = ['值班', '一救', '二救', '休息'];
  const DUTY_TYPES = ['值班', '一救', '二救'];
  const hourLabel = i => (i >= 24 ? '08' : HOURS[i]);   // 結束時間 24 = 隔天 08

  function pageDay(main) {
    const edit = has('排班');
    main.classList.add('wide');
    main.innerHTML = `<h1>排班區</h1>
      <div class="muted">${edit ? '① 選日期按「讀取當天」→ ② 在格子裡打番號（拖曳選一段時間再打，整段一起填；也可以打姓名）、加外勤、排休息 → ③「檢查」→ ④「存檔」。已經存過的日期，讀進來就是存檔的內容，改完再存就是異動。<br>還沒存檔的修改會自動留著（換頁、關掉瀏覽器都在），按「存檔」才會存進資料庫；不要了就按「放棄修改」。'
        : '只能檢視。'}</div>
      <div class="card bar"><input type="date" id="date"> <button id="go">讀取當天</button>
        ${edit ? '<button class="plain" id="chk">檢查</button> <button id="save" disabled>存檔</button> <button class="plain" id="drop" disabled>放棄修改</button> <button class="plain" id="refix">重新帶入固定班</button>' : ''} <button class="plain" id="out">輸出勤務表</button>
        <span id="msg" class="muted"></span></div>
      <div id="body" hidden>
        <div class="dayrow">
          <div class="card daygrid"><div id="info" class="muted"></div><div class="gridwrap" id="gw" tabindex="0"></div>
            <div class="extra">車輛保養（值宿）<input id="car" size="6" ${edit ? '' : 'disabled'}>　為民服務暨深夜救護備二替（A 班）<input id="sub" size="8" ${edit ? '' : 'disabled'}> <span class="muted">番號用「.」隔開</span></div>
            ${edit ? '<p class="tools"><button class="plain" id="addR">＋ 休息列</button> <span class="muted">外勤列、第二位值班、第三位 91／92、多加的休息列可以按右邊 ✕ 刪除；點列名可以改名。</span></p>' : ''}
          </div>
          <div class="card" id="hrs"></div>
        </div>
        <div class="dayside">
          ${edit ? '<div class="card" id="addx"></div>' : ''}
          <div class="card" id="cal"></div>
          <div class="card" id="chkout" hidden></div>
          <div class="card"><h2>備註</h2><div class="muted">報停車輛、申請離隊、扣除人力等，輸出時放在勤務表右下的備註。</div>
            <textarea id="memo" rows="4" ${edit ? '' : 'disabled'}></textarea></div>
        </div>
      </div><div id="pop" class="picker" hidden></div>`;
    const $ = s => main.querySelector(s);
    const drafts = dayDrafts();
    $('#date').value = drafts.last || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

    let D = null, rows = [], dirty = false, sel = null, dragging = false, editing = null, hl = '', marks = {};
    // 外勤會排到休假的人，所以名單含休假的人（off: true）；備勤人數只算在隊的
    const pm = () => Object.fromEntries(D.people.concat(D.off.map(p => Object.assign({ off: true, status: '' }, p))).map(p => [String(p.num), p]));
    const defOf = code => D.defs.find(x => x.name === code);
    const blank = () => Array(24).fill('');
    const nums = t => String(t || '').split(/[.,，、\s]+/).filter(Boolean);
    const td = (r, h) => $(`#gw td[data-r="${r}"][data-h="${h}"]`);
    const busyAt = h => new Set(rows.map(r => r.cells[h]).filter(Boolean));
    const setDirty = v => {
      dirty = v;
      if (edit) { $('#save').disabled = !v && !!(D && D.saved); $('#save').textContent = v ? '存檔 *' : '存檔'; $('#drop').disabled = !v; }
      if (D) saveDraft();
    };
    // 還沒存檔的修改：每天一份草稿，存在瀏覽器裡
    const saveDraft = () => {
      const all = dayDrafts();
      if (dirty) all[D.date] = { rows, memo: $('#memo').value, car: nums($('#car').value), sub: nums($('#sub').value), version: D.version, at: Date.now() }; else delete all[D.date];
      all.last = D.date;
      dayDrafts(all);
    };

    // ---- 從月班表帶入固定班（A1、B1、宿、長…） ----
    const fixedRows = () => {
      const max = t => Math.max(t === '休息' ? 4 : t === '值班' ? 1 : 2, ...D.defs.filter(x => x.kind === t).map(x => x.pos || 1));
      const out = [], notes = [];
      FIXED_TYPES.forEach(t => { for (let k = 1; k <= max(t); k++) out.push({ type: t, label: t === '休息' ? '休息' + k : t, cells: blank() }); });
      D.people.forEach(p => {
        const def = defOf(p.code); if (!def) return;
        const hs = def.hours.map(h => HOURS.indexOf(h)).filter(i => i >= 0);
        let row;
        if (def.kind === '休息') {
          row = out.find(r => r.type === '休息' && hs.every(i => !r.cells[i]));
          if (!row) { row = { type: '休息', label: '休息' + (out.filter(r => r.type === '休息').length + 1), cells: blank() }; out.push(row); }
        } else row = out.filter(r => r.type === def.kind)[def.kind === '值班' ? 0 : (def.pos || 1) - 1];
        hs.forEach(i => { if (row.cells[i]) notes.push(`${p.num}（${p.code}）${HOURS[i]} 時跟 ${row.cells[i]} 撞到`); else row.cells[i] = String(p.num); });
      });
      return { rows: sortRows(out), notes };
    };
    // 列的分組：固定的值班／一救／二救／休息；外勤裡勤務表列是值班、一救、二救的（第二位值班、第三位 91／92）放到那一組下面
    const groupOf = r => (FIXED_TYPES.includes(r.type) ? r.type : DUTY_TYPES.includes(r.place) ? r.place : '外勤');
    const sortRows = list => FIXED_TYPES.concat('外勤').flatMap(g => list.filter(r => groupOf(r) === g && FIXED_TYPES.includes(r.type)).concat(list.filter(r => groupOf(r) === g && !FIXED_TYPES.includes(r.type))));

    // ---- 畫格子 ----
    // 備勤下限（C23）：駕訓那幾個小時車和人出去了，下限減少
    const minAt = h => D.settings.minStandby - (rows.some(r => (r.item === '駕訓' || /駕訓/.test(r.label)) && r.cells[h]) ? D.settings.drillLess : 0);
    const standby = h => {
      const busy = busyAt(h);
      return D.people.filter(p => p.status !== '不計人力' && !busy.has(String(p.num)));
    };
    const cellClass = (r, h) => {
      const v = rows[r].cells[h]; if (!v) return rows[r].need && rows[r].need.includes(h) ? 'need' : '';
      const c = [];
      const who = pm()[v];
      if (!who || (who.off && FIXED_TYPES.includes(rows[r].type))) c.push('bad');
      else if (who.off) c.push('offp');
      else if (rows.some((x, k) => k !== r && x.cells[h] === v)) c.push('dup');
      if (h < 4 && rows[r].type !== '休息' && D.night.some(n => String(n.num) === v)) c.push('night');
      if (hl && v === hl) c.push('hl');
      if (marks[r + ',' + h]) c.push('err');
      return c.join(' ');
    };
    const draw = () => {
      const w = $('#gw'), left = w.scrollLeft;
      const people = pm();
      // 備勤人員：每小時都列出全部在隊的人，有排班的變空格，番號左右對齊（同 4.2 版）
      const all = D.people.filter(p => p.status !== '不計人力');
      const sb = HOURS.map((x, h) => { const busy = busyAt(h); return all.map(p => (busy.has(String(p.num)) ? '' : String(p.num))); });
      const C = D.colors || {}, bg = c => (c ? ` style="background:${esc(c)};color:#1f2328"` : '');
      // 格子顏色：這個人的固定班（A1、B1、宿…）在它自己的時段、自己的列，就上那個班的顏色
      const cellBg = (r, h, v) => {
        const p = v && people[v], def = p && defOf(p.code);
        return def && C['班:' + def.name] && def.kind === r.type && def.hours.includes(HOURS[h]) ? bg(C['班:' + def.name]) : '';
      };
      w.innerHTML = `<table class="grid day"><colgroup><col style="width:128px">${'<col style="width:30px">'.repeat(24)}<col style="width:20px"></colgroup>
        <tr${bg(C['列:時間'])}><th class="lbl">時間</th>${HOURS.map(h => `<th>${h}</th>`).join('')}<th></th></tr>
        <tr class="sb"><th class="lbl"${bg(C['列:備勤人員'])}>備勤人員</th>${sb.map((list, h) => { const n = list.filter(Boolean).length; return `<td class="${n < minAt(h) ? 'low' : ''}" title="${n} 人（下限 ${minAt(h)}）">${list.map(v => `<div>${v ? esc(v) : '&nbsp;'}</div>`).join('')}<div class="n">${n}</div></td>`; }).join('')}<td></td></tr>` +
        rows.map((r, k) => {
          const g = groupOf(r), first = k === 0 || groupOf(rows[k - 1]) !== g || g === '外勤';
          const nth = rows.slice(0, k).filter(x => x.type === r.type).length;   // 這一類的第幾列（0 起）
          const extra = !FIXED_TYPES.includes(r.type) || (r.type === '休息' && nth >= 4);
          return `<tr class="t-${g}${first ? ' first' : ''}${FIXED_TYPES.includes(r.type) ? '' : ' sub'}"><th class="lbl rl" data-row="${k}"${bg(C['列:' + g])} title="${esc(r.item ? r.item + (r.category ? '／' + r.category : '') : r.type)}">${esc(r.label)}</th>` +
            r.cells.map((v, h) => `<td data-r="${k}" data-h="${h}" class="${cellClass(k, h)}"${cellBg(r, h, v)} title="${esc(v && people[v] ? people[v].name + '（' + (people[v].code || '空白') + (people[v].off ? '，休假中' : '') + '）' : v ? '不在今天的名單' : '')}">${esc(v)}</td>`).join('') +
            `<td>${edit && extra ? `<button class="x" data-del="${k}" title="刪除這列">✕</button>` : ''}</td></tr>`;
        }).join('') + '</table>';
      w.scrollLeft = left;
      paintSel(); drawHours(); drawCal();
    };
    const setCell = (r, h, v) => {
      if (!edit) return;
      v = String(v ?? '').trim();
      const byName = D.people.find(p => p.name === v);   // 打姓名也可以
      if (byName) v = String(byName.num);
      if (rows[r].cells[h] === v) return;
      rows[r].cells[h] = v; setDirty(true);
    };

    // ---- 每人時數（同 4.2 版 AA 欄：值班＋救護＋外勤，不含休息） ----
    const drawHours = () => {
      const hrs = {}, rest = {};
      rows.forEach(r => r.cells.forEach(v => { if (!v) return; (r.type === '休息' ? rest : hrs)[v] = ((r.type === '休息' ? rest : hrs)[v] || 0) + 1; }));
      const night = Object.fromEntries(D.night.map(n => [String(n.num), n.hours]));
      $('#hrs').innerHTML = `<h2>今天在隊 ${D.people.length} 人</h2><div class="muted">點一列，格子裡這個人會標出來。黃底＝昨天深夜勤（昨夜欄，12 點前盡量不排）。</div>
        <table class="hours"><tr><th>番號</th><th>姓名</th><th>班別</th><th>時數</th><th>休息</th><th title="昨天深夜勤">昨夜</th></tr>` +
        D.people.concat(D.off.filter(p => hrs[p.num] || rest[p.num]).map(p => Object.assign({ off: true }, p))).map(p => { const k = String(p.num); return `<tr data-num="${k}" class="${hl === k ? 'on' : ''} ${night[k] ? 'night' : ''}"><td>${esc(p.num)}</td><td>${esc(p.name)}${p.status === '不計人力' ? '<span class="muted">（不計人力）</span>' : ''}${p.off ? '<span class="muted">（休假）</span>' : ''}</td><td>${esc(p.code)}</td><td>${hrs[k] || ''}</td><td>${rest[k] || ''}</td><td>${night[k] ? night[k][0] + '–' + hourLabel(HOURS.indexOf(night[k][night[k].length - 1]) + 1) : ''}</td></tr>`; }).join('') +
        '</table>';
    };

    // ---- 新增外勤 ----
    const drawAdd = () => {
      if (!edit) return;
      $('#addx').innerHTML = `<h2>新增勤務</h2>
        <div class="row"><select id="it">${D.items.map((x, k) => `<option value="${k}">${esc(x.name)}</option>`).join('')}</select>
          <input id="itx" placeholder="內容" size="10" hidden>
          <select id="st">${HOURS.map((h, i) => `<option value="${i}">${h}</option>`).join('')}</select> 到
          <select id="en"></select></div>
        <div class="muted">勾要出勤的人（<span class="busytag">橘色</span>＝那段時間已經有排）：</div><div class="chips" id="who"></div>
        <button id="addgo">加入勤務</button> <span class="muted">沒勾人就加一列空的，之後再填。</span>`;
      const it = () => D.items[Number($('#it').value)];
      const refresh = () => {
        $('#itx').hidden = !it().label.includes('{}');
        const a = Number($('#st').value), b = Number($('#en').value);
        const busy = new Set(); for (let h = a; h < b; h++) busyAt(h).forEach(v => busy.add(v));
        const checked = new Set([...main.querySelectorAll('#who input:checked')].map(x => x.value));
        const box = p => `<label class="${busy.has(String(p.num)) ? 'busy' : ''}" title="${busy.has(String(p.num)) ? '這段時間已經有排' : ''}"><input type="checkbox" value="${p.num}" ${checked.has(String(p.num)) ? 'checked' : ''}>${esc(p.num)} ${esc(p.name)}${p.code && p.off ? `<small>${esc(p.code)}</small>` : ''}</label>`;
        $('#who').innerHTML = D.people.map(box).join('') +
          (D.off.length ? `<div class="sep">休假中（外勤可以排）</div>` + D.off.map(p => box(Object.assign({ off: true }, p))).join('') : '');
      };
      // 結束時間只列起始之後的，選了起始就自動跳到下一個小時（同 4.2 版表單）
      const ends = () => {
        const a = Number($('#st').value);
        $('#en').innerHTML = range(a + 1, 25).map(i => `<option value="${i}">${hourLabel(i)}</option>`).join('');
        $('#en').value = a + 1;
      };
      $('#st').onchange = () => { ends(); refresh(); };
      $('#it').onchange = $('#en').onchange = refresh;
      $('#st').value = 0; ends();
      $('#addgo').onclick = () => {
        const x = it(), a = Number($('#st').value), b = Number($('#en').value);
        if (x.label.includes('{}') && !$('#itx').value.trim()) { $('#msg').textContent = `請輸入「${x.name}」的內容。`; $('#itx').focus(); return; }
        const label = x.label ? x.label.replace('{}', $('#itx').value.trim()) : x.name;
        const who = [...main.querySelectorAll('#who input:checked')].map(i => i.value);
        addOuter(x, label, who.length ? who : [''], a, b);
        $('#msg').textContent = `已加入「${label}」${who.length || 1} 列。`;
        main.querySelectorAll('#who input:checked').forEach(i => { i.checked = false; });
        $('#itx').value = '';
        refresh();
      };
      refresh();
    };
    const addOuter = (x, label, who, a, b, need, evk) => {
      who.forEach(num => {
        const cells = blank();
        if (num) for (let h = a; h < b; h++) cells[h] = String(num);
        rows.push({ type: '外勤', label, item: x.name, place: x.place, text: x.text, code: x.code, category: x.category, cells, need: num ? null : need, ev: evk || '' });
      });
      rows = sortRows(rows);
      setDirty(true); draw();
    };

    // ---- 行事曆 ----
    const evRange = ev => { const a = (ev.start - 8 + 24) % 24; let b = (ev.end - 8 + 24) % 24; if (b <= a) b += 24; return [a, Math.min(b, 24)]; };
    const evKey = ev => ev.duty + '|' + ev.start + '|' + ev.end;
    const evNums = ev => ev.people.map(n => { const p = Object.values(pm()).find(x => x.name === n); return p ? String(p.num) : ''; }).filter(Boolean);
    const canAdd = ev => ev.kind !== '備註';
    // 已加入：外勤列還在（列名或記號對得上）；休息看人還在不在休息列
    const isAdded = ev => {
      if (ev.kind === '休息') {
        const [a, b] = evRange(ev), nums = evNums(ev);
        return nums.length > 0 && nums.every(n => range(a, b).every(h => rows.some(r => r.type === '休息' && r.cells[h] === n)));
      }
      return rows.some(r => r.ev === evKey(ev) || (!r.ev && r.type === '外勤' && r.label === ev.duty));
    };
    const drawCal = () => {
      const evs = D.events || [];
      $('#cal').innerHTML = `<h2>行事曆</h2>` + (D.calendarError ? `<div class="err">讀不到行事曆：${esc(D.calendarError)}</div>` : '') +
        (evs.length ? `<table class="cal">` + evs.map((ev, k) => `<tr><td>${ev.start === null ? '全天' : `${pad(ev.start)}–${pad(ev.end)}`}</td>
          <td class="l">${esc(ev.duty)}${ev.people.length ? '：' + esc(ev.people.join('、')) : ''}${ev.note ? `<span class="muted">（${esc(ev.note)}）</span>` : ''}${ev.unknown.length ? `<div class="err">找不到：${esc(ev.unknown.join('、'))}</div>` : ''}</td>
          <td>${esc(ev.kind)}</td><td>${edit && canAdd(ev) ? (isAdded(ev) ? '<span class="ok">已加入</span>' : `<button class="plain" data-ev="${k}">加入</button>`) : ''}</td></tr>`).join('') + '</table>'
          : '<div class="muted">今天沒有行事曆事項。</div>') +
        `<div class="muted">讀取當天時會自動帶入；刪掉那一列，這裡就會變回「加入」。指定人的會整段填好，那個人原本在值班、救護的時段會空出來給別人代班（C24）。待排的加一列空的，要排的時段有斜線底。全天的事項只列出來參考。</div>`;
    };
    /** 把行事曆事項放進排班區（不重畫），回傳空出來要代班的格子。 */
    const putEvent = ev => {
      const [a, b] = evRange(ev), nums = evNums(ev), freed = [];
      const x = D.items.find(i => ev.duty.includes(i.name)) || D.items.find(i => i.name === '其他勤務') || D.items[0];
      if (ev.kind === '休息') {
        nums.forEach(num => {
          let row = rows.find(r => r.type === '休息' && range(a, b).every(h => !r.cells[h]));
          if (!row) { row = { type: '休息', label: '休息' + (rows.filter(r => r.type === '休息').length + 1), cells: blank() }; rows.push(row); rows = sortRows(rows); }
          for (let h = a; h < b; h++) row.cells[h] = num;
        });
        return freed;
      }
      if (ev.kind === '指定人') nums.forEach(num => rows.forEach(r => { if (DUTY_TYPES.includes(r.type)) for (let h = a; h < b; h++) if (r.cells[h] === num) { r.cells[h] = ''; freed.push(`${num} ${r.type} ${HOURS[h]}`); } }));
      (ev.kind === '指定人' && nums.length ? nums : ['']).forEach(num => {
        const cells = blank();
        if (num) for (let h = a; h < b; h++) cells[h] = num;
        rows.push({ type: '外勤', label: ev.duty, item: x.name, place: x.place, text: x.text, code: x.code, category: x.category, cells, need: num ? null : range(a, b), ev: evKey(ev) });
      });
      rows = sortRows(rows);
      return freed;
    };
    const addEvent = k => {
      const ev = D.events[k], freed = putEvent(ev);
      setDirty(true); draw(); drawAdd();
      $('#msg').textContent = `已加入「${ev.duty}」。` + (freed.length ? `空出來要找人代班：${freed.join('、')}。` : '');
    };
    const range = (a, b) => [...Array(Math.max(b - a, 0))].map((_, j) => a + j);
    const pad = n => String(n).padStart(2, '0');

    // ---- 檢查 ----
    const check = () => {
      const out = [], people = pm(), mk = {};
      const add = (level, msg, cells = []) => { out.push({ level, msg }); cells.forEach(([r, h]) => { mk[r + ',' + h] = 1; }); };
      const hoursText = hs => hs.map(h => HOURS[h]).join('、');
      const duty = r => r.type !== '休息';
      const restDef = new Set(D.defs.filter(x => x.kind === '休息').map(x => x.name));
      // 重複、不在隊
      for (let h = 0; h < 24; h++) {
        const at = {};
        rows.forEach((r, k) => { const v = r.cells[h]; if (v) (at[v] = at[v] || []).push(k); });
        Object.entries(at).forEach(([v, ks]) => {
          if (!people[v]) add('錯誤', `${HOURS[h]} 時：${v} 不在今天的名單`, ks.map(k => [k, h]));
          else if (people[v].off) {
            const bad = ks.filter(k => FIXED_TYPES.includes(rows[k].type));
            if (bad.length) add('錯誤', `${HOURS[h]} 時：${v} ${people[v].name} 休假中（${people[v].code}），只能排外勤`, bad.map(k => [k, h]));
          }
          if (ks.length > 1) add('錯誤', `${HOURS[h]} 時：${v} 重複（${ks.map(k => rows[k].label).join('、')}）`, ks.map(k => [k, h]));
        });
      }
      // 值班、一救要排滿；二救 08–19（同 4.2 版）
      rows.forEach((r, k) => {
        if (r.type === '值班' || r.type === '一救') {
          const empty = range(0, 24).filter(h => !r.cells[h]);
          if (empty.length) add('錯誤', `${r.label} 沒排：${hoursText(empty)}`, empty.map(h => [k, h]));
        }
      });
      const second = rows.map((r, k) => [r, k]).filter(([r]) => r.type === '二救');
      if (second.length) {
        const empty = range(0, 12).filter(h => second.some(([r]) => !r.cells[h]));
        if (empty.length) add('提醒', `二救 08–19 有空格：${hoursText(empty)}`);
      }
      // 救護下來直接接值班（C02）
      const duty0 = rows.findIndex(r => r.type === '值班');
      if (duty0 >= 0) for (let h = 1; h < 24; h++) {
        const v = rows[duty0].cells[h];
        if (!v || v === rows[duty0].cells[h - 1]) continue;
        const k = rows.findIndex(r => (r.type === '一救' || r.type === '二救') && r.cells[h - 1] === v);
        if (k >= 0) add('錯誤', `${v} 救護下來 ${HOURS[h]} 時直接接值班`, [[duty0, h], [k, h - 1]]);
      }
      D.people.forEach(p => {
        const n = String(p.num), def = defOf(p.code);
        const own = new Set(def ? def.hours.map(h => def.kind + HOURS.indexOf(h)) : []);
        const work = range(0, 24).map(h => rows.some(r => duty(r) && r.cells[h] === n && r.category !== '訓練'));
        const restH = range(0, 24).filter(h => rows.some(r => r.type === '休息' && r.cells[h] === n));
        // 連續服勤超過 8 小時（訓練不算；值宿的人除外，同 4.2 版）
        if (!(def && def.kind === '值班')) {
          let run = 0, max = 0; work.forEach(w => { run = w ? run + 1 : 0; max = Math.max(max, run); });
          if (max > D.settings.maxRun) add('提醒', `${n} ${p.name} 連續服勤 ${max} 小時（上限 ${D.settings.maxRun}）`);
        }
        // 昨天深夜勤，12 點前排班
        if (D.night.some(x => String(x.num) === n)) {
          const early = range(0, 4).filter(h => work[h] && !own.has(rows.find(r => duty(r) && r.cells[h] === n).type + h));
          if (early.length) add('提醒', `${n} ${p.name} 昨天深夜勤，${hoursText(early)} 時有排班`);
        }
        if (!restH.length) add('提醒', `${n} ${p.name} 沒有排休息`);
        else if (restH.length < D.settings.restHours) add('提醒', `${n} ${p.name} 休息只有 ${restH.length} 小時（原則 ${D.settings.restHours} 小時）`);
        // 22–06 休息：只有幹部（番號個位數）或「長」這類休息班
        const late = restH.filter(h => h >= 14 && h < 22);
        if (late.length && Number(n) >= 10 && !restDef.has(p.code)) add('提醒', `${n} ${p.name} 休息排在 ${hoursText(late)}（22–06 原則上只有幹部）`);
        const extra = range(0, 24).filter(h => rows.some(r => duty(r) && r.cells[h] === n && !own.has(r.type + h)));
        if (Number(n) === 1 && extra.length) add('提醒', `分隊長有排班：${hoursText(extra)}`);
        if (Number(n) >= 2 && Number(n) <= 5 && extra.length > D.settings.leaderMax) add('提醒', `${n} ${p.name} 小隊長值班＋共同勤務 ${extra.length} 小時（原則最多 ${D.settings.leaderMax}）`);
        // 編制人員的限排時間、限排勤務
        if (p.limitHours.length) {
          const bad = extra.filter(h => !p.limitHours.includes(HOURS[h]));
          if (bad.length) add('提醒', `${n} ${p.name} 限排時間以外有排：${hoursText(bad)}`);
        }
        if (p.limitKind) {
          const okType = p.limitKind === '救護' ? ['一救', '二救'] : [p.limitKind];
          const bad = rows.filter(r => duty(r) && r.cells.includes(n) && !okType.includes(r.type) && !okType.includes(r.place)).map(r => r.label);
          if (bad.length) add('提醒', `${n} ${p.name} 限排${p.limitKind}，但排了：${[...new Set(bad)].join('、')}`);
        }
      });
      const low = range(0, 24).filter(h => standby(h).length < minAt(h));
      if (low.length) add('提醒', `備勤人數低於下限：${low.map(h => HOURS[h] + '（' + standby(h).length + '/' + minAt(h) + '）').join('、')}`);
      const many = range(0, 24).filter(h => rows.filter(r => r.type === '休息' && r.cells[h]).length > D.settings.restMax);
      if (many.length) add('提醒', `同時休息超過 ${D.settings.restMax} 人：${hoursText(many)}`);
      const wd = new Date(D.date + 'T12:00:00+08:00').getDay();
      if ([1, 3, 5].includes(wd) && !rows.some(r => r.item === '大隊送公文')) add('提醒', '今天星期' + WEEK[wd] + '，沒有排大隊送公文');
      marks = mk;
      return out;
    };
    const showCheck = list => {
      const errs = list.filter(x => x.level === '錯誤').length;
      $('#chkout').hidden = false;
      $('#chkout').innerHTML = `<h2>檢查結果</h2>` + (list.length
        ? `<div class="muted">錯誤 ${errs} 個、提醒 ${list.length - errs} 個。錯誤的格子在表上用紅框標出來。</div><ul class="chk">` +
          list.map(x => `<li class="${x.level === '錯誤' ? 'e' : 'w'}"><b>${x.level}</b> ${esc(x.msg)}</li>`).join('') + '</ul>'
        : '<div class="ok">都沒問題。</div>');
      draw();
      return errs;
    };

    // ---- 選取、打字、複製貼上（同月班表） ----
    const rng = () => sel && { ra: Math.min(sel.r0, sel.r1), rb: Math.max(sel.r0, sel.r1), ha: Math.min(sel.h0, sel.h1), hb: Math.max(sel.h0, sel.h1) };
    const eachSel = fn => { const r = rng(); for (let a = r.ra; a <= r.rb; a++) for (let h = r.ha; h <= r.hb; h++) fn(a, h); };
    const paintSel = () => {
      main.querySelectorAll('#gw td.sel, #gw td.cur').forEach(c => c.classList.remove('sel', 'cur'));
      if (!sel || !rows[sel.r1]) return;
      eachSel((a, h) => td(a, h).classList.add('sel'));
      td(sel.r1, sel.h1).classList.add('cur');
    };
    const move = (dr, dh, extend) => {
      if (!sel) return;
      const r1 = Math.max(0, Math.min(rows.length - 1, sel.r1 + dr)), h1 = Math.max(0, Math.min(23, sel.h1 + dh));
      sel = extend ? Object.assign(sel, { r1, h1 }) : { r0: r1, h0: h1, r1, h1 };
      paintSel();
    };
    const startEdit = text => {
      if (!edit || !sel) return;
      const { r1: r, h1: h } = sel, c = td(r, h);
      c.innerHTML = '<input class="cell">';
      const inp = c.firstChild;
      inp.value = text ?? rows[r].cells[h];
      inp.focus();
      editing = true;
      const done = (save, next) => {
        if (!editing) return;
        editing = false;
        if (save) { const v = inp.value; const multi = rng().ra !== rng().rb || rng().ha !== rng().hb; if (multi) eachSel((a, b) => setCell(a, b, v)); else setCell(r, h, v); }
        draw();
        if (next) move(...next, false);
        $('#gw').focus({ preventScroll: true });
      };
      inp.onkeydown = e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); done(true, rng().ha === rng().hb && rng().ra === rng().rb ? [1, 0] : null); }
        else if (e.key === 'Escape') done(false);
        else if (e.key === 'Tab') { e.preventDefault(); done(true, [0, e.shiftKey ? -1 : 1]); }
      };
      inp.onblur = () => done(true);
    };
    const cellOf = e => { const c = e.target.closest('#gw td[data-r]'); return c && { r: Number(c.dataset.r), h: Number(c.dataset.h) }; };
    const pop = $('#pop');
    $('#gw').addEventListener('mousedown', e => {
      if (e.target.closest('input, button')) return;
      const c = cellOf(e); if (!c) return;
      e.preventDefault(); $('#gw').focus({ preventScroll: true });
      sel = e.shiftKey && sel ? Object.assign(sel, { r1: c.r, h1: c.h }) : { r0: c.r, h0: c.h, r1: c.r, h1: c.h };
      dragging = true; paintSel();
    });
    $('#gw').addEventListener('mouseover', e => { if (!dragging) return; const c = cellOf(e); if (c) { Object.assign(sel, { r1: c.r, h1: c.h }); paintSel(); } });
    $('#gw').addEventListener('click', e => {
      const del = e.target.closest('button[data-del]');
      if (del) { rows.splice(Number(del.dataset.del), 1); sel = null; setDirty(true); draw(); return; }
      const lbl = edit && e.target.closest('th.rl');
      if (lbl && !lbl.querySelector('input')) {
        const k = Number(lbl.dataset.row);
        lbl.innerHTML = `<input class="cell" value="${esc(rows[k].label)}">`;
        const inp = lbl.firstChild; inp.focus(); inp.select();
        const fin = () => { const v = inp.value.trim(); if (v && v !== rows[k].label) { rows[k].label = v; setDirty(true); } draw(); };
        inp.onblur = fin; inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.value = rows[k].label; inp.blur(); } };
      }
    });
    $('#gw').addEventListener('keydown', e => {
      if (!sel || editing) return;
      const k = e.key, ctrl = e.ctrlKey || e.metaKey;
      const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (arrows[k]) { e.preventDefault(); move(...arrows[k], e.shiftKey); }
      else if (k === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1, false); }
      else if (k === 'Enter') { e.preventDefault(); move(1, 0, false); }
      else if (k === 'F2') { e.preventDefault(); startEdit(); }
      else if ((k === 'Delete' || k === 'Backspace') && edit) { e.preventDefault(); eachSel((a, h) => setCell(a, h, '')); draw(); }
      else if (k.length === 1 && !ctrl && !e.altKey && edit) { e.preventDefault(); startEdit(k); }
    });
    $('#gw').addEventListener('compositionstart', () => { if (!editing && sel && edit) startEdit(''); });
    const focused = () => main.querySelector('#gw:focus');
    const onCopy = e => {
      if (!main.isConnected) return document.removeEventListener('copy', onCopy);
      if (!sel || editing || !focused()) return;
      const r = rng(), out = [];
      for (let a = r.ra; a <= r.rb; a++) out.push(rows[a].cells.slice(r.ha, r.hb + 1).join('\t'));
      e.clipboardData.setData('text/plain', out.join('\n')); e.preventDefault();
    };
    const onPaste = e => {
      if (!main.isConnected) return document.removeEventListener('paste', onPaste);
      if (!edit || !sel || editing || !focused()) return;
      e.preventDefault();
      const block = e.clipboardData.getData('text/plain').replace(/\r/g, '').replace(/\n$/, '').split('\n').map(r => r.split('\t'));
      const r = rng();
      if (block.length === 1 && block[0].length === 1) eachSel((a, h) => setCell(a, h, block[0][0]));
      else block.forEach((row, i) => row.forEach((v, j) => { if (rows[r.ra + i] && r.ha + j < 24) setCell(r.ra + i, r.ha + j, v); }));
      draw();
    };
    const up = () => { dragging = false; };
    const close = e => {
      if (!main.isConnected) { document.removeEventListener('click', close); document.removeEventListener('mouseup', up); return; }
      if (!e.target.closest('#pop, td[data-sb]')) pop.hidden = true;
    };
    document.addEventListener('copy', onCopy); document.addEventListener('paste', onPaste);
    document.addEventListener('click', close); document.addEventListener('mouseup', up);

    $('#body').addEventListener('click', e => {
      const tr = e.target.closest('#hrs tr[data-num]');
      if (tr) { hl = hl === tr.dataset.num ? '' : tr.dataset.num; draw(); }
      const ev = e.target.closest('#cal button[data-ev]');
      if (ev && !ev.disabled) addEvent(Number(ev.dataset.ev));
    });

    // ---- 讀取、存檔 ----
    // mode：draft＝還沒存檔的草稿、saved＝資料庫的存檔、fresh＝從月班表帶入固定班＋行事曆
    const start = (d, mode, done) => {
      D = d; marks = {}; sel = null; hl = '';
      let notes = [], freed = [];
      const draft = dayDrafts()[d.date];
      if (mode === 'draft') rows = draft.rows;
      else if (mode === 'saved') rows = sortRows(d.saved.rows.map(r => Object.assign({}, r, { cells: r.cells.concat(blank()).slice(0, 24).map(String) })));
      else {
        const f = fixedRows(); rows = f.rows; notes = f.notes;
        (d.events || []).filter(canAdd).forEach(ev => { freed = freed.concat(putEvent(ev)); });
      }
      $('#memo').value = mode === 'draft' ? draft.memo : mode === 'saved' ? d.saved.memo : '';
      // 車輛保養＝值宿的人、二替＝A 班（4.3 版起直接帶入）；存過的照存檔
      const byKind = test => d.people.filter(p => { const df = defOf(p.code); return df && test(df); }).sort((a, b) => a.code.localeCompare(b.code)).map(p => String(p.num));
      const pick = (k, dflt) => (mode === 'draft' && draft[k] ? draft[k] : mode === 'saved' && d.saved[k] ? d.saved[k] : dflt);
      $('#car').value = pick('car', byKind(df => df.kind === '值班')).join('.');
      $('#sub').value = pick('sub', byKind(df => /^A/i.test(df.name))).join('.');
      $('#body').hidden = false; $('#chkout').hidden = true;
      const savedTxt = d.saved ? `<b>已存檔</b>（${esc(d.saved.savedBy)} ${esc(d.saved.savedAt)}）` : '還沒存檔';
      $('#info').innerHTML = `${esc(d.date)}（${esc(WEEK[new Date(d.date + 'T12:00:00+08:00').getDay()])}）　${savedTxt}` +
        ({ draft: '　<b class="warnt">顯示的是還沒存檔的修改</b>，按「存檔」才會存進資料庫' + (draft && draft.version !== d.version ? '<div class="err">注意：你改這份之後，有人存過這一天，存檔會被擋下來。</div>' : ''),
           saved: '，改完再存就是異動', fresh: d.saved ? '　現在顯示的是重新帶入的固定班，存檔會蓋掉原本的' : '　已帶入固定班和行事曆' })[mode] +
        (notes.length ? `<div class="err">固定班有衝突：${esc(notes.join('；'))}</div>` : '') +
        (freed.length ? `<div class="err">行事曆指定人空出來、要找人代班：${esc(freed.join('、'))}</div>` : '');
      setDirty(mode === 'draft' || (mode === 'fresh' && !!d.saved));
      draw(); drawAdd();
      $('#msg').textContent = done || '';
    };
    const load = done => {
      $('#msg').textContent = '讀取中…';
      const [y, m] = ym($('#date').value);
      const table = kind => call('getTable', y, m, kind).then(t => t.rows).catch(() => []);
      return Promise.all([call('getDay', $('#date').value), table('車輛'), table('救護訓練')])
        .then(([d, car, train]) => Object.assign(d, { cars: car, trains: train }))
        .then(d => start(d, dayDrafts()[d.date] ? 'draft' : d.saved ? 'saved' : 'fresh', done))
        .catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
    };
    $('#go').onclick = () => load();
    $('#date').onchange = () => load();
    if (edit) {
      $('#chk').onclick = () => { if (D) showCheck(check()); };
      $('#refix').onclick = () => { if (D && confirm('把格子全部清掉，重新從月班表帶入固定班和行事曆？外勤和休息也會清掉。')) start(D, 'fresh', '已重新帶入。'); };
      $('#drop').onclick = () => {
        if (!D || !confirm('放棄這一天還沒存檔的修改？')) return;
        dirty = false; saveDraft(); load('已放棄修改。');
      };
      $('#addR').onclick = () => { rows.push({ type: '休息', label: '休息' + (rows.filter(r => r.type === '休息').length + 1), cells: blank() }); rows = sortRows(rows); setDirty(true); draw(); };
      $('#memo').oninput = $('#car').oninput = $('#sub').oninput = () => setDirty(true);
      $('#save').onclick = () => {
        const errs = showCheck(check());
        if (errs && !confirm(`還有 ${errs} 個錯誤，仍要存檔嗎？`)) return;
        $('#msg').textContent = '存檔中…';
        const used = new Set(rows.flatMap(r => r.cells).filter(Boolean));
        const day = {
          rows: rows.map(r => ({ label: r.label, cells: r.cells, type: r.type, place: r.place || '', text: r.text || '', code: r.code || '', category: r.category || '', item: r.item || '', ev: r.ev || '' })),
          people: D.people.concat(D.off.filter(p => used.has(String(p.num)))).map(p => ({ num: p.num, name: p.name, code: p.code })), memo: $('#memo').value,
          car: nums($('#car').value), sub: nums($('#sub').value),
        };
        call('saveDay', D.date, day, D.version)
          .then(r => { dirty = false; saveDraft(); return load(r.existed ? '已異動存檔。' : '已存檔。'); })
          .catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
      };
    }
    $('#out').onclick = () => { if (D) showSheet(); };
    // 勤務表蓋在整個畫面上、直接掛在 body 底下，列印時只印它
    const sheetBox = () => {
      let el = document.getElementById('sheet');
      if (!el) {
        el = document.createElement('div'); el.id = 'sheet'; el.className = 'sheetwrap';
        el.addEventListener('click', e => {
          if (e.target.closest('#sclose')) el.remove();
          if (e.target.closest('#sprint')) print();
        });
        document.body.appendChild(el);
      }
      return el;
    };

    // ---- 輸出勤務表：版面照 4.2 版「勤務表」工作表（sheet42.js），內容照 VBA OutPutWork ----
    const need42 = () => (window.SHEET42 ? Promise.resolve() : new Promise((ok, bad) => {
      const s = document.createElement('script'); s.src = 'sheet42.js?v=' + Date.now();
      s.onload = ok; s.onerror = () => bad(new Error('勤務表版面載入失敗，請檢查網路'));
      document.head.appendChild(s);
    }));
    const showSheet = () => need42().then(() => {
      const V = {};                                  // 儲存格位址 → 內容
      const [y, m, dd] = D.date.split('-').map(Number);
      const wd = WEEK[new Date(D.date + 'T12:00:00+08:00').getDay()];
      const n = p => Number(p.num);
      const join = a => a.filter(x => x !== '' && x != null).join('.');
      const COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const set = (col, row, v) => { V[COLS[col - 1] + row] = v == null ? '' : String(v); };
      const at = (r, h) => (r ? r.cells[h] || '' : '');
      const firstOf = t => rows.find(r => r.type === t);
      const second = t => rows.filter(r => r.type === t)[1];

      // 標題（A1）
      V.A1 = `臺 中 市 政 府 消 防 局 第 三 救 災 救 護 大 隊 霧 峰 分 隊 ${D.headcount} 人 勤 務 分 配 表    日期: ${y - 1911} 年 ${m} 月 ${dd} 日 星期${wd}       主管:`;

      // 值班、91、92、休息、三種外勤（第 3–9 列）
      HOURS.forEach((x, h) => {
        const col = h + 3;
        set(col, 3, join(rows.filter(r => groupOf(r) === '值班').map(r => at(r, h))));
        set(col, 4, join(rows.filter(r => groupOf(r) === '一救').map(r => at(r, h))));
        set(col, 5, join(rows.filter(r => groupOf(r) === '二救').map(r => at(r, h))));
        set(col, 6, join(rows.filter(r => r.type === '休息').map(r => at(r, h))));
        ['防災宣導', '水源調查', '其他臨時勤務'].forEach((place, i) =>
          set(col, 7 + i, join(rows.filter(r => r.type === '外勤' && r.place === place).map(r => at(r, h)))));
      });

      // 備註、搶救演練及訓練（同 VBA：同一個勤務、同一個開始時間的人用「.」接在後面）
      const lines = texts => {
        let out = '', last = null;
        rows.filter(r => r.type === '外勤' && texts.includes(r.text)).forEach(r => {
          const a = r.cells.findIndex(Boolean); if (a < 0) return;
          let b = a; while (b < 24 && r.cells[b]) b++;
          if (last && last.label === r.label && last.a === a) out += '.' + r.cells[a];
          else { out += `  (${HOURS[a]}-${b >= 24 ? HOURS[23] : HOURS[b]}時)${r.label}:${r.cells[a]}`; last = { label: r.label, a }; }
        });
        return out;
      };
      const sub = nums($('#sub').value), car = nums($('#car').value);
      V.C10 = '為民服務暨深夜救護備二替人員:' + sub.join('.') + '  ' + lines(['備註']);
      const tr = (D.trains || []).slice(1).find(r => Number(r[0]) === dd);
      // 救護訓練時間照「車輛／救護訓練」表的時間欄（16:00-18:00 → 16-18）
      const tt = tr && String(tr[1]).match(/(\d{1,2})[:：]?(\d{2})?\s*[-~～－]\s*(\d{1,2})/);
      const tTime = tt ? `${Number(tt[1])}-${Number(tt[3])}` : '16-18';
      V.C11 = (tr ? `(${tTime}時)救護訓練-${tr[2]}:${tr[4]}` : `(15-17時)體技能訓練:${at(firstOf('值班'), 14)}`) + lines(['搶救演練及訓練', 'C']);
      const head = (D.cars || [])[0] || [], ci = head.findIndex((v, i) => i >= 3 && Number(v) === dd);
      V.C12 = '保養試車 ' + (ci < 0 ? '' : (D.cars || []).slice(1).filter(r => r[ci]).map(r => `${r[2]}(${r[ci]}) `).join('')) +
        car.map(x => ':' + x).join('') + '   (0800-0815)個人裝備測試保養';

      // 備勤人員（B13）：今天有班的人，扣掉「離」「外」
      const today = D.people.slice().sort((a, b) => n(a) - n(b));
      const onDuty = today.filter(p => p.code !== '離' && p.code !== '外');
      const isRole = (p, t, nums2) => (p.role || '').includes(t) || nums2.includes(n(p));
      V.B13 = onDuty.map(p => p.num).join('.') + ` 合計${onDuty.length}人(含實務生${onDuty.filter(p => isRole(p, '實務生', [51, 52])).length}人、實習生${onDuty.filter(p => isRole(p, '實習生', [53])).length}人)，除上列各項勤務外餘日備勤`;

      // 假別（同 VBA：看月班表當天的代號）
      const all = D.people.concat(D.off).sort((a, b) => n(a) - n(b));
      const pick = f => all.filter(p => f(String(p.code || ''))).map(p => p.num);
      V.B15 = pick(c => c[0] === '○').join('.');       // 輪休
      V.M15 = pick(c => c === '△').join('.');           // 特休
      V.P15 = pick(c => c === '◎').join('.');           // 休假
      V.W14 = pick(c => c === '補').join('.');           // 補休
      V.W13 = pick(c => c === '超').join('.');           // 超補
      V.H15 = pick(c => c === '離').join('.');           // 申請離隊
      const pub = pick(c => c === '公');                 // 公假：最多兩格
      V.W15 = pub[0] || '';
      // 外宿、婚假、喪假共用三格：R13/S13、R15/S15、U16/W16（喪假不放第一格）
      const slot = [null, null, null], who = [[], [], []];
      [['外', '外宿', 0], ['婚', '婚假', 0], ['喪', '喪假', 1]].forEach(([code, name, from]) => {
        const list = pick(c => c === code); if (!list.length) return;
        let i = slot.indexOf(name);
        if (i < 0) { i = slot.findIndex((s, k) => k >= from && !s); if (i < 0) i = 2; slot[i] = name; }
        who[i] = who[i].concat(list);
      });
      V.R13 = slot[0] || '外宿'; V.S13 = who[0].join('.');
      V.R15 = slot[1] || '喪假'; V.S15 = who[1].join('.');
      V.U16 = slot[2] || ''; V.W16 = who[2].join('.');
      if (!slot[2]) { V.U16 = '公假'; V.W16 = pub[1] || ''; }
      const warn = [];
      if (pub.length > 2) warn.push('公假超過 2 人，請手動修改');
      if (slot[2] && pub[1]) warn.push('公假第二位因為格子已滿，請手動處理');

      // 人員名冊（第 19–24 列，每列 8 格：編號＋姓名）
      const everyone = D.people.concat(D.off, D.away || []).sort((a, b) => n(a) - n(b));
      const SLOT = [[3, 4], [6, 7], [9, 10], [12, 13], [15, 16], [18, 19], [21, 22], [24, 25]];
      [[19, p => n(p) < 10], [20, p => n(p) >= 10 && n(p) < 20], [21, p => n(p) >= 20 && n(p) < 30], [22, p => n(p) >= 30 && n(p) < 40],
        [23, p => n(p) >= 40 && n(p) < 50], [24, p => n(p) >= 50]].forEach(([row, f]) =>
        everyone.filter(f).slice(0, 8).forEach((p, i) => { set(SLOT[i][0], row, p.num); set(SLOT[i][1], row, p.name); }));

      // 救災任務編組（瑋哥 2026-11-06 訂的規則）：11 車 5 人、61／33 車各 3 人、91 車 2 人、火警值班、火場攝影，共 15 格；再多手動
      const pool = onDuty.map(p => String(p.num));
      const used = new Set();
      const take = v => (v && pool.includes(String(v)) && !used.has(String(v)) ? (used.add(String(v)), String(v)) : '');
      const cadres = pool.filter(v => Number(v) < 10);
      set(3, 27, take(cadres[0]));                        // 帶隊官
      set(3, 28, take(cadres[1]));                        // 61 副指揮官
      set(3, 29, take(cadres[2]));                        // 33 副指揮官
      V.R31 = take(at(firstOf('值班'), 14));               // 火警值班＝22 時值班
      set(21, 27, take(at(firstOf('一救'), 14)));         // 91 車司機＝22 時一救第一位
      set(23, 27, take(at(second('一救'), 14)));          // 91 車救護員＝22 時一救第二位
      set(6, 27, take(at(firstOf('值班'), 0)));           // 11 車駕駛＝08 時值班
      // 年資順序：各班越前面年資越深 → 11→21→31→41→12→22→32→42→13…
      const senior = () => take(pool.filter(v => Number(v) >= 10 && Number(v) < 50 && !used.has(v))
        .sort((a, b) => (a % 10) - (b % 10) || a - b)[0]);
      if (!V.C28) set(3, 28, senior());                  // 只有一位幹部：61 副指揮官照年資
      if (!V.F27) set(6, 27, senior());                  // 08 時值班的人已排別格：11 車駕駛照年資
      set(6, 28, senior()); set(6, 29, senior());       // 61、33 駕駛照年資
      // 5 開頭的實務生／實習生優先放 61、33 第三人
      const intern = () => take(pool.find(v => Number(v) >= 50 && !used.has(v)));
      set(9, 28, intern()); set(9, 29, intern());
      // 其餘照番號依序補上
      const next = () => take(pool.find(v => !used.has(v)));
      [[6, 27], [6, 28], [6, 29], [9, 27], [12, 27], [15, 27], [9, 28], [3, 29], [9, 29]].forEach(([c, r]) => {
        const k = COLS[c - 1] + r;
        if (!V[k]) set(c, r, next());
      });
      V.U31 = next();                                     // 火場攝影
      const left = pool.filter(v => !used.has(v));
      if (left.length) warn.push('救災任務編組格子已滿，還有 ' + left.join('.') + ' 沒排進去，請手動處理');

      // 召回人員、備註
      // 召回：補休、休假（補、超、◎、△）沒有連休 4 天以上的是第二梯次；輪休、連休 4 天以上的是第三梯次；
      // 公假、婚假、喪假等其他假別都不召回，但算在連休天數裡（後端跨月份算好 run）
      const RECALL = c => ['補', '超', '◎', '△'].includes(c);
      const offs = D.off.slice().sort((a, b) => n(a) - n(b));
      const tier2 = offs.filter(p => RECALL(p.code) && (p.run || 1) < 4).map(p => p.num);
      const tier3 = offs.filter(p => String(p.code)[0] === '○' || (RECALL(p.code) && (p.run || 1) >= 4)).map(p => p.num);
      V.P32 = `一、第一梯次(外勤、休息時間人員):${onDuty.map(p => p.num).join('.')}；第二梯次(補休、休假):${tier2.join('.')}；第三梯次(輪休及連4日不等):${tier3.join('.')}。\n二、備勤包括救災、救護、在隊車輛保養、試車、試水、試梯、在隊體技能訓練及資料處理等。\n三、搶救演練及訓練：包括常訓、組合訓練、體技能訓練、救災演練及其他應變演習訓練。\n四、分、小隊長帶班服勤應於勤務表載明，專案勤務、特定勤務於「其他臨時勤務」內依序註明。`;
      V.Q37 = '1.在勤幹部:' + today.filter(p => n(p) >= 1 && n(p) <= 5).map(p => (n(p) === 1 ? '分隊長' : '小隊長') + p.name + ' ').join('') + '\n' + $('#memo').value;

      // 排版：值班／救護／休息／外勤格子太長時，在「.」的地方換行，不讓番號被拆成兩半；
      // 備註、搶救演練及訓練一行放不下的項目整個移到下一行。寬度用欄寬估（數字、英文算半個字）
      const S42 = window.SHEET42, em = t => [...t].reduce((a, ch) => a + (/[\u0000-\u00ff]/.test(ch) ? 0.5 : 1), 0);
      HOURS.forEach((x, h) => {
        const cap = (S42.cols[h + 2] - 6) / 24;           // 13 號字一個字約 24px
        for (let r = 3; r <= 9; r++) {
          const k = COLS[h + 2] + r, parts = (V[k] || '').split('.');
          if (!V[k] || em(V[k]) <= cap) continue;
          const lines = [];
          parts.forEach(p => { const last = lines.length - 1; if (last >= 0 && em(lines[last] + '.' + p) <= cap) lines[last] += '.' + p; else lines.push(p); });
          V[k] = lines.join('\n');
        }
      });
      const wrapLine = k => {
        const cap = S42.cols.slice(2).reduce((a, b) => a + b, 0) / 26 - 2;   // 14 號字一個字約 26px，留一點邊
        const items = V[k].split(/(?=\s{2}\()/);         // 每個項目以「兩個空白＋(」開頭
        let out = '', line = '';
        items.forEach(it => {
          if (line && em(line + it) > cap) { out += line + '\n'; line = it.replace(/^\s+/, ''); } else line += it;
        });
        V[k] = out + line;
      };
      wrapLine('C10'); wrapLine('C11');

      // 畫出來
      const S = window.SHEET42, W = S.cols.reduce((a, b) => a + b, 0), H = S.rows.reduce((a, b) => a + b, 0);
      const z = Math.min(1510 / W, 1080 / H);          // 4.2 版是 A3 橫向、邊界 1cm／0.5cm
      const COLN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const byRow = {};
      S.cells.forEach(c => (byRow[c[0]] = byRow[c[0]] || []).push(c));
      const AL = { l: 'left', c: 'center', r: 'right', '': 'left' }, VA = { t: 'top', c: 'middle', b: 'bottom', '': 'middle' };
      const body = S.rows.map((ht, i) => `<tr style="height:${ht}px">` + (byRow[i + 1] || []).map(([r, c, rs, cs, v, fs, b, ha, va]) => {
        const key = COLN[c - 1] + r, val = key in V ? V[key] : v;
        const h = ha || (r === 13 || r === 15 || r === 32 ? 'l' : '');
        return `<td${rs > 1 ? ` rowspan="${rs}"` : ''}${cs > 1 ? ` colspan="${cs}"` : ''} class="${key === 'A2' ? 'diag' : ''}" style="font-size:${fs}pt;${b ? 'font-weight:700;' : ''}text-align:${AL[h] || 'left'};vertical-align:${VA[va] || 'middle'}">${esc(val).replace(/\n/g, '<br>')}</td>`;
      }).join('') + '</tr>').join('');
      sheetBox().innerHTML = `<div class="sheetbar noprint"><button id="sxlsx">下載 Excel（同時存到資料庫）</button> <button class="plain" id="sprint">網頁列印</button> <button class="plain" id="sclose">關閉</button>
          <span class="muted">內容是畫面上現在的排班（含還沒存檔的修改）。Excel 用 4.2 版的勤務表範本填好，直接開來列印最準（A3 橫向）。</span>
          <div id="smsg"></div>
          ${warn.map(t => `<div class="err">${esc(t)}</div>`).join('')}</div>
        <div class="s42wrap" style="--pz:${z.toFixed(4)}"><table class="s42" style="width:${W}px"><colgroup>${S.cols.map(px => `<col style="width:${px}px">`).join('')}</colgroup>${body}</table></div>`;
      document.getElementById('sheet').scrollTop = 0;
      document.getElementById('sxlsx').onclick = () => excelOut(V);
    }).catch(e => alert(e.message));

    // ---- 下載 Excel：資料庫的「勤務表範本.xlsx」填好內容，下載一份、雲端硬碟存一份 ----
    const needExcel = () => (window.ExcelJS ? Promise.resolve() : new Promise((ok, bad) => {
      const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
      s.onload = ok; s.onerror = () => bad(new Error('Excel 元件載入失敗，請檢查網路'));
      document.head.appendChild(s);
    }));
    // 表頭兩條斜線：左上角 → 右下角、A／B 欄交界上緣 → 右下角
    const headLines = () => {
      const S = window.SHEET42, w = S.cols[0] + S.cols[1], h = S.rows[1], k = 4;
      const cv = document.createElement('canvas'); cv.width = w * k; cv.height = h * k;
      const g = cv.getContext('2d'); g.strokeStyle = '#000'; g.lineWidth = 1.2 * k;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(w * k, h * k); g.moveTo(S.cols[0] * k, 0); g.lineTo(w * k, h * k); g.stroke();
      return cv.toDataURL('image/png');
    };
    const b64ToBuf = b64 => Uint8Array.from(atob(b64), ch => ch.charCodeAt(0)).buffer;
    const bufToB64 = buf => { const u = new Uint8Array(buf); let t = ''; for (let i = 0; i < u.length; i += 0x8000) t += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(t); };
    const excelOut = V => {
      const msg = t => { const el = document.getElementById('smsg'); if (el) el.innerHTML = t; };
      const btn = document.getElementById('sxlsx'); if (btn) btn.disabled = true;
      msg('<span class="muted">產生 Excel 中…</span>');
      const name = D.date + ' 勤務表.xlsx';
      Promise.all([needExcel(), call('getSheetTemplate')]).then(([, t]) => {
        if (!t.data) throw new Error(`資料庫還沒有勤務表範本：請把「${t.name}」放到系統帳號雲端硬碟的「${t.folder}」資料夾`);
        const wb = new ExcelJS.Workbook();
        return wb.xlsx.load(b64ToBuf(t.data)).then(() => {
          const ws = wb.worksheets[0];
          Object.keys(V).forEach(k => { const v = V[k]; ws.getCell(k).value = v === '' ? null : /^\d+$/.test(v) ? Number(v) : v; });
          // 左上角表頭：4.2 版用兩條線（Excel 圖形）分出勤務／項目／編號／時間，範本讀進來會不見，這裡畫成透明圖片蓋回去
          ws.getCell('A2').value = '勤務         項目    編號\n時間';
          ws.addImage(wb.addImage({ base64: headLines(), extension: 'png' }), { tl: { col: 0, row: 1 }, br: { col: 2, row: 2 }, editAs: 'twoCell' });
          return wb.xlsx.writeBuffer();
        });
      }).then(buf => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        a.download = name; document.body.appendChild(a); a.click(); a.remove();
        msg('<span class="muted">已下載，存到資料庫中…</span>');
        return call('saveSheetFile', D.date, bufToB64(buf));
      }).then(r => msg(`<span class="ok">已下載，也存到資料庫：${esc(r.path)}</span>`))
        .catch(e => msg(`<span class="err">${esc(e.message)}</span>`))
        .then(() => { if (btn) btn.disabled = false; });
    };
    load();
  }

  /** 排班區還沒存檔的草稿：{日期: {rows, memo, version, at}, last: 最後看的日期}，存在瀏覽器（localStorage），讀不到就只放記憶體。 */
  let draftMem = {};
  function dayDrafts(v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem('dayDrafts') || '{}');
      localStorage.setItem('dayDrafts', JSON.stringify(v));
    } catch (e) {
      if (v === undefined) return draftMem;
      draftMem = v;
    }
  }

  // ---------- 讀 Excel ----------

  const loadXLSX = () => (window.XLSX ? Promise.resolve() : new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/xlsx.full.min.js', window.APP_URL).href;
    s.onload = ok; s.onerror = () => no(new Error('Excel 讀取元件載入失敗，請重新整理'));
    document.head.appendChild(s);
  }));

  const readBook = file => loadXLSX().then(() => file.arrayBuffer())
    .then(buf => XLSX.read(buf, { type: 'array', bookFiles: true }));

  const xml = (wb, path) => {
    const f = wb.files && (wb.files[path] || wb.files['/' + path]);
    if (!f) return null;
    const text = typeof f.content === 'string' ? f.content : new TextDecoder().decode(f.content);
    return new DOMParser().parseFromString(text, 'application/xml');
  };
  const byTag = (node, tag) => [...node.getElementsByTagName(tag)];

  /** 找出某張工作表裡底色是黑色的格子（SheetJS 免費版不讀底色，所以直接讀 xlsx 裡的 XML）。 */
  function blackCells(wb, sheetName) {
    const out = new Set();
    const book = xml(wb, 'xl/workbook.xml'), rels = xml(wb, 'xl/_rels/workbook.xml.rels'), styles = xml(wb, 'xl/styles.xml');
    if (!book || !rels || !styles) return out;   // 舊版 .xls 讀不到底色
    const sh = byTag(book, 'sheet').find(s => s.getAttribute('name') === sheetName);
    const rid = sh && (sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
    const rel = byTag(rels, 'Relationship').find(r => r.getAttribute('Id') === rid);
    if (!rel) return out;
    const target = rel.getAttribute('Target').replace(/^\/?xl\//, '').replace(/^\//, '');
    const sheet = xml(wb, 'xl/' + target);
    if (!sheet) return out;
    const dark = c => {
      if (!c) return false;
      const rgb = c.getAttribute('rgb'), theme = c.getAttribute('theme'), idx = c.getAttribute('indexed');
      const tint = Number(c.getAttribute('tint') || 0);
      if (rgb) { const h = rgb.slice(-6); return [0, 2, 4].every(k => parseInt(h.substr(k, 2), 16) < 64); }
      if (theme === '1') return tint < 0.3;      // 佈景主題「文字 1」= 黑
      return idx === '8' || idx === '64';
    };
    const fills = byTag(byTag(styles, 'fills')[0] || styles, 'fill').map(f => {
      const p = byTag(f, 'patternFill')[0];
      return !!p && p.getAttribute('patternType') === 'solid' && dark(byTag(p, 'fgColor')[0]);
    });
    const xfs = byTag(byTag(styles, 'cellXfs')[0] || styles, 'xf').map(x => fills[Number(x.getAttribute('fillId') || 0)]);
    byTag(sheet, 'c').forEach(c => { if (xfs[Number(c.getAttribute('s') || 0)]) out.add(c.getAttribute('r')); });
    return out;
  }

  /** 從假表（4.2 版月班表格式）讀出 {people, days, sheet}。 */
  function parseLeave(wb) {
    const name = wb.SheetNames.find(n => /月班表|假表/.test(n)) || wb.SheetNames[0];
    const ws = wb.Sheets[name];
    const range = XLSX.utils.decode_range(ws['!ref']);
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    const isNum = v => v !== '' && !isNaN(Number(v)) && Number(v) > 0;
    const head = rows.findIndex(r => r.slice(2).filter(isNum).length >= 5);
    if (head < 0) throw new Error(`「${name}」找不到番號列（C 欄起一排數字）`);
    const people = [];
    for (let c = 2; c < rows[head].length && isNum(rows[head][c]); c++) {
      people.push({ num: Number(rows[head][c]), name: String(rows[head + 1][c] || '').replace(/\s+/g, ''), c });
    }
    const black = blackCells(wb, name);
    const days = [];
    for (let r = head + 2; r < rows.length; r++) {
      const d = Number(rows[r][0]);
      if (!d || d > 31 || String(rows[r][1]).trim() === '') continue;
      days.push({
        d, weekday: String(rows[r][1]).trim(),
        codes: people.map(p => String(rows[r][p.c] ?? '').trim()),
        away: people.map(p => black.has(XLSX.utils.encode_cell({ r: r + range.s.r, c: p.c + range.s.c }))),
      });
    }
    if (people.some(p => !p.name)) throw new Error('番號下一列要是姓名，有些番號沒有姓名');
    return { sheet: name, people: people.map(({ num, name }) => ({ num, name })), days };
  }

  // ---------- 匯入假表 ----------

  function pageLeave(main) {
    main.innerHTML = `<h1>匯入假表</h1>
      <div class="muted">上傳假表 Excel（格式同 4.2 版月班表：第 1 列番號、第 2 列姓名、A 欄日、B 欄星期）。黑色格子＝那天不在隊。<br>
      這個月已經有月班表時，已填的固定排班（A1、B1、宿…）在假表空白的格子會保留。</div>
      <div class="card"><label>月份 <input type="month" id="mon"></label>
        <input type="file" id="file" accept=".xlsx,.xlsm"> <span id="msg" class="muted"></span></div>
      <div class="card" id="out" hidden></div>`;
    const $ = s => main.querySelector(s);
    $('#mon').value = nextMonth();
    let parsed = null;
    $('#file').onchange = () => {
      const f = $('#file').files[0]; if (!f) return;
      $('#msg').textContent = '讀取中…'; $('#out').hidden = true;
      readBook(f).then(wb => {
        parsed = parseLeave(wb);
        const [y, m] = ym($('#mon').value);
        const want = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const blacks = parsed.days.reduce((n, d) => n + d.away.filter(Boolean).length, 0);
        const warn = parsed.days.length !== want ? `<div class="err">注意：假表有 ${parsed.days.length} 天，但 ${m} 月有 ${want} 天，請確認月份。</div>` : '';
        $('#msg').textContent = '';
        $('#out').hidden = false;
        $('#out').innerHTML = `<div>工作表「${esc(parsed.sheet)}」：${parsed.people.length} 人、${parsed.days.length} 天、黑色格子 ${blacks} 格。</div>${warn}
          <p><button id="ok">確認匯入 ${y} 年 ${m} 月</button></p>` + rosterTable(y, m, parsed.people, parsed.days, { title: '預覽' });
        $('#ok').onclick = () => {
          $('#ok').disabled = true; $('#msg').textContent = '匯入中…';
          call('getMonth', y, m)
            .then(cur => call('importLeave', y, m, { people: parsed.people, days: parsed.days }, cur.version))
            .then(r => { $('#msg').textContent = `已匯入 ${y} 年 ${m} 月，保留固定排班 ${r.kept} 格。`; $('#out').hidden = true; })
            .catch(e => { $('#msg').textContent = '錯誤：' + e.message; $('#ok').disabled = false; });
        };
      }).catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
    };
  }

  // ---------- 車輛、救護訓練 ----------

  function pageTables(main) {
    const kinds = [['車輛', '車輛承辦'], ['救護訓練', '救護訓練承辦']].filter(([, r]) => has(r)).map(([k]) => k);
    main.innerHTML = `<h1>車輛／救護訓練</h1>
      <div class="muted">上傳 Excel（格式同 4.2 版的「車輛」「救護訓練」工作表），整張取代這個月的資料。</div>
      <div class="card"><select id="kind">${kinds.map(k => `<option>${k}</option>`).join('')}</select>
        <input type="month" id="mon"> <input type="file" id="file" accept=".xlsx,.xlsm"> <span id="msg" class="muted"></span></div>
      <div class="card" id="out"></div>`;
    const $ = s => main.querySelector(s);
    $('#mon').value = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
    let cur = null;
    const table = rows => rows.length ? `<div class="scroll"><table>${rows.map((r, i) =>
      `<tr>${r.map(v => (i ? `<td class="l">${esc(v)}</td>` : `<th>${esc(v)}</th>`)).join('')}</tr>`).join('')}</table></div>` : '<div class="muted">沒有資料。</div>';
    const load = () => {
      const [y, m] = ym($('#mon').value);
      $('#file').value = '';
      call('getTable', y, m, $('#kind').value).then(t => {
        cur = t;
        $('#out').innerHTML = `<h2>目前的 ${y} 年 ${m} 月${esc($('#kind').value)}</h2>` + (t.exists ? table(t.rows) : '<div class="muted">還沒有資料。</div>');
      }).catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
    };
    $('#kind').onchange = $('#mon').onchange = load;
    $('#file').onchange = () => {
      const f = $('#file').files[0]; if (!f) return;
      const kind = $('#kind').value, [y, m] = ym($('#mon').value);
      readBook(f).then(wb => {
        const name = wb.SheetNames.find(n => n.includes(kind)) || wb.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' })
          .map(r => r.map(v => String(v).trim())).filter(r => r.some(v => v));
        $('#out').innerHTML = `<h2>預覽：工作表「${esc(name)}」，${Math.max(rows.length - 1, 0)} 列</h2>
          <p><button id="ok">儲存為 ${y} 年 ${m} 月${esc(kind)}</button></p>` + table(rows);
        $('#ok').onclick = () => {
          $('#ok').disabled = true; $('#msg').textContent = '儲存中…';
          call('saveTable', y, m, kind, rows, cur.version)
            .then(() => { $('#msg').textContent = '已儲存。'; load(); })
            .catch(e => { $('#msg').textContent = '錯誤：' + e.message; $('#ok').disabled = false; });
        };
      }).catch(e => { $('#msg').textContent = '錯誤：' + e.message; });
    };
    load();
  }

  // ---------- 帳號管理 ----------

  function pageAccounts(main) {
    main.innerHTML = '<h1>帳號管理</h1><div id="list" class="muted">讀取中…</div><div id="edit"></div>';
    const show = data => {
      main.querySelector('#list').innerHTML = `<div class="card"><button id="add">新增帳號</button>
        <div class="scroll" style="margin-top:10px"><table><tr><th>帳號</th><th>姓名</th><th>角色</th><th>狀態</th><th></th></tr>${
          data.accounts.map((a, i) => `<tr><td>${esc(a.user)}</td><td>${esc(a.name)}</td><td class="l">${esc(a.roles.join('、'))}</td>
            <td>${a.active ? '啟用' : '停用'}</td><td><button class="plain" data-i="${i}">修改</button></td></tr>`).join('')
        }</table></div></div>`;
      main.querySelector('#add').onclick = () => edit(data, null);
      main.querySelectorAll('[data-i]').forEach(b => { b.onclick = () => edit(data, data.accounts[b.dataset.i]); });
    };
    const edit = (data, a) => {
      const box = main.querySelector('#edit');
      box.innerHTML = `<div class="card" style="max-width:460px"><h2>${a ? '修改帳號' : '新增帳號'}</h2>
        <label class="f">帳號（英文或數字）<input id="u" value="${esc(a ? a.user : '')}" ${a ? 'disabled' : ''}></label>
        <label class="f">姓名<input id="n" value="${esc(a ? a.name : '')}"></label>
        <div class="chips">角色：${data.roles.map(r => `<label><input type="checkbox" value="${esc(r)}" ${a && a.roles.includes(r) ? 'checked' : ''}> ${esc(r)}</label>`).join('')}</div>
        <label class="chips"><input type="checkbox" id="act" ${!a || a.active ? 'checked' : ''}> 啟用</label>
        <label class="f">${a ? '重設密碼（不改就留空）' : '密碼（至少 8 個字）'}<input id="p" type="password" autocomplete="new-password"></label>
        <div class="err" id="e"></div><button id="save">儲存</button> <button class="plain" id="cancel">取消</button></div>`;
      const $ = s => box.querySelector(s);
      $('#cancel').onclick = () => { box.innerHTML = ''; };
      $('#save').onclick = () => {
        call('saveAccount', {
          user: $('#u').value.trim(), name: $('#n').value.trim(), password: $('#p').value, active: $('#act').checked,
          roles: [...box.querySelectorAll('.chips input[value]:checked')].map(x => x.value),
        }).then(d => { box.innerHTML = ''; show(d); }).catch(e => { $('#e').textContent = e.message; });
      };
    };
    call('listAccounts').then(show).catch(e => { main.querySelector('#list').textContent = '錯誤：' + e.message; });
  }

  // ---------- 操作紀錄 ----------

  function pageLog(main) {
    main.innerHTML = '<h1>操作紀錄</h1><div class="muted">最近 100 筆。</div><div id="out" class="muted">讀取中…</div>';
    call('recentLog', 100).then(rows => {
      main.querySelector('#out').innerHTML = `<div class="card scroll"><table><tr><th>時間</th><th>帳號</th><th>動作</th><th>內容</th></tr>${
        rows.map(r => `<tr><td>${esc(r.time)}</td><td>${esc(r.user)}</td><td>${esc(r.action)}</td><td class="l">${esc(r.detail)}</td></tr>`).join('')
      }</table></div>`;
    }).catch(e => { main.querySelector('#out').textContent = '錯誤：' + e.message; });
  }

  // ---------- 改密碼 ----------

  function pagePassword(main) {
    main.innerHTML = `<div class="card narrow" style="margin-top:0"><h1>改密碼</h1>
      <label class="f">原密碼<input id="o" type="password" autocomplete="current-password"></label>
      <label class="f">新密碼（至少 8 個字）<input id="n" type="password" autocomplete="new-password"></label>
      <div class="err" id="e"></div><button id="go">變更</button></div>`;
    const $ = s => main.querySelector(s);
    $('#go').onclick = () => call('changePassword', $('#o').value, $('#n').value)
      .then(() => { $('#e').textContent = '已變更。'; $('#o').value = $('#n').value = ''; })
      .catch(e => { $('#e').textContent = e.message; });
  }

  // ---------- 開始 ----------

  try { me = JSON.parse(store.get('me')); } catch (e) { me = null; }
  if (me && me.token) route('month');
  else api('needsSetup').then(loginForm).catch(e => { app.textContent = '錯誤：' + e.message; });
})();
