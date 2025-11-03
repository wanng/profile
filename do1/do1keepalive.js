class StorageService {
  static get(key) {
    const val = $prefs.valueForKey(key);
    console.log(`[STORAGE] 获取 ${key}: ${val ? val.substring(0, 15) + '...' : '无值'}`);
    return val;
  }
  static set(key, value) {
    console.log(`[STORAGE] 设置 ${key}: ${value ? value.substring(0, 30) + '...' : '无值'}`);
    $prefs.setValueForKey(value, key);
  }
}

const CONFIG = {
  url: 'https://qy.do1.com.cn/wxqyh/portal/wxqyhLoginCtrl/getUserInfo.do?corp_id=wx53631950e42e0440&agentCode=checkwork',
  cookieKey: 'CookieDo1',
  body: '',
  maxRetries: 3,
  retryDelay: 2000,
  notifyOnFail: true,
  notifyOnSuccess: false
};

function cookieStrToObj(cookieStr) {
  const obj = {};
  if (!cookieStr) return obj;
  cookieStr.split(';').forEach(pair => {
    const [key, val] = pair.split('=');
    if (key && val !== undefined) obj[key.trim()] = val.trim();
  });
  return obj;
}

function cookieObjToStr(cookieObj) {
  return Object.entries(cookieObj).map(([k, v]) => `${k}=${v}`).join('; ');
}

function parseSetCookie(setCookieStr) {
  // 解析单个 Set-Cookie 字符串，返回 {name: value, expires: date?, maxAge: num?, domain: str?, path: str?}
  const parts = setCookieStr.split(';').map(p => p.trim());
  if (parts.length === 0) return null;
  const [nameValue] = parts;
  const [name, value] = nameValue.split('=');
  if (!name) return null;
  const cookie = { name: name.trim(), value: value ? value.trim() : '' };
  parts.slice(1).forEach(attr => {
    const [attrName, attrValue] = attr.split('=');
    const key = attrName.toLowerCase().trim();
    if (key === 'expires') cookie.expires = new Date(attrValue);
    else if (key === 'max-age') cookie.maxAge = parseInt(attrValue, 10);
    else if (key === 'domain') cookie.domain = attrValue.trim();
    else if (key === 'path') cookie.path = attrValue.trim();
  });
  return cookie;
}

function updateCookiesFromSet(origObj, setCookies) {
  const setArr = Array.isArray(setCookies) ? setCookies : [setCookies];
  setArr.forEach(sc => {
    if (!sc) return;
    const cookie = parseSetCookie(sc);
    if (!cookie) return;
    const now = new Date();
    const isExpired = (cookie.maxAge === 0 || cookie.maxAge < 0) ||
                      (cookie.expires && cookie.expires < now);
    if (isExpired) {
      // 删除过期 Cookie
      delete origObj[cookie.name];
      console.log(`🗑️ 删除过期 Cookie: ${cookie.name}`);
    } else {
      // 更新有效 Cookie
      origObj[cookie.name] = cookie.value;
      console.log(`🔄 更新 Cookie: ${cookie.name}=${cookie.value}`);
    }
  });
  // 清理空值
  Object.keys(origObj).forEach(k => { if (!origObj[k]) delete origObj[k]; });
}

const cookie = StorageService.get(CONFIG.cookieKey);
if (!cookie) {
  const msg = 'Cookie 不存在，请先登录并保存 CookieDo1';
  console.log('❌ ' + msg);
  if (CONFIG.notifyOnFail) $notify('Do1 保活失败', 'Cookie 缺失', msg);
  $done({}); return;
}

const headers = {
  'Accept': '*/*',
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
  'Connection': 'keep-alive',
  'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
  'Origin': 'https://qy.do1.com.cn',
  'Referer': 'https://qy.do1.com.cn/wxqyh/vp/module/checkwork.html?corp_id=wx53631950e42e0440&agentCode=checkwork',
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.64 NetType/WIFI',
  'Host': 'qy.do1.com.cn',
  'Cookie': cookie
};

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(attempt = 1) {
  const req = { url: CONFIG.url, method: 'POST', headers, body: CONFIG.body };
  try {
    const res = await $task.fetch(req);
    console.log(`✅ HTTP ${res.statusCode} (尝试 ${attempt})`);

    // 解析 JSON（先检查响应）
    let json;
    try { json = JSON.parse(res.body); } catch (e) {
      const msg = `JSON 解析失败: ${e.message}`;
      console.log('❌ ' + msg);
      if (CONFIG.notifyOnFail) $notify('Do1 保活失败', '响应异常', msg);
      $done({}); return;
    }

    // 检查响应
    if (json.code !== '0') {
      const msg = `API 错误: ${json.desc || '未知'}`;
      console.log('❌ ' + msg);
      if (CONFIG.notifyOnFail) $notify('Do1 保活失败', 'API 异常', msg);
      $done({}); return;
    }

    // 更新 isLogin 检查：缺失视为 ok，仅 false 为失败
    const isLogin = json.data && (json.data.isLogin === false || json.data.isLogin === 'false') ? false : true;
    console.log(`🔍 isLogin: ${isLogin ? 'true/缺失 (ok)' : 'false (失败)'}`);
    if (!isLogin) {
      const msg = `登录失效: ${json.desc || 'isLogin=false'}`;
      console.log('❌ ' + msg);
      if (CONFIG.notifyOnFail) $notify('Do1 保活失败', 'Cookie 失效', msg);
      $done({}); return;
    }

    // 更新 Cookie
    const setCookies = res.headers['Set-Cookie'] || res.headers['set-cookie'];
    if (setCookies) {
      const origObj = cookieStrToObj(StorageService.get(CONFIG.cookieKey) || '');
      updateCookiesFromSet(origObj, setCookies);
      const newCookie = cookieObjToStr(origObj);
      StorageService.set(CONFIG.cookieKey, newCookie);
      console.log(`✅ Cookie 更新: ${newCookie.substring(0, 50)}...`);
    }

    console.log('✅ 保活成功');
    if (CONFIG.notifyOnSuccess) $notify('Do1 保活成功', '', json.desc);
    $done({});
  } catch (err) {
    console.log(`⚠️ 请求失败: ${err.message || err} (尝试 ${attempt}/${CONFIG.maxRetries})`);
    if (attempt < CONFIG.maxRetries) {
      await delay(CONFIG.retryDelay * attempt);
      return fetchWithRetry(attempt + 1);
    }
    const msg = `重试 ${CONFIG.maxRetries} 次失败`;
    console.log('❌ ' + msg);
    if (CONFIG.notifyOnFail) $notify('Do1 保活失败', '网络异常', msg);
    $done({});
  }
}

fetchWithRetry();