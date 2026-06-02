// === 💾 存储服务 ===
class Storage {
  static get(key) {
    const val = $prefs.valueForKey(key);
    return val;
  }
  static set(key, value) {
    $prefs.setValueForKey(value, key);
  }
}

// === 🍪 Cookie 服务 ===
class Cookie {
  // 字符串 → 对象
  static strToObj(str) {
    const obj = {};
    if (!str) return obj;
    str.split(';').forEach(p => {
      const [k, v = ''] = p.split('=');
      if (k) obj[k.trim()] = v.trim();
    });
    return obj;
  }

  // 对象 → 字符串
  static objToStr(obj) {
    return Object.entries(obj)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  // 解析单个 Set-Cookie 字符串
  static parseOne(str) {
    const parts = str.split(';').map(p => p.trim());
    const [namePart] = parts;
    const [name, value = ''] = namePart.split('=');
    if (!name) return null;
    const cookie = { name: name.trim(), value: value.trim() };
    parts.slice(1).forEach(attr => {
      const [k, v] = attr.split('=');
      const key = k.toLowerCase().trim();
      if (key === 'expires') cookie.expires = new Date(v);
      if (key === 'max-age') cookie.maxAge = parseInt(v, 10);
    });
    return cookie;
  }

  // 更新 Cookie 对象（支持多 Set-Cookie 字符串）
  static updateFromHeader(obj, headerStr) {
    if (!headerStr) return;
    const cookies = headerStr.split(/,\s*(?=[^;]+=)/);
    console.log(`🍪 [COOKIE] 收到 ${cookies.length} 个 Set-Cookie`);
    const now = new Date();
    cookies.forEach(str => {
      const c = this.parseOne(str);
      if (!c) return;
      const expired = (c.maxAge !== undefined && c.maxAge <= 0) ||
                      (c.expires && c.expires < now);
      if (expired) {
        delete obj[c.name];
        console.log(`🗑️ [DELETE] 过期: ${c.name}`);
      } else {
        obj[c.name] = c.value;
        console.log(`🔄 [UPDATE] ${c.name}=${c.value.substring(0, 20)}...`);
      }
    });
    // 清理空值
    Object.keys(obj).forEach(k => { if (!obj[k]) delete obj[k]; });
  }
}

// === ⚙️ 配置 ===
const CONFIG = {
  urls: {
    userInfo: 'https://qy.do1.com.cn/wxqyh/portal/wxqyhLoginCtrl/getUserInfo.do?corp_id=wx53631950e42e0440&agentCode=checkwork',
    wxqyhConfig: 'https://qy.do1.com.cn/wxqyh/ptl/vip/wxqyhConfig.do'
  },
  bodies: {
    userInfo: '',
    wxqyhConfig: 'agentCode=checkwork'
  },
  cookieKey: 'CookieDo1',
  maxRetries: 3,
  retryDelay: 2000,
  timeout: 10000
};

// === 📮 构建请求头 ===
function buildHeaders(cookie) {
  return {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.64',
    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    'Referer': 'https://qy.do1.com.cn/wxqyh/vp/module/checkwork.html?corp_id=wx53631950e42e0440&agentCode=checkwork',
    'Origin': 'https://qy.do1.com.cn',
    'Cookie': cookie
  };
}

// === ⏳ 延时 ===
const delay = ms => new Promise(r => setTimeout(r, ms));

// === 🔗 合并 Cookie ===
function mergeCookies(existingCookie, setCookieHeader) {
  if (!setCookieHeader) return existingCookie;
  const obj = Cookie.strToObj(existingCookie);
  Cookie.updateFromHeader(obj, setCookieHeader);
  return Cookie.objToStr(obj);
}

// === 📡 调用单个接口 ===
async function callApi(apiType, cookie, attempt) {
  const url = CONFIG.urls[apiType];
  const body = CONFIG.bodies[apiType];
  const headers = buildHeaders(cookie);

  try {
    console.log(`🌐 [REQUEST] 调用 ${apiType}...`);
    const res = await $task.fetch({
      url,
      method: 'POST',
      headers,
      body,
      timeout: CONFIG.timeout
    });

    console.log(`📥 [HTTP] ${apiType} 状态码: ${res.statusCode}`);

    if (res.statusCode !== 200) {
      throw new Error(`HTTP ${res.statusCode}`);
    }

    const data = JSON.parse(res.body);

    // 业务失败
    if (data.code !== '0') {
      console.log(`❌ [FAIL] ${apiType} 返回错误: ${data.desc || '未知错误'}`);
      if (apiType === 'userInfo') {
        $notify('Do1 保活失败', '登录已失效', data.desc || '请重新登录');
        $done();
      }
      return { success: false, cookies: null, shouldStop: apiType === 'userInfo' };
    }

    // 提取 Set-Cookie
    const setCookie = res.headers['Set-Cookie'] || res.headers['set-cookie'];
    console.log(`✅ [SUCCESS] ${apiType} 调用成功`);
    return { success: true, cookies: setCookie, shouldStop: false };

  } catch (err) {
    console.log(`⚡ [ERROR] ${apiType} 请求失败: ${err.message}`);
    return { success: false, cookies: null, shouldStop: false };
  }
}

// === 🚀 主函数 ===
async function keepAlive(attempt = 1) {
  const cookie = Storage.get(CONFIG.cookieKey);
  if (!cookie) {
    console.log('⚠️ [WARN] Cookie 缺失');
    $notify('Do1 保活失败', 'Cookie 缺失', '请先登录并保存 CookieDo1');
    $done();
    return;
  }

  // === 步骤 1: 调用 getUserInfo.do ===
  const result1 = await callApi('userInfo', cookie, attempt);
  
  if (result1.shouldStop) {
    // getUserInfo 返回登录失效，已通知用户，直接退出
    return;
  }

  if (!result1.success) {
    // getUserInfo 网络失败，尝试重试
    if (attempt < CONFIG.maxRetries) {
      console.log(`⏳ [RETRY] ${CONFIG.retryDelay * attempt} ms 后重试...`);
      await delay(CONFIG.retryDelay * attempt);
      return keepAlive(attempt + 1);
    }
    console.log('💥 [FAIL] getUserInfo 最终重试失败');
    $notify('Do1 保活失败', '网络请求失败', '请检查网络连接');
    $done();
    return;
  }

  // 合并第一次 Cookie 更新
  let updatedCookie = mergeCookies(cookie, result1.cookies);

  // === 步骤 2: 调用 wxqyhConfig.do ===
  const result2 = await callApi('wxqyhConfig', updatedCookie, attempt);

  if (!result2.success) {
    // wxqyhConfig 失败，但仍保存第一次的 Cookie（部分保活）
    Storage.set(CONFIG.cookieKey, updatedCookie);
    console.log('⚠️ [PARTIAL] wxqyhConfig 失败，但 sessionCookie 已更新');
    $notify('Do1 部分保活成功', 'fileToken 未更新', '建议重新打开应用获取完整 Cookie');
    $done();
    return;
  }

  // 合并第二次 Cookie 更新
  const finalCookie = mergeCookies(updatedCookie, result2.cookies);
  Storage.set(CONFIG.cookieKey, finalCookie);

  // 输出完整 Cookie 信息
  console.log('📋 [COOKIE] 最终 Cookie:');
  const cookieObj = Cookie.strToObj(finalCookie);
  Object.entries(cookieObj).forEach(([k, v]) => {
    console.log(`  ${k}: ${v.substring(0, 30)}${v.length > 30 ? '...' : ''}`);
  });

  console.log('🎉 [SUCCESS] Do1 保活成功，Cookie 已完整更新');
  $done();
}

// === 🏁 启动 ===
keepAlive();