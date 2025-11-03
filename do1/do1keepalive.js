// === 💾 存储服务 ===
class Storage {
  static get(key) {
    const val = $prefs.valueForKey(key);
    // console.log(`📦 [GET] ${key}: ${val}`);
    return val;
  }
  static set(key, value) {
    // console.log(`💽 [SET] ${key}: ${value}`);
    $prefs.setValueForKey(value, key);
  }
}

// === 🍪 Cookie 服务（参考 Storage 组织方式）===
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

    const cookies = headerStr.split(/,\s*/);
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
  url: 'https://qy.do1.com.cn/wxqyh/portal/wxqyhLoginCtrl/getUserInfo.do?corp_id=wx53631950e42e0440&agentCode=checkwork',
  cookieKey: 'CookieDo1',
  maxRetries: 3,
  retryDelay: 2000
};

// === 📮 请求头 ===
const headers = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.64',
  'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
  'Referer': 'https://qy.do1.com.cn/wxqyh/vp/module/checkwork.html?corp_id=wx53631950e42e0440&agentCode=checkwork',
  'Origin': 'https://qy.do1.com.cn'
};

// === ⏳ 延时 ===
const delay = ms => new Promise(r => setTimeout(r, ms));

// === 🚀 主函数 ===
async function keepAlive(attempt = 1) {
  const cookie = Storage.get(CONFIG.cookieKey);
  if (!cookie) {
    console.log('⚠️ [WARN] Cookie 缺失');
    $notify('Do1 保活失败', 'Cookie 缺失', '请先登录并保存 CookieDo1');
    $done();
    return;
  }

  headers.Cookie = cookie;

  try {
    console.log(`🌐 [REQUEST] 第 ${attempt} 次请求中...`);
    const res = await $task.fetch({ url: CONFIG.url, method: 'POST', headers, body: '' });
    console.log(`📥 [HTTP] 状态码: ${res.statusCode} (第 ${attempt} 次)`);

    const data = JSON.parse(res.body);

    // 业务失败
    if (data.code !== '0') {
      console.log(`❌ [FAIL] 接口返回错误: ${data.desc || '未知错误'}`);
      $notify('Do1 保活失败', '接口返回错误', data.desc || '未知错误');
      $done();
      return;
    }
    if (data.data?.isLogin === false) {
      console.log('🚫 [FAIL] 登录已失效');
      $notify('Do1 保活失败', '登录已失效', '请重新登录');
      $done();
      return;
    }
    
    // 更新 Cookie
    const setCookie = res.headers['Set-Cookie'] || res.headers['set-cookie'];
    if (setCookie) {
      const obj = Cookie.strToObj(Storage.get(CONFIG.cookieKey));
      Cookie.updateFromHeader(obj, setCookie);
      const newCookie = Cookie.objToStr(obj);
      Storage.set(CONFIG.cookieKey, newCookie);
      console.log('✅ [SUCCESS] Cookie 已更新');
    }

    console.log('🎉 [SUCCESS] Do1 保活成功');
    $done();

  } catch (err) {
    console.log(`⚡ [ERROR] ${err.message} (尝试 ${attempt}/${CONFIG.maxRetries})`);
    if (attempt < CONFIG.maxRetries) {
      console.log(`⏳ [RETRY] ${CONFIG.retryDelay * attempt} ms 后重试...`);
      await delay(CONFIG.retryDelay * attempt);
      return keepAlive(attempt + 1);
    }
    console.log('💥 [FAIL] 最终重试失败');
    $notify('Do1 保活失败', '最终失败', err.message);
    $done();
  }
}

// === 🏁 启动 ===
keepAlive();