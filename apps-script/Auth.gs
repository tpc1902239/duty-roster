/**
 * 帳號、登入與操作紀錄。
 * 分頁「帳號」：帳號、姓名、角色（頓號分隔）、鹽、雜湊、啟用
 * 分頁「操作紀錄」：時間、帳號、動作、內容
 */

const ROLES = ['排班', '假表承辦', '車輛承辦', '救護訓練承辦', '管理員'];
const SESSION_SECONDS = 6 * 3600;
const ACCOUNT_HEADER = ['帳號', '姓名', '角色', '鹽', '雜湊', '啟用'];

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
  const v = accountSheet_().getDataRange().getValues();
  v.shift();
  return v.filter(r => str_(r[0])).map((r, i) => ({
    row: i + 2, user: str_(r[0]), name: str_(r[1]),
    roles: str_(r[2]).split(/[、,，\s]+/).filter(Boolean),
    salt: str_(r[3]), hash: str_(r[4]), active: str_(r[5]) !== 'N',
  }));
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

/** 檢查登入；role 有給就要有該角色（管理員什麼都可以）。回傳 {user, name, roles}。 */
function need_(token, role) {
  const raw = token && CacheService.getScriptCache().get('s:' + token);
  if (!raw) throw new Error('登入已過期，請重新登入');
  const s = JSON.parse(raw);
  if (role && !s.roles.includes(role) && !s.roles.includes('管理員')) throw new Error('沒有「' + role + '」權限');
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
  const s = { user: a.user, name: a.name, roles: a.roles };
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
  return { roles: ROLES, accounts: accounts_().map(a => ({ user: a.user, name: a.name, roles: a.roles, active: a.active })) };
}

/** 新增或修改帳號；password 有填才重設密碼。 */
function saveAccount(token, acc) {
  const s = need_(token, '管理員');
  const user = str_(acc.user);
  if (!/^[A-Za-z0-9_.-]{2,32}$/.test(user)) throw new Error('帳號只能用英文、數字（2～32 字）');
  const roles = (acc.roles || []).filter(r => ROLES.includes(r));
  const existing = accounts_().find(a => a.user === user);
  if (existing && user === s.user && (!roles.includes('管理員') || !acc.active)) throw new Error('不能拿掉自己的管理員權限或停用自己');
  const sh = accountSheet_();
  if (existing) {
    sh.getRange(existing.row, 2, 1, 1).setValue(str_(acc.name));
    sh.getRange(existing.row, 3, 1, 1).setValue(roles.join('、'));
    sh.getRange(existing.row, 6, 1, 1).setValue(acc.active ? 'Y' : 'N');
  }
  if (!existing || acc.password) {
    checkPassword_(acc.password);
    const salt = Utilities.getUuid(), h = hash_(salt, acc.password);
    if (existing) sh.getRange(existing.row, 4, 1, 2).setValues([[salt, h]]);
    else sh.appendRow([user, str_(acc.name), roles.join('、'), salt, h, acc.active ? 'Y' : 'N']);
  }
  log_(s.user, existing ? '修改帳號' : '新增帳號', user + '：' + roles.join('、') + (acc.active ? '' : '（停用）') + (acc.password ? '，重設密碼' : ''));
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
