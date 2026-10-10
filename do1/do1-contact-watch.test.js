/*********************
 * 道一云人员变动监测 - Node 测试脚手架
 *
 * 运行方式：node do1/do1-contact-watch.test.js
 * 不依赖任何外部框架，仅使用 Node 内置 assert。
 *
 * 该文件通过注入 $task / $prefs / $notify / $done 全局桩，
 * 模拟 QuantumultX 运行时来驱动 do1-contact-watch.js 的核心逻辑。
 ********************/

const assert = require("assert");
const path = require("path");

const SCRIPT_PATH = path.join(__dirname, "do1-contact-watch.js");

// ---------- 测试数据构造 ----------

function person(userId, personName) {
    return { userId, personName, userStatus: "2" };
}

// 构造一页成功的接口响应
function pageResponse(list, { maxPage = 1, currPage = 1 } = {}) {
    return {
        statusCode: 200,
        body: JSON.stringify({
            code: "0",
            desc: "查询成功",
            data: {
                totalRows: list.length,
                pageSize: 20,
                currPage,
                maxPage,
                pageData: list
            }
        })
    };
}

// ---------- 运行时桩 ----------

/**
 * 构建一次执行的运行环境。
 * @param {object} opts
 * @param {string|null} opts.cookie      CookieDo1 的值，null 表示不写入
 * @param {string|null} opts.snapshot    Do1ContactSnapshot 的值，null/undefined 表示无快照
 * @param {Array} opts.pages             按页序号（1 起）给出响应：对象或 (options)=>响应
 * @returns 可用于断言的句柄
 */
function createRuntime({ cookie = "sessionToken=test-token", snapshot = null, pages = [] } = {}) {
    const store = {};
    if (cookie !== null) store["CookieDo1"] = cookie;
    if (snapshot !== null && snapshot !== undefined) store["Do1ContactSnapshot"] = snapshot;

    const notifications = [];
    const requests = [];
    let doneCount = 0;

    global.$prefs = {
        valueForKey: key => (key in store ? store[key] : null),
        setValueForKey: (value, key) => {
            store[key] = value;
        }
    };

    global.$notify = (title, subtitle, body) => {
        notifications.push({ title, subtitle, body });
    };

    global.$done = () => {
        doneCount++;
    };

    global.$task = {
        fetch: async options => {
            requests.push(options);
            const match = /(?:^|&)page=(\d+)/.exec(options.body || "");
            const page = match ? parseInt(match[1], 10) : 1;
            const handler = pages[page - 1];
            if (handler === undefined) {
                throw new Error(`测试未配置第 ${page} 页响应`);
            }
            return typeof handler === "function" ? handler(options) : handler;
        }
    };

    return {
        store,
        notifications,
        requests,
        get doneCount() {
            return doneCount;
        },
        readSnapshot() {
            const raw = store["Do1ContactSnapshot"];
            return raw === undefined ? null : JSON.parse(raw);
        }
    };
}

// 每次重新加载脚本，避免模块缓存带来的状态串扰
function freshRequire() {
    delete require.cache[require.resolve(SCRIPT_PATH)];
    return require(SCRIPT_PATH);
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

test("首次运行：仅建立基准快照，不发通知", async () => {
    const runtime = createRuntime({
        snapshot: null,
        pages: [pageResponse([person("u1", "张三"), person("u2", "李四")], { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 0, "首次运行不应发通知");
    assert.deepStrictEqual(runtime.readSnapshot(), { u1: "张三", u2: "李四" });
    assert.strictEqual(runtime.doneCount, 1, "必须调用 $done 一次");
});

test("新增：检出当前有、上次无的人员并通知", async () => {
    const runtime = createRuntime({
        snapshot: JSON.stringify({ u1: "张三" }),
        pages: [pageResponse([person("u1", "张三"), person("u2", "李四")], { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 1);
    assert.strictEqual(runtime.notifications[0].title, "道一云人员变动");
    assert.strictEqual(runtime.notifications[0].subtitle, "新增 1 / 减少 0");
    assert.ok(runtime.notifications[0].body.includes("李四"), "正文应包含新增姓名");
    assert.deepStrictEqual(runtime.readSnapshot(), { u1: "张三", u2: "李四" });
});

test("消失：检出上次有、当前无的人员并通知", async () => {
    const runtime = createRuntime({
        snapshot: JSON.stringify({ u1: "张三", u2: "李四" }),
        pages: [pageResponse([person("u1", "张三")], { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 1);
    assert.strictEqual(runtime.notifications[0].subtitle, "新增 0 / 减少 1");
    assert.ok(runtime.notifications[0].body.includes("李四"), "正文应包含消失姓名");
    assert.deepStrictEqual(runtime.readSnapshot(), { u1: "张三" });
});

test("无变动：静默，但快照仍刷新", async () => {
    const runtime = createRuntime({
        snapshot: JSON.stringify({ u1: "张三", u2: "李四" }),
        pages: [pageResponse([person("u1", "张三"), person("u2", "李四")], { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 0, "无变动应静默");
    assert.deepStrictEqual(runtime.readSnapshot(), { u1: "张三", u2: "李四" });
});

test("多页聚合：按 userId 去重并逐页拉取", async () => {
    const runtime = createRuntime({
        snapshot: null,
        pages: [
            pageResponse([person("u1", "张三"), person("u2", "李四")], { maxPage: 2, currPage: 1 }),
            // 第二页含跨页重复的 u2，应被去重
            pageResponse([person("u2", "李四"), person("u3", "王五")], { maxPage: 2, currPage: 2 })
        ]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.requests.length, 2, "应逐页拉取两页");
    assert.ok(runtime.requests[0].body.includes("page=1"));
    assert.ok(runtime.requests[1].body.includes("page=2"));
    assert.deepStrictEqual(runtime.readSnapshot(), { u1: "张三", u2: "李四", u3: "王五" });
});

test("总页数以首屏为准：后续页返回偏小的 maxPage 不得提前收尾", async () => {
    const runtime = createRuntime({
        snapshot: null,
        pages: [
            // 首屏声明共 3 页
            pageResponse([person("u1", "张三")], { maxPage: 3, currPage: 1 }),
            // 第二页异常地返回 maxPage=1，不得因此把总页数改小
            pageResponse([person("u2", "李四")], { maxPage: 1, currPage: 2 }),
            pageResponse([person("u3", "王五")], { maxPage: 3, currPage: 3 })
        ]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.requests.length, 3, "应按首屏 maxPage 拉满 3 页");
    assert.ok(runtime.requests[2].body.includes("page=3"), "第三页必须被请求");
    assert.deepStrictEqual(runtime.readSnapshot(), { u1: "张三", u2: "李四", u3: "王五" });
});

test("分页失败：HTTP 非 200 时中止，不更新快照、不发通知", async () => {
    const previousSnapshot = JSON.stringify({ u1: "张三" });
    const runtime = createRuntime({
        snapshot: previousSnapshot,
        pages: [
            pageResponse([person("u1", "张三"), person("u2", "李四")], { maxPage: 2, currPage: 1 }),
            { statusCode: 500, body: "server error" }
        ]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 0, "拉取失败不应发变动通知");
    assert.strictEqual(runtime.store["Do1ContactSnapshot"], previousSnapshot, "拉取失败不应更新快照");
    assert.strictEqual(runtime.doneCount, 1, "必须调用 $done 一次");
});

test("分页失败：业务 code 非 0 时中止，不更新快照、不发通知", async () => {
    const previousSnapshot = JSON.stringify({ u1: "张三" });
    const runtime = createRuntime({
        snapshot: previousSnapshot,
        pages: [
            pageResponse([person("u1", "张三")], { maxPage: 2, currPage: 1 }),
            { statusCode: 200, body: JSON.stringify({ code: "-1", desc: "登录失效" }) }
        ]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 0);
    assert.strictEqual(runtime.store["Do1ContactSnapshot"], previousSnapshot);
    assert.strictEqual(runtime.doneCount, 1);
});

test("分页失败：JSON 解析异常时中止，不更新快照、不发通知", async () => {
    const previousSnapshot = JSON.stringify({ u1: "张三" });
    const runtime = createRuntime({
        snapshot: previousSnapshot,
        pages: [
            pageResponse([person("u1", "张三")], { maxPage: 2, currPage: 1 }),
            { statusCode: 200, body: "<html>not json</html>" }
        ]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 0);
    assert.strictEqual(runtime.store["Do1ContactSnapshot"], previousSnapshot);
    assert.strictEqual(runtime.doneCount, 1);
});

test("Cookie 无效：通知 Cookie 无效，不更新快照", async () => {
    const runtime = createRuntime({
        cookie: "fileToken=only-this",
        snapshot: null,
        pages: []
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.requests.length, 0, "Cookie 无效不应发起请求");
    assert.strictEqual(runtime.notifications.length, 1);
    assert.ok(runtime.notifications[0].subtitle.includes("Cookie"), "应提示 Cookie 无效");
    assert.strictEqual(runtime.store["Do1ContactSnapshot"], undefined, "不应写入快照");
    assert.strictEqual(runtime.doneCount, 1);
});

test("请求头与 body 符合接口契约", async () => {
    const runtime = createRuntime({
        cookie: "sessionToken=abc; fileToken=def",
        snapshot: null,
        pages: [pageResponse([person("u1", "张三")], { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    const req = runtime.requests[0];
    assert.ok(req.url.endsWith("/wxqyh/portal/selectUserAction/ajaxGetUserListByOrgID.do"));
    assert.strictEqual(req.method, "POST");
    assert.strictEqual(req.body, "agentCode=ask&page=1");
    assert.strictEqual(req.headers.Cookie, "sessionToken=abc; fileToken=def");
    assert.strictEqual(req.headers.Host, "qy.do1.com.cn");
    assert.strictEqual(req.headers.Origin, "https://qy.do1.com.cn");
    assert.strictEqual(req.headers["Content-Type"], "application/x-www-form-urlencoded;charset=UTF-8");
    assert.ok(req.headers.Referer.includes("leaveapply.html"), "Referer 应指向请假申请页");
});

test("姓名过多：正文截断并追加「等」", async () => {
    const previous = {};
    const current = [];
    for (let i = 0; i < 30; i++) {
        current.push(person(`u${i}`, `员工${i}`));
    }
    const runtime = createRuntime({
        snapshot: JSON.stringify(previous),
        pages: [pageResponse(current, { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 1);
    assert.ok(runtime.notifications[0].body.includes("等"), "超长姓名列表应截断并追加等");
    assert.ok(runtime.notifications[0].body.length < 500, "正文不应无限增长");
});

runAll();
