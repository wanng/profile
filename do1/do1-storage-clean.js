/*********************
 * QuantumultX 存储清理工具
 * 用于清理旧的 Cookie 和其他存储数据
 ********************/

console.log(`========== QuantumultX 存储清理工具 ==========`);
console.log(`执行时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);

// 要清理的存储键列表
const CLEANUP_KEYS = [
    "CookieDo1",           // 道一云 Cookie
    "LastSuccessTimeDo1"   // 上次成功执行时间
];

// 存储清理前的数据（用于对比）
const beforeCleanup = {};
const cleanupResults = [];

console.log(`\n========== 清理前数据状态 ==========`);
CLEANUP_KEYS.forEach(key => {
    const value = $prefs.valueForKey(key);
    beforeCleanup[key] = value;
    
    if (value !== null && value !== undefined) {
        console.log(`✅ ${key}:`);
        console.log(`   类型: ${typeof value}`);
        console.log(`   长度: ${value.length}`);
        console.log(`   内容: ${value.substring(0, 100)}${value.length > 100 ? '...' : ''}`);
    } else {
        console.log(`❌ ${key}: 未找到数据`);
    }
});

console.log(`\n========== 开始执行清理 ==========`);
console.log(`将要清理以下键: ${CLEANUP_KEYS.join(', ')}`);

// 执行清理
CLEANUP_KEYS.forEach(key => {
    const valueBefore = beforeCleanup[key];
    
    if (valueBefore !== null && valueBefore !== undefined) {
        console.log(`\n清理键: ${key}`);
        
        // 尝试删除（使用正确的 API）
        try {
            // 使用 QuantumultX 正确的删除方法：$prefs.removeValueForKey(key)
            console.log(`   执行删除操作...`);
            $prefs.removeValueForKey(key);
            
            // 验证删除结果
            const valueAfter = $prefs.valueForKey(key);
            const isDeleted = (valueAfter === null || valueAfter === undefined || valueAfter === '');
            
            cleanupResults.push({
                key,
                before: valueBefore,
                after: valueAfter,
                deleted: isDeleted
            });
            
            if (isDeleted) {
                console.log(`✅ 成功删除`);
            } else {
                console.log(`⚠️  删除失败，数据仍然存在`);
                console.log(`   删除后值: ${valueAfter.substring(0, 50)}`);
            }
        } catch (error) {
            console.log(`❌ 删除异常: ${error.message}`);
            cleanupResults.push({
                key,
                before: valueBefore,
                after: null,
                deleted: false,
                error: error.message
            });
        }
    } else {
        console.log(`\n跳过键: ${key} (无数据)`);
        cleanupResults.push({
            key,
            before: null,
            after: null,
            deleted: true,
            skipped: true
        });
    }
});

console.log(`\n========== 清理结果汇总 ==========`);
console.log(`总处理键数: ${CLEANUP_KEYS.length}`);

const successCount = cleanupResults.filter(r => r.deleted).length;
const failedCount = cleanupResults.filter(r => !r.deleted).length;
const skippedCount = cleanupResults.filter(r => r.skipped).length;

console.log(`✅ 成功删除: ${successCount}`);
console.log(`❌ 删除失败: ${failedCount}`);
console.log(`⚠️  无数据跳过: ${skippedCount}`);

// 详细结果列表
console.log(`\n详细结果:`);
cleanupResults.forEach((result, index) => {
    console.log(`${index + 1}. ${result.key}:`);
    if (result.skipped) {
        console.log(`   状态: 已跳过（无数据）`);
    } else if (result.deleted) {
        console.log(`   状态: ✅ 已删除`);
        console.log(`   删除前长度: ${result.before.length}`);
    } else {
        console.log(`   状态: ❌ 删除失败`);
        if (result.error) {
            console.log(`   错误: ${result.error}`);
        }
    }
});

// 验证清理后状态
console.log(`\n========== 清理后数据验证 ==========`);
CLEANUP_KEYS.forEach(key => {
    const value = $prefs.valueForKey(key);
    if (value === null || value === undefined || value === '') {
        console.log(`✅ ${key}: 已清空`);
    } else {
        console.log(`❌ ${key}: 仍然存在`);
        console.log(`   当前值: ${value.substring(0, 50)}`);
    }
});

// 发送通知
const notificationTitle = successCount === CLEANUP_KEYS.length ?
    "存储清理完成" :
    "存储清理部分完成";
const notificationMessage = `成功删除 ${successCount} 个，失败 ${failedCount} 个`;

$notify(notificationTitle, notificationMessage, "请重新捕获 Cookie");

console.log(`\n========== 后续操作建议 ==========`);
console.log(`1. 清理完成后，需要重新捕获 Cookie`);
console.log(`   方法: 打开微信企业号，触发脚本拦截`);
console.log(`2. 如果清理失败，请手动在 QuantumultX 设置中删除`);
console.log(`   路径: 设置 → 持久化数据 → 选择键 → 删除`);
console.log(`3. ⚠️  重要提醒: 如果快捷指令组件读取的是独立存储空间`);
console.log(`   清理主程序存储可能无效，需要在快捷指令环境中清理`);

console.log(`\n========== 清理完成 ==========`);
$done();