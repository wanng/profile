/*********************
 * 道一云 Cookie 检查脚本
 * 用于诊断存储隔离问题
 ********************/

// Cookie 存储键值
const COOKIE_KEY = "CookieDo1";

console.log(`========== Cookie 检查工具 ==========`);
console.log(`执行时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);

// 读取 Cookie
const cookie = $prefs.valueForKey(COOKIE_KEY);

if (!cookie) {
    console.log(`❌ 未找到 Cookie，存储键: ${COOKIE_KEY}`);
    console.log(`提示: 请先通过道一云应用触发脚本捕获 Cookie`);
    $notify("Cookie 检查", "未找到 Cookie", "请先触发 Cookie 捕获");
    $done();
    return;
}

console.log(`✅ 找到 Cookie，存储键: ${COOKIE_KEY}`);
console.log(`\n========== 完整 Cookie ==========`);
console.log(cookie);

// 解析 Cookie 字段
console.log(`\n========== Cookie 字段解析 ==========`);
const cookieFields = cookie.split('; ').map(field => {
    const [key, value] = field.split('=');
    return { key, value };
});

// 显示关键字段
const criticalFields = ['sessionToken', 'fileToken', 'qwRelToken', 'dqdp_sslToken', '_lastReqID', 'JSESSIONID'];
criticalFields.forEach(fieldName => {
    const field = cookieFields.find(f => f.key === fieldName);
    if (field) {
        console.log(`\n${fieldName}:`);
        if (fieldName === 'fileToken' && field.value) {
            try {
                // 解析 JWT
                const jwtParts = field.value.split('.');
                if (jwtParts.length === 3) {
                    const payload = JSON.parse(atob(jwtParts[1]));
                    console.log(`  JWT Payload:`);
                    console.log(`    - jti (唯一标识): ${payload.jti}`);
                    console.log(`    - iat (签发时间): ${payload.iat} -> ${new Date(payload.iat * 1000).toLocaleString('zh-CN')}`);
                    console.log(`    - exp (过期时间): ${payload.exp} -> ${new Date(payload.exp * 1000).toLocaleString('zh-CN')}`);
                    console.log(`    - fileToken_jw: ${payload.fileToken_jw}`);
                    
                    // 检查是否过期
                    const now = Math.floor(Date.now() / 1000);
                    if (payload.exp < now) {
                        console.log(`    ⚠️  已过期！过期 ${(now - payload.exp)} 秒`);
                    } else {
                        console.log(`    ✅ 有效，剩余 ${(payload.exp - now)} 秒`);
                    }
                }
            } catch (e) {
                console.log(`  (解析失败: ${e.message})`);
                console.log(`  原始值: ${field.value}`);
            }
        } else {
            console.log(`  ${field.value}`);
        }
    } else {
        console.log(`\n${fieldName}: ❌ 未找到`);
    }
});

// 显示所有字段列表
console.log(`\n========== 所有 Cookie 字段列表 ==========`);
cookieFields.forEach((field, index) => {
    console.log(`${index + 1}. ${field.key}: ${field.value.substring(0, 20)}${field.value.length > 20 ? '...' : ''}`);
});

// 验证 Cookie 有效性
const hasSessionToken = cookie.includes('sessionToken');
const hasFileToken = cookie.includes('fileToken');

console.log(`\n========== Cookie 有效性检查 ==========`);
console.log(`sessionToken: ${hasSessionToken ? '✅ 存在' : '❌ 缺失'}`);
console.log(`fileToken: ${hasFileToken ? '✅ 存在' : '❌ 缺失'}`);
console.log(`总体评估: ${hasSessionToken && hasFileToken ? '✅ Cookie 格式有效' : '❌ Cookie 不完整'}`);

// 发送通知
const summary = hasSessionToken && hasFileToken ? 
    `Cookie 有效，包含 ${cookieFields.length} 个字段` : 
    `Cookie 不完整，缺少关键字段`;
$notify("Cookie 检查完成", summary, `详见 QuantumultX 日志`);

console.log(`\n========== 检查完成 ==========`);
$done();