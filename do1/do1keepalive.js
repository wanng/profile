class StorageService {
  static get(key) {
    const val = $prefs.valueForKey(key);
    console.log(`[STORAGE] 获取 ${key}: ${val}`);
    // console.log(`[STORAGE] 获取 ${key}: ${val ? val.substring(0, 15) + '...' : '无值'}`);
    return val;
  }
  static set(key, value) {
    console.log(`[STORAGE] 设置 ${key}: ${value}`);
    // console.log(`[STORAGE] 设置 ${key}: ${value ? value.substring(0, 30) + '...' : '无值'}`);
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
  cookieStr.split(';').forEach(pair => {
    const [key, val] = pair.split('=');
    if (key && val) obj[key.trim()] = val.trim();
  });
  return obj;
}

function cookieObjToStr(cookieObj) {
  return Object.entries(cookieObj).map(([k, v]) => `${k}=${v}`).join('; ');
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

    // isLogin 检查：缺失视为 true，仅 false 为失败
    const isLogin = json.data && (json.data.isLogin === false || json.data.isLogin === 'false') ? false : true;
    console.log(`🔍 isLogin: ${isLogin ? 'true/缺失' : 'false (失败)'}`);
    if (!isLogin) {
      const msg = `登录失效: ${json.desc || 'isLogin=false'}`;
      console.log('❌ ' + msg);
      if (CONFIG.notifyOnFail) $notify('Do1 保活失败', 'Cookie 失效', msg);
      $done({}); return;
    }

    // 更新 Cookie
    const setCookies = res.headers['Set-Cookie'] || res.headers['set-cookie'];

    console.log('setCookies: ' + setCookies);

    if (setCookies) {
      StorageService.set(CONFIG.cookieKey, setCookies);
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