/*********************
 * 道一云签到（定时任务版）- Node 测试脚手架
 *
 * 运行方式：node do1/do1-task.test.js
 * 不依赖任何外部框架，仅使用 Node 内置 assert。
 *
 * 通过注入 $task / $prefs / $notify / $done / $environment 全局桩，
 * 并固定当前时间，驱动脚本顶层自动启动的任务流程走到 submitSign，
 * 再从 $task.fetch 收到的请求体中校验提交内容。
 ********************/

const assert = require("assert");
const path = require("path");

const SCRIPT_PATH = path.join(__dirname, "do1-task.js");

// 期望的考勤地点：由真实签到抓包得到的单一地点
const EXPECTED_LOCATION = {
    longitude: 113.812222,
    latitude: 22.692869,
    address: "广东省深圳市宝安区育桥路"
};

// 期望的考勤规则：签到与签退各自的 id 与 ruleId 成对
const EXPECTED_RULES = {
    checkIn: {
        id: "E446B871-903A-4797-972B-783E28A688F4",
        ruleId: "29E57294-E079-4B37-A8B8-FBAA2B2C9FD1"
    },
    checkOut: {
        id: "71A48E9D-7E11-432E-BBD5-27B0279BD822",
        ruleId: "29E57294-E079-4B37-A8B8-FBAA2B2C9FD1"
    }
};

// ---------- 运行时桩 ----------

/**
 * 构建一次执行的运行环境。
 * @param {object} opts
 * @param {number} opts.hour    固定的当前小时（用于命中签到时间段）
 * @returns 句柄：done 为 $done 被调用后兑现的 Promise
 */
function createRuntime({ hour = 8 } = {}) {
    const storeRef = { CookieDo1: "sessionToken=test-token" };
    const requests = [];
    let resolveDone;
    const done = new Promise(resolve => { resolveDone = resolve; });

    global.$prefs = {
        valueForKey: key => (key in storeRef ? storeRef[key] : null),
        setValueForKey: (value, key) => { storeRef[key] = value; }
    };
    global.$notify = () => {};
    global.$done = () => resolveDone();
    // 关闭概率控制，使流程只受时间与网络响应决定
    global.$environment = { sourcePath: "qx-task#probability=off" };
    global.$task = {
        fetch: async options => {
            requests.push(options);
            if (options.method === "GET") {
                return { statusCode: 200, body: JSON.stringify({ code: "0", desc: "OK", data: {} }) };
            }
            return { statusCode: 200, body: JSON.stringify({ code: "0", desc: "操作成功" }) };
        }
    };

    const RealDate = Date;
    class MockDate extends RealDate {
        constructor(...args) {
            if (args.length === 0) {
                super(2026, 9, 25, hour, 0, 0, 0);
            } else {
                super(...args);
            }
        }
        static now() { return new RealDate(2026, 9, 25, hour, 0, 0, 0).getTime(); }
    }
    global.Date = MockDate;

    return {
        done,
        requests,
        store: storeRef,
        restore() {
            global.Date = RealDate;
        }
    };
}

// 每次重新加载脚本，避免模块缓存带来的状态串扰
function freshRequire() {
    delete require.cache[require.resolve(SCRIPT_PATH)];
    return require(SCRIPT_PATH);
}

async function runOnce({ hour = 8 } = {}) {
    const runtime = createRuntime({ hour });
    const mod = freshRequire();
    await runtime.done;
    runtime.restore();
    return { mod, runtime };
}

function parseParam(body, name) {
    const match = new RegExp(`(?:^|&)${name}=([^&]*)`).exec(body || "");
    return match ? decodeURIComponent(match[1]) : null;
}

function signBody(requests) {
    const req = requests.find(r => r.method === "POST" && /addsignin\.do/.test(r.url));
    return req ? req.body : null;
}

// ---------- 迷你测试运行器 ----------

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

async function runAll() {
    let failed = 0;
    for (const { name, fn } of tests) {
        try {
            await fn();
            console.log(`  ✅ ${name}`);
        } catch (error) {
            failed++;
            console.error(`  ❌ ${name}`);
            console.error(`     ${error && error.stack ? error.stack : error}`);
        }
    }
    console.log("");
    if (failed > 0) {
        console.error(`测试失败：${failed}/${tests.length}`);
        process.exitCode = 1;
    } else {
        console.log(`全部通过：${tests.length}/${tests.length}`);
    }
}

// ---------- 用例 ----------

test("配置：LOCATION 为抓包得到的单一地点", async () => {
    const { mod } = await runOnce();

    assert.deepStrictEqual(
        mod.AppConfig.LOCATION,
        EXPECTED_LOCATION,
        "LOCATION 应只承载抓包地点，经纬度为数字"
    );
});

test("签到时段：请求体地点字段等于抓包地点", async () => {
    const { runtime } = await runOnce({ hour: 8 });
    const body = signBody(runtime.requests);

    assert.ok(body, "应发出签到请求");
    assert.strictEqual(parseParam(body, "longitude"), String(EXPECTED_LOCATION.longitude));
    assert.strictEqual(parseParam(body, "latitude"), String(EXPECTED_LOCATION.latitude));
    assert.strictEqual(parseParam(body, "address"), EXPECTED_LOCATION.address);
});

test("签退时段：请求体地点字段等于抓包地点", async () => {
    const { runtime } = await runOnce({ hour: 19 });
    const body = signBody(runtime.requests);

    assert.ok(body, "应发出签退请求");
    assert.strictEqual(parseParam(body, "longitude"), String(EXPECTED_LOCATION.longitude));
    assert.strictEqual(parseParam(body, "latitude"), String(EXPECTED_LOCATION.latitude));
    assert.strictEqual(parseParam(body, "address"), EXPECTED_LOCATION.address);
});

test("配置：CHECK_RULES 四个常量与 HAR 一致", async () => {
    const { mod } = await runOnce();
    const rules = mod.AppConfig.CHECK_RULES;

    assert.strictEqual(rules.checkIn.id, EXPECTED_RULES.checkIn.id, "签到 id 应一致");
    assert.strictEqual(rules.checkIn.ruleId, EXPECTED_RULES.checkIn.ruleId, "签到 ruleId 应一致");
    assert.strictEqual(rules.checkOut.id, EXPECTED_RULES.checkOut.id, "签退 id 应一致");
    assert.strictEqual(rules.checkOut.ruleId, EXPECTED_RULES.checkOut.ruleId, "签退 ruleId 应一致");
});

test("签到时段：请求体使用签到那组 id/ruleId", async () => {
    const { runtime } = await runOnce({ hour: 8 });
    const body = signBody(runtime.requests);

    assert.ok(body, "应发出签到请求");
    assert.strictEqual(parseParam(body, "id"), EXPECTED_RULES.checkIn.id);
    assert.strictEqual(parseParam(body, "ruleId"), EXPECTED_RULES.checkIn.ruleId);
});

test("签退时段：请求体使用签退那组 id/ruleId", async () => {
    const { runtime } = await runOnce({ hour: 19 });
    const body = signBody(runtime.requests);

    assert.ok(body, "应发出签退请求");
    assert.strictEqual(parseParam(body, "id"), EXPECTED_RULES.checkOut.id);
    assert.strictEqual(parseParam(body, "ruleId"), EXPECTED_RULES.checkOut.ruleId);
});

test("请求体保留 id/ruleId 与 FIXED_PARAMS 字段", async () => {
    const { runtime } = await runOnce();
    const body = signBody(runtime.requests);

    assert.strictEqual(parseParam(body, "id"), EXPECTED_RULES.checkIn.id);
    assert.strictEqual(parseParam(body, "ruleId"), EXPECTED_RULES.checkIn.ruleId);
    assert.strictEqual(parseParam(body, "againsignin"), "0");
    assert.strictEqual(parseParam(body, "mapType"), "1");
    assert.strictEqual(parseParam(body, "isMust"), "false");
});

runAll();
