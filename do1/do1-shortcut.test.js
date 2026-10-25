/*********************
 * 道一云签到（快捷指令版）- Node 测试脚手架
 *
 * 运行方式：node do1/do1-shortcut.test.js
 * 不依赖任何外部框架，仅使用 Node 内置 assert。
 *
 * 通过注入 $task / $prefs / $notify / $done 全局桩，
 * 并固定 Math.random 与当前时间，驱动脚本顶层自动启动的任务流程走到 submitSign，
 * 再从 $task.fetch 收到的请求体中校验地点选取行为。
 ********************/

const assert = require("assert");
const path = require("path");

const SCRIPT_PATH = path.join(__dirname, "do1-shortcut.js");

// 期望的两条地点记录（坐标与地址必须成对一致）
const EXPECTED_PLACES = [
    {
        longitude: 113.8072478424762,
        latitude: 22.69593080913441,
        address: "福海街道桥头社区宝安大道6303号"
    },
    {
        longitude: 113.8071587108701,
        latitude: 22.69577676230792,
        address: "福海街道桥南新区17栋B号楼整三层"
    }
];

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
 * @param {number} opts.random  固定的 Math.random 返回值（决定随机选中的地点下标）
 * @param {number} opts.hour    固定的当前小时（用于命中签到时间段）
 * @returns 句柄：done 为 $done 被调用后兑现的 Promise
 */
function createRuntime({ random, hour = 8 } = {}) {
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
    global.$task = {
        fetch: async options => {
            requests.push(options);
            return { statusCode: 200, body: JSON.stringify({ code: "0", desc: "操作成功" }) };
        }
    };

    const realRandom = Math.random;
    Math.random = () => random;

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
            Math.random = realRandom;
            global.Date = RealDate;
        }
    };
}

// 每次重新加载脚本，避免模块缓存带来的状态串扰
function freshRequire() {
    delete require.cache[require.resolve(SCRIPT_PATH)];
    return require(SCRIPT_PATH);
}

async function runOnce({ random, hour = 8 }) {
    const runtime = createRuntime({ random, hour });
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

test("配置：LOCATION 承载两条地点记录，坐标与地址成对匹配", async () => {
    const { mod } = await runOnce({ random: 0 });

    assert.deepStrictEqual(
        mod.AppConfig.LOCATION.places,
        EXPECTED_PLACES,
        "地点集合应为给定的两条记录，坐标与地址成对一致"
    );
});

test("随机命中下标 0：请求体使用第一条地点记录", async () => {
    const { runtime } = await runOnce({ random: 0 });
    const body = signBody(runtime.requests);

    assert.ok(body, "应发出签到请求");
    assert.strictEqual(parseParam(body, "longitude"), String(EXPECTED_PLACES[0].longitude));
    assert.strictEqual(parseParam(body, "latitude"), String(EXPECTED_PLACES[0].latitude));
    assert.strictEqual(parseParam(body, "address"), EXPECTED_PLACES[0].address);
});

test("随机命中下标 1：请求体使用第二条地点记录", async () => {
    const { runtime } = await runOnce({ random: 0.6 });
    const body = signBody(runtime.requests);

    assert.ok(body, "应发出签到请求");
    assert.strictEqual(parseParam(body, "longitude"), String(EXPECTED_PLACES[1].longitude));
    assert.strictEqual(parseParam(body, "latitude"), String(EXPECTED_PLACES[1].latitude));
    assert.strictEqual(parseParam(body, "address"), EXPECTED_PLACES[1].address);
});

test("两次随机命中分别落在两条不同记录", async () => {
    const first = await runOnce({ random: 0 });
    const second = await runOnce({ random: 0.6 });

    const pick = runtime => {
        const body = signBody(runtime.requests);
        return [parseParam(body, "longitude"), parseParam(body, "latitude"), parseParam(body, "address")];
    };

    assert.notDeepStrictEqual(pick(second.runtime), pick(first.runtime), "两次应命中不同地点");
});

test("配置：CHECK_RULES 四个常量与 HAR 一致", async () => {
    const { mod } = await runOnce({ random: 0 });
    const rules = mod.AppConfig.CHECK_RULES;

    assert.strictEqual(rules.checkIn.id, EXPECTED_RULES.checkIn.id, "签到 id 应一致");
    assert.strictEqual(rules.checkIn.ruleId, EXPECTED_RULES.checkIn.ruleId, "签到 ruleId 应一致");
    assert.strictEqual(rules.checkOut.id, EXPECTED_RULES.checkOut.id, "签退 id 应一致");
    assert.strictEqual(rules.checkOut.ruleId, EXPECTED_RULES.checkOut.ruleId, "签退 ruleId 应一致");
});

test("签到时段：请求体使用签到那组 id/ruleId", async () => {
    const { runtime } = await runOnce({ random: 0, hour: 8 });
    const body = signBody(runtime.requests);

    assert.ok(body, "应发出签到请求");
    assert.strictEqual(parseParam(body, "id"), EXPECTED_RULES.checkIn.id);
    assert.strictEqual(parseParam(body, "ruleId"), EXPECTED_RULES.checkIn.ruleId);
});

test("签退时段：请求体使用签退那组 id/ruleId", async () => {
    const { runtime } = await runOnce({ random: 0, hour: 19 });
    const body = signBody(runtime.requests);

    assert.ok(body, "应发出签退请求");
    assert.strictEqual(parseParam(body, "id"), EXPECTED_RULES.checkOut.id);
    assert.strictEqual(parseParam(body, "ruleId"), EXPECTED_RULES.checkOut.ruleId);
});

test("请求体保留 id/ruleId 与 FIXED_PARAMS 字段", async () => {
    const { runtime } = await runOnce({ random: 0 });
    const body = signBody(runtime.requests);

    assert.strictEqual(parseParam(body, "id"), EXPECTED_RULES.checkIn.id);
    assert.strictEqual(parseParam(body, "ruleId"), EXPECTED_RULES.checkIn.ruleId);
    assert.strictEqual(parseParam(body, "againsignin"), "0");
    assert.strictEqual(parseParam(body, "mapType"), "1");
    assert.strictEqual(parseParam(body, "isMust"), "false");
});

runAll();
