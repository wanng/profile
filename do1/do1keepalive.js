/******************************
 * @name Do1 保活请求脚本
 * @desc 定期访问接口以保持会话活跃状态
 * @version 2.0
 * @author ChatGPT
 ******************************/

class StorageService {
  static get(key) {
    const val = $prefs.valueForKey(key);
    console.log(`[STORAGE] 获取 ${key}: ${val ? val.substring(0, 15) + '...' : '无值'}`);
    return val;
  }
}

const CONFIG = {
  url: 'https://qy.do1.com.cn/wxqyh/portal/checkWorkSignInCtrl/getDisplayWorkHour.do',
  cookieKey: 'CookieDo1',
  body: 'belongAgent=checkwork',
  maxRetries: 3,          // 最大重试次数
  retryDelay: 2000,       // 重试间隔(ms)
  notifyOnFail: true,     // 仅在失败时通知
  notifyOnSuccess: false, // 保活成功时不打扰
};

// === 读取 Cookie ===
const cookie = StorageService.get(CONFIG.cookieKey);
if (!cookie) {
  const msg = 'Cookie 不存在，请先登录并保存 CookieDo1';
  console.log('❌ ' + msg);
  if (CONFIG.notifyOnFail) $notify('Do1 保活失败', 'Cookie 缺失', msg);
  $done();
  return;
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
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'Host': 'qy.do1.com.cn',
  'Cookie': cookie,
};

// === 工具函数 ===
function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithRetry(retries) {
  const req = { url: CONFIG.url, method: 'POST', headers, body: CONFIG.body };
  try {
    const res = await $task.fetch(req);
    console.log(`✅ 保活成功 [${res.statusCode}]`);
    if (CONFIG.notifyOnSuccess) $notify('Do1 保活成功', '', `状态码：${res.statusCode}`);
    $done();
  } catch (err) {
    console.log(`⚠️ 请求失败: ${err.error || err}，剩余重试次数：${retries}`);
    if (retries > 0) {
      await delay(CONFIG.retryDelay);
      console.log('🔁 重试中...');
      fetchWithRetry(retries - 1);
    } else {
      const msg = `请求连续失败 ${CONFIG.maxRetries} 次，请检查网络或 Cookie 是否过期`;
      console.log('❌ ' + msg);
      if (CONFIG.notifyOnFail) $notify('Do1 保活失败', '网络异常或 Cookie 失效', msg);
      $done();
    }
  }
}

// === 主执行逻辑 ===
fetchWithRetry(CONFIG.maxRetries);