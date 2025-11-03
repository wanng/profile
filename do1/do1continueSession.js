/******************************
 * @name Do1 保活请求（带业务检测）
 * @version 2.2
 * @desc 检测Cookie有效性，失效则在所有重试失败后提醒
 ******************************/

class StorageService {
  static get(key) {
    const val = $prefs.valueForKey(key);
    console.log(`[STORAGE] 获取 ${key}: ${val ? val.substring(0, 15) + '...' : '无值'}`);
    return val;
  }
}

const CONFIG = {
  url: 'https://qy.do1.com.cn/wxqyh/portal/cooperationPortalCtl/continueSession.do',
  cookieKey: 'CookieDo1',
  body: 'belongAgent=checkwork',
  maxRetries: 3,
  retryDelay: 2000,
  notifyOnFail: true,
  notifyOnSuccess: false
};

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
  'Host': 'qy.do1.com.cn',
  'Cookie': cookie
};

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithRetry(retriesLeft) {
  const req = { url: CONFIG.url, method: 'POST', headers, body: CONFIG.body };
  try {
    const res = await $task.fetch(req);
    console.log(`✅ HTTP ${res.statusCode}`);
    const json = JSON.parse(res.body);

    if (json.code !== '0') {
      console.log(`⚠️ 接口返回异常: ${json.desc || '未知原因'} (剩余重试次数: ${retriesLeft})`);
      if (retriesLeft > 0) {
        await delay(CONFIG.retryDelay);
        console.log('🔁 正在重试...');
        return fetchWithRetry(retriesLeft - 1);
      } else {
        const msg = `Cookie 可能失效：${json.desc || '未知原因'} (连续失败 ${CONFIG.maxRetries} 次)`;
        console.log('❌ ' + msg);
        if (CONFIG.notifyOnFail) $notify('Do1 保活失败', 'Cookie 已失效，请重新登录', msg);
        $done();
        return;
      }
    }

    console.log('✅ 保活成功，Cookie 有效');
    if (CONFIG.notifyOnSuccess)
      $notify('Do1 保活成功', '', `接口返回：${json.desc}`);
    $done();

  } catch (err) {
    console.log(`⚠️ 网络请求失败: ${err.message || err} (剩余重试次数: ${retriesLeft})`);
    if (retriesLeft > 0) {
      await delay(CONFIG.retryDelay);
      console.log('🔁 正在重试...');
      return fetchWithRetry(retriesLeft - 1);
    } else {
      const msg = `连续失败 ${CONFIG.maxRetries} 次，可能网络问题或Cookie失效`;
      console.log('❌ ' + msg);
      if (CONFIG.notifyOnFail) $notify('Do1 保活失败', '请求异常', msg);
      $done();
    }
  }
}

fetchWithRetry(CONFIG.maxRetries);
