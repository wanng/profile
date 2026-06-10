/*********************
 * QuantumultX 存储全量清理工具
 * 清空所有持久化存储数据
 ********************/

console.log(`========== QuantumultX 存储全量清理 ==========`);
console.log(`执行时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);

// 选项：是否清空所有存储
const CLEAN_ALL = true; // true = 清空所有，false = 只清理指定键

// 指定清理的键（当 CLEAN_ALL = false 时使用）
const CLEANUP_KEYS = [
    "CookieDo1",
    "LastSuccessTimeDo1"
];

console.log(`\n========== 清理模式 ==========`);
console.log(`模式: ${CLEAN_ALL ? '清空所有存储' : '清理指定键'}`);

if (CLEAN_ALL) {
    console.log(`\n========== 开始清空所有存储 ==========`);
    console.log(`警告: 这将删除所有持久化存储数据！`);
    
    try {
        console.log(`执行: $prefs.removeAllValues()`);
        $prefs.removeAllValues();
        console.log(`✅ 已清空所有存储`);
        
        // 验证清理结果（尝试读取已知键）
        console.log(`\n========== 清理后验证 ==========`);
        const testKeys = ["CookieDo1", "LastSuccessTimeDo1"];
        let allCleared = true;
        
        testKeys.forEach(key => {
            const value = $prefs.valueForKey(key);
            if (value === null || value === undefined || value === '') {
                console.log(`✅ ${key}: 已清空`);
            } else {
                console.log(`❌ ${key}: 仍然存在`);
                allCleared = false;
            }
        });
        
        if (allCleared) {
            $notify("存储清理完成", "所有存储已清空", "请重新捕获 Cookie");
        } else {
            $notify("存储清理部分完成", "部分数据未清空", "请检查日志");
        }
        
    } catch (error) {
        console.log(`❌ 清空失败: ${error.message}`);
        $notify("存储清理失败", error.message, "请手动在设置中删除");
    }
    
} else {
    // 只清理指定键
    console.log(`\n========== 清理前数据状态 ==========`);
    CLEANUP_KEYS.forEach(key => {
        const value = $prefs.valueForKey(key);
        if (value !== null && value !== undefined && value !== '') {
            console.log(`✅ ${key}:`);
            console.log(`   长度: ${value.length}`);
            console.log(`   内容: ${value.substring(0, 50)}...`);
        } else {
            console.log(`❌ ${key}: 未找到`);
        }
    });
    
    console.log(`\n========== 开始清理指定键 ==========`);
    let successCount = 0;
    
    CLEANUP_KEYS.forEach(key => {
        console.log(`\n清理键: ${key}`);
        try {
            console.log(`   执行: $prefs.removeValueForKey("${key}")`);
            $prefs.removeValueForKey(key);
            
            const valueAfter = $prefs.valueForKey(key);
            const isDeleted = (valueAfter === null || valueAfter === undefined || valueAfter === '');
            
            if (isDeleted) {
                console.log(`   ✅ 成功删除`);
                successCount++;
            } else {
                console.log(`   ❌ 删除失败，数据仍然存在`);
            }
        } catch (error) {
            console.log(`   ❌ 删除异常: ${error.message}`);
        }
    });
    
    console.log(`\n========== 清理结果汇总 ==========`);
    console.log(`成功删除: ${successCount} / ${CLEANUP_KEYS.length}`);
    
    $notify(
        successCount === CLEANUP_KEYS.length ? "清理完成" : "清理部分完成",
        `成功删除 ${successCount} 个键`,
        "请重新捕获 Cookie"
    );
}

console.log(`\n========== 清理完成 ==========`);
$done();