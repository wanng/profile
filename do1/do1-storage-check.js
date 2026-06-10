/*********************
 * QuantumultX 存储检查工具
 * 尝试读取所有持久化存储数据
 ********************/

console.log(`========== QuantumultX 存储检查 ==========`);
console.log(`执行时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);

// 已知的存储键
const knownKeys = [
    "CookieDo1",
    "LastSuccessTimeDo1"
];

// 尝试一些常见的键名模式
const commonPatterns = [
    // 道一云相关
    "do1", "Do1", "DO1", "cookie_do1", "do1_cookie",
    // 通用的可能键名
    "cookie", "Cookie", "session", "Session", "token", "Token",
    "lastSuccess", "last_success", "lastSuccessTime",
    // 其他可能的键
    "config", "Config", "settings", "Settings",
    "data", "Data", "cache", "Cache"
];

// 扩展键名列表（组合常见前缀和后缀）
const prefixes = ["", "Last", "last_", "App", "app_", "User", "user_"];
const suffixes = ["", "Time", "time", "Date", "date", "Cookie", "cookie", "Token", "token"];
const extendedKeys = [];

prefixes.forEach(prefix => {
    suffixes.forEach(suffix => {
        commonPatterns.forEach(pattern => {
            extendedKeys.push(`${prefix}${pattern}${suffix}`);
        });
    });
});

// 合并所有键名
const allKeys = [...new Set([...knownKeys, ...commonPatterns, ...extendedKeys])];

console.log(`\n========== 尝试读取已知键 ==========`);
const foundData = [];
const notFoundKeys = [];

knownKeys.forEach(key => {
    const value = $prefs.valueForKey(key);
    if (value !== null && value !== undefined) {
        foundData.push({ key, value, source: 'known' });
        console.log(`✅ ${key}:`);
        console.log(`   ${value.substring(0, 100)}${value.length > 100 ? '...' : ''}`);
    } else {
        notFoundKeys.push(key);
        console.log(`❌ ${key}: 未找到`);
    }
});

console.log(`\n========== 尝试扫描常见键名模式 ==========`);
console.log(`扫描 ${allKeys.length} 个可能的键名...`);

let scannedCount = 0;
allKeys.forEach(key => {
    const value = $prefs.valueForKey(key);
    if (value !== null && value !== undefined) {
        // 检查是否已经在已知键中找到
        const alreadyFound = foundData.some(item => item.key === key);
        if (!alreadyFound) {
            foundData.push({ key, value, source: 'scan' });
            console.log(`✅ 发现新键: ${key}`);
            console.log(`   ${value.substring(0, 50)}${value.length > 50 ? '...' : ''}`);
        }
    }
    scannedCount++;
});

console.log(`扫描完成，共检查 ${scannedCount} 个键名`);

console.log(`\n========== 存储数据汇总 ==========`);
console.log(`找到的数据项: ${foundData.length}`);
console.log(`未找到的已知键: ${notFoundKeys.length}`);

if (foundData.length > 0) {
    console.log(`\n详细列表:`);
    foundData.forEach((item, index) => {
        console.log(`${index + 1}. [${item.source}] ${item.key}`);
        console.log(`   类型: ${typeof item.value}`);
        console.log(`   长度: ${item.value.length}`);
        console.log(`   内容: ${item.value.substring(0, 100)}${item.value.length > 100 ? '...' : ''}`);
    });
}

console.log(`\n========== QuantumultX 存储机制说明 ==========`);
console.log(`注意: QuantumultX 的 $prefs API 不提供直接列出所有键的方法`);
console.log(`本脚本通过尝试常见键名模式来扫描存储`);
console.log(`如果需要查看完整存储，请:`);
console.log(`1. 打开 QuantumultX`);
console.log(`2. 进入 设置 → 持久化数据`);
console.log(`3. 查看所有存储的键值对`);

// 发送通知
const summary = foundData.length > 0 ? 
    `找到 ${foundData.length} 个存储项` : 
    `仅找到 ${knownKeys.filter(k => !notFoundKeys.includes(k)).length} 个已知键`;
$notify("存储检查完成", summary, `详见 QuantumultX 日志`);

console.log(`\n========== 检查完成 ==========`);
$done();