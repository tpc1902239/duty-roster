/**
 * 帳號、登入與操作紀錄。
 * 分頁「帳號」：帳號、姓名、角色（頓號分隔）、鹽、雜湊、啟用、權限（例如「day=改、month=看」）
 * 分頁「操作紀錄」：時間、帳號、動作、內容
 */

const ROLES = ['排班', '假表承辦', '車輛承辦', '救護訓練承辦', '管理員'];   // 舊的角色，還沒設權限的帳號照這個換算
/** 可以設權限的頁面（id 跟網頁一致）。管理員全部都能改，另外只有管理員看得到帳號管理、操作紀錄。 */
const PERM_PAGES = [
  ['day', '排班區'], ['saves', '存檔區'], ['month', '月班表'], ['shiftdefs', '固定排班設定'], ['items', '外勤項目設定'],
  ['colors', '排班區顏色'], ['staff', '編制人員'], ['drill', '駕訓登記'], ['overtime', '停休登記'], ['leave', '匯入假表'], ['tables', '車輛／救護訓練'],
];
const PERM_LEVELS = ['', '看', '改'];
const SESSION_SECONDS = 6 * 3600;
const ACCOUNT_HEADER = ['帳號', '姓名', '角色', '鹽', '雜湊', '啟用', '權限'];

function accountSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('帳號');
  if (!sh) {
    sh = ss.insertSheet('帳號');
    sh.appendRow(ACCOUNT_HEADER);
    sh.setFrozenRows(1);
  }
  return sh;
}

function accounts_() {
  const sh = accountSheet_();
  if (sh.getLastColumn() < ACCOUNT_HEADER.length) sh.getRange(1, 1, 1, ACCOUNT_HEADER.length).setValues([ACCOUNT_HEADER]);
  const v = sh.getDataRange().getValues();
  v.shift();
  return v.filter(r => str_(r[0])).map((r, i) => {
    const roles = str_(r[2]).split(/[、,，\s]+/).filter(Boolean);
    return {
      row: i + 2, user: str_(r[0]), name: str_(r[1]), roles,
      salt: str_(r[3]), hash: str_(r[4]), active: str_(r[5]) !== 'N',
      perms: str_(r[6]) ? parsePerms_(str_(r[6])) : permsFromRoles_(roles),
    };
  });
}

function parsePerms_(text) {
  const out = {};
  text.split(/[、,，\s]+/).forEach(x => { const [k, v] = x.split('='); if (PERM_PAGES.some(p => p[0] === k) && PERM_LEVELS.indexOf(v) > 0) out[k] = v; });
  return out;
}
function permsText_(perms) {
  return PERM_PAGES.filter(p => PERM_LEVELS.indexOf((perms || {})[p[0]]) > 0).map(p => p[0] + '=' + perms[p[0]]).join('、') || '無';   // 「無」＝全部不可看（空白會被當成舊帳號）
}
/** 還沒設權限的舊帳號：大家都能看；排班可以改排班相關頁面；承辦可以改各自的匯入頁。 */
function permsFromRoles_(roles) {
  const out = {};
  PERM_PAGES.forEach(p => { out[p[0]] = '看'; });
  if (roles.includes('排班')) ['day', 'month', 'shiftdefs', 'items', 'colors', 'drill', 'overtime'].forEach(k => { out[k] = '改'; });
  if (roles.includes('假表承辦')) out.leave = '改';
  if (roles.includes('車輛承辦') || roles.includes('救護訓練承辦')) out.tables = '改';
  if (!roles.includes('假表承辦')) delete out.leave;
  if (!roles.includes('車輛承辦') && !roles.includes('救護訓練承辦')) delete out.tables;
  return out;
}

function hash_(salt, password) {
  let h = salt + password;
  for (let i = 0; i < 1000; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8));
  }
  return h;
}

function checkPassword_(pw) {
  if (String(pw || '').length < 8) throw new Error('密碼至少 8 個字');
}

function log_(user, action, detail) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('操作紀錄');
  if (!sh) { sh = ss.insertSheet('操作紀錄'); sh.appendRow(['時間', '帳號', '動作', '內容']); sh.setFrozenRows(1); }
  sh.appendRow([new Date(), user, action, detail || '']);
}

/**
 * 檢查登入。page 有給：'管理員' 要是管理員；頁面 id（例如 'day'）要有那一頁「改」的權限（管理員什麼都可以）。
 * 回傳 {user, name, roles, perms}。
 */
function need_(token, page) {
  const raw = token && CacheService.getScriptCache().get('s:' + token);
  if (!raw) throw new Error('登入已過期，請重新登入');
  const s = JSON.parse(raw);
  if (!page) return s;
  // 要改資料時重新讀帳號，管理員剛改的權限或停用馬上生效
  const a = accounts_().find(x => x.user === s.user);
  if (!a || !a.active) throw new Error('帳號已停用');
  s.roles = a.roles; s.perms = a.perms;
  if (s.roles.includes('管理員')) return s;
  if (page === '管理員') throw new Error('只有管理員可以做這件事');
  if (s.perms[page] !== '改') throw new Error('沒有「' + ((PERM_PAGES.find(p => p[0] === page) || [])[1] || page) + '」的修改權限');
  return s;
}

// ---------- 給網頁呼叫的 ----------

/** 還沒有任何帳號時，網頁會先請你建立第一個管理員。 */
function needsSetup() {
  return accounts_().length === 0;
}

function setupAdmin(user, name, password) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (!needsSetup()) throw new Error('已經有帳號了');
    checkPassword_(password);
    const salt = Utilities.getUuid();
    accountSheet_().appendRow([user, name, '管理員', salt, hash_(salt, password), 'Y']);
    log_(user, '建立第一個管理員', '');
  } finally {
    lock.releaseLock();
  }
  return login(user, password);
}

function login(user, password) {
  const a = accounts_().find(x => x.user === str_(user));
  if (!a || !a.active || hash_(a.salt, password) !== a.hash) {
    Utilities.sleep(1000);
    throw new Error('帳號或密碼錯誤');
  }
  const token = Utilities.getUuid();
  const s = { user: a.user, name: a.name, roles: a.roles, perms: a.perms };
  CacheService.getScriptCache().put('s:' + token, JSON.stringify(s), SESSION_SECONDS);
  log_(a.user, '登入', '');
  return Object.assign({ token }, s);
}

function logout(token) {
  CacheService.getScriptCache().remove('s:' + token);
}

function changePassword(token, oldPw, newPw) {
  const s = need_(token);
  const a = accounts_().find(x => x.user === s.user);
  if (hash_(a.salt, oldPw) !== a.hash) throw new Error('原密碼錯誤');
  checkPassword_(newPw);
  const salt = Utilities.getUuid();
  accountSheet_().getRange(a.row, 4, 1, 2).setValues([[salt, hash_(salt, newPw)]]);
  log_(s.user, '變更密碼', '');
}

function listAccounts(token) {
  need_(token, '管理員');
  return { pages: PERM_PAGES, accounts: accounts_().map(a => ({ user: a.user, name: a.name, admin: a.roles.includes('管理員'), perms: a.perms, active: a.active })) };
}

/** 新增或修改帳號；password 有填才重設密碼。 */
function saveAccount(token, acc) {
  const s = need_(token, '管理員');
  const user = str_(acc.user);
  if (!/^[A-Za-z0-9_.-]{2,32}$/.test(user)) throw new Error('帳號只能用英文、數字（2～32 字）');
  const roles = acc.admin ? ['管理員'] : [];
  const perms = permsText_(acc.perms);
  const existing = accounts_().find(a => a.user === user);
  if (existing && user === s.user && (!acc.admin || !acc.active)) throw new Error('不能拿掉自己的管理員權限或停用自己');
  const sh = accountSheet_();
  if (existing) {
    sh.getRange(existing.row, 2, 1, 1).setValue(str_(acc.name));
    sh.getRange(existing.row, 3, 1, 1).setValue(roles.join('、'));
    sh.getRange(existing.row, 6, 1, 1).setValue(acc.active ? 'Y' : 'N');
    sh.getRange(existing.row, 7, 1, 1).setValue(perms);
  }
  if (!existing || acc.password) {
    checkPassword_(acc.password);
    const salt = Utilities.getUuid(), h = hash_(salt, acc.password);
    if (existing) sh.getRange(existing.row, 4, 1, 2).setValues([[salt, h]]);
    else sh.appendRow([user, str_(acc.name), roles.join('、'), salt, h, acc.active ? 'Y' : 'N', perms]);
  }
  log_(s.user, existing ? '修改帳號' : '新增帳號', user + '：' + (acc.admin ? '管理員、' : '') + perms + (acc.active ? '' : '（停用）') + (acc.password ? '，重設密碼' : ''));
  return listAccounts(token);
}

/** 刪除帳號（只有管理員；不能刪自己）。操作紀錄、存檔上的名字會留著。 */
function deleteAccount(token, user) {
  const s = need_(token, '管理員');
  user = str_(user);
  if (user === s.user) throw new Error('不能刪除自己的帳號');
  const a = accounts_().find(x => x.user === user);
  if (!a) throw new Error('找不到帳號 ' + user);
  accountSheet_().deleteRow(a.row);
  log_(s.user, '刪除帳號', user + '（' + a.name + '）');
  return listAccounts(token);
}

function recentLog(token, limit) {
  need_(token, '管理員');
  const sh = SpreadsheetApp.getActive().getSheetByName('操作紀錄');
  if (!sh || sh.getLastRow() < 2) return [];
  const n = Math.min(limit || 100, sh.getLastRow() - 1);
  return sh.getRange(sh.getLastRow() - n + 1, 1, n, 4).getValues().reverse()
    .map(r => ({ time: Utilities.formatDate(r[0], 'Asia/Taipei', 'yyyy-MM-dd HH:mm'), user: r[1], action: r[2], detail: r[3] }));
}
