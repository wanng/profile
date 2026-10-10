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

// 构造一页成功的人员名单响应
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

// 构造一个部门接口成功响应
function deptResponse({ deptlist = [], userList = [], maxPage = 1, totalRows, currPage = 1 } = {}) {
    return {
        statusCode: 200,
        body: JSON.stringify({
            code: "0",
            desc: "查询成功",
            data: {
                deptlist,
                userList,
                maxPage,
                totalRows: totalRows === undefined ? userList.length : totalRows,
                currPage,
                pageSize: 20
            }
        })
    };
}

// 构造部门接口的业务失败响应（如偶发的 8888 页面已过期）
function deptError(code = "8888", desc = "页面已过期") {
    return { statusCode: 200, body: JSON.stringify({ code, desc }) };
}

// 当前格式（带版本标记）的快照原始字符串
function snapshotV2(members) {
    return JSON.stringify({ v: 2, members });
}

function parseParam(body, name) {
    const match = new RegExp(`(?:^|&)${name}=([^&]*)`).exec(body || "");
    return match ? decodeURIComponent(match[1]) : null;
}

// 从人员名单页响应中提取 userId -> personName（默认部门归属用）
function collectPersonIdMap(pages) {
    const map = new Map();
    pages.forEach(entry => {
        if (entry && typeof entry === "object" && typeof entry.body === "string") {
            try {
                const parsed = JSON.parse(entry.body);
                const list = (parsed.data && parsed.data.pageData) || [];
                list.forEach(u => {
                    if (u && u.userId) map.set(u.userId, u.personName);
                });
            } catch (error) {
                // 非 JSON 的响应构造（如故意破坏的响应），跳过
            }
        }
    });
    return map;
}

// ---------- 运行时桩 ----------

/**
 * 构建一次执行的运行环境。
 * @param {object} opts
 * @param {string|null} opts.cookie      CookieDo1 的值，null 表示不写入
 * @param {string|null} opts.snapshot    Do1ContactSnapshot 的值，null/undefined 表示无快照
 * @param {Array} opts.pages             人员接口按页序号（1 起）给出响应：对象或 (options)=>响应
 * @param {object|null} opts.depts       部门接口按 deptId 给出响应（根 deptId 为 ""）：对象或 (options)=>响应
 * @returns 可用于断言的句柄
 */
function createRuntime({ cookie = "sessionToken=test-token", snapshot = null, pages = [], depts = null } = {}) {
    const store = {};
    if (cookie !== null) store["CookieDo1"] = cookie;
    if (snapshot !== null && snapshot !== undefined) store["Do1ContactSnapshot"] = snapshot;

    const notifications = [];
    const requests = [];
    let doneCount = 0;

    // 未显式提供部门数据时，默认根部门包含人员名单里的所有人，
    // 使不关注部门逻辑的既有用例仍得到"全部人员均归属部门"的监测集
    const personMap = collectPersonIdMap(pages);
    const deptMap = depts || {
        "": deptResponse({
            userList: Array.from(personMap, ([userId, personName]) => ({ userId, personName }))
        })
    };

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

            if (/getChildDeptAndPerson\.do/.test(options.url)) {
                const deptId = parseParam(options.body, "deptId") || "";
                const entry = deptMap[deptId];
                if (entry === undefined) {
                    throw new Error(`测试未配置部门 ${deptId || "(root)"}`);
                }
                return typeof entry === "function" ? entry(options) : entry;
            }

            const page = parseInt(parseParam(options.body, "page") || "1", 10);
            const handler = pages[page - 1];
            if (handler === undefined) {
                throw new Error(`测试未配置第 ${page} 页响应`);
            }
            return typeof handler === "function" ? handler(options) : handler;
        }
    };

    const isDeptRequest = options => /getChildDeptAndPerson\.do/.test(options.url);

    return {
        store,
        notifications,
        requests,
        get personRequests() {
            return requests.filter(options => !isDeptRequest(options));
        },
        get deptRequests() {
            return requests.filter(isDeptRequest);
        },
        get doneCount() {
            return doneCount;
        },
        // 返回快照中的 members 映射（无快照时为 null）
        readSnapshot() {
            const raw = store["Do1ContactSnapshot"];
            if (raw === undefined) return null;
            return JSON.parse(raw).members;
        },
        readRawSnapshot() {
            return store["Do1ContactSnapshot"];
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

// ---------- 既有用例 ----------

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
    assert.strictEqual(JSON.parse(runtime.readRawSnapshot()).v, 2, "快照应带版本标记");
});

test("新增：检出当前有、上次无的人员并通知", async () => {
    const runtime = createRuntime({
        snapshot: snapshotV2({ u1: "张三" }),
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
        snapshot: snapshotV2({ u1: "张三", u2: "李四" }),
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
        snapshot: snapshotV2({ u1: "张三", u2: "李四" }),
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

    assert.strictEqual(runtime.personRequests.length, 2, "应逐页拉取两页");
    assert.ok(runtime.personRequests[0].body.includes("page=1"));
    assert.ok(runtime.personRequests[1].body.includes("page=2"));
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

    assert.strictEqual(runtime.personRequests.length, 3, "应按首屏 maxPage 拉满 3 页");
    assert.ok(runtime.personRequests[2].body.includes("page=3"), "第三页必须被请求");
    assert.deepStrictEqual(runtime.readSnapshot(), { u1: "张三", u2: "李四", u3: "王五" });
});

test("分页失败：HTTP 非 200 时中止，不更新快照、不发通知", async () => {
    const previousSnapshot = snapshotV2({ u1: "张三" });
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
    const previousSnapshot = snapshotV2({ u1: "张三" });
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
    const previousSnapshot = snapshotV2({ u1: "张三" });
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

test("人员接口请求头与 body 符合契约", async () => {
    const runtime = createRuntime({
        cookie: "sessionToken=abc; fileToken=def",
        snapshot: null,
        pages: [pageResponse([person("u1", "张三")], { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    const req = runtime.personRequests[0];
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
    const current = [];
    for (let i = 0; i < 30; i++) {
        current.push(person(`u${i}`, `员工${i}`));
    }
    const runtime = createRuntime({
        snapshot: snapshotV2({}),
        pages: [pageResponse(current, { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 1);
    assert.ok(runtime.notifications[0].body.includes("等"), "超长姓名列表应截断并追加等");
    assert.ok(runtime.notifications[0].body.length < 500, "正文不应无限增长");
});

// ---------- 部门归属 / 虚拟号排除 用例 ----------

test("部门接口请求符合契约", async () => {
    const runtime = createRuntime({
        cookie: "sessionToken=abc",
        snapshot: null,
        pages: [pageResponse([person("u1", "张三")], { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    const req = runtime.deptRequests[0];
    assert.ok(req.url.endsWith("/wxqyh/portal/departmentAction/getChildDeptAndPerson.do"));
    assert.strictEqual(req.method, "POST");
    assert.strictEqual(req.body, "agentCode=ask&sortTop=1&deptId=");
    assert.strictEqual(req.headers.Cookie, "sessionToken=abc");
    assert.ok(req.headers.Referer.includes("leaveapply.html"), "Referer 应指向请假申请页");
});

test("无部门归属的虚拟号被排除：出现不通知、不入快照", async () => {
    const runtime = createRuntime({
        snapshot: snapshotV2({ u1: "张三" }),
        // 名单里有虚拟号 v1（中化小泽），但它不在任何部门
        pages: [pageResponse([person("u1", "张三"), person("v1", "中化小泽")], { maxPage: 1 })],
        depts: { "": deptResponse({ userList: [person("u1", "张三")] }) }
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 0, "虚拟号出现不应触发变动通知");
    assert.deepStrictEqual(runtime.readSnapshot(), { u1: "张三" }, "虚拟号不应进入快照");
});

test("有部门归属账号的新增仍正确报告", async () => {
    const runtime = createRuntime({
        snapshot: snapshotV2({ u1: "张三" }),
        pages: [pageResponse([person("u1", "张三"), person("u2", "李四")], { maxPage: 1 })],
        depts: { "": deptResponse({ userList: [person("u1", "张三"), person("u2", "李四")] }) }
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 1);
    assert.strictEqual(runtime.notifications[0].subtitle, "新增 1 / 减少 0");
    assert.ok(runtime.notifications[0].body.includes("李四"));
});

test("有部门归属账号的消失仍正确报告", async () => {
    const runtime = createRuntime({
        snapshot: snapshotV2({ u1: "张三", u2: "李四" }),
        pages: [pageResponse([person("u1", "张三")], { maxPage: 1 })],
        depts: { "": deptResponse({ userList: [person("u1", "张三")] }) }
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 1);
    assert.strictEqual(runtime.notifications[0].subtitle, "新增 0 / 减少 1");
    assert.ok(runtime.notifications[0].body.includes("李四"));
});

test("部门接口返回 8888：通知 Cookie 失效，中止且不重试、不写快照", async () => {
    const previousSnapshot = snapshotV2({ u1: "张三" });
    const runtime = createRuntime({
        snapshot: previousSnapshot,
        pages: [pageResponse([person("u1", "张三"), person("u2", "李四")], { maxPage: 1 })],
        depts: { "": deptError("8888", "页面已过期") }
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.deptRequests.length, 1, "8888 是会话失效，不应重试");
    assert.strictEqual(runtime.notifications.length, 1);
    assert.strictEqual(runtime.notifications[0].subtitle, "Cookie 失效");
    assert.strictEqual(runtime.store["Do1ContactSnapshot"], previousSnapshot, "不应更新快照");
    assert.strictEqual(runtime.doneCount, 1);
});

test("人员接口返回 8888：通知 Cookie 失效，中止且不重试、不写快照", async () => {
    const previousSnapshot = snapshotV2({ u1: "张三" });
    const runtime = createRuntime({
        snapshot: previousSnapshot,
        pages: [{ statusCode: 200, body: JSON.stringify({ code: "8888", desc: "页面已过期" }) }]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.personRequests.length, 1, "8888 是会话失效，不应重试");
    assert.strictEqual(runtime.deptRequests.length, 0, "人员接口已失效，无需再请求部门");
    assert.strictEqual(runtime.notifications.length, 1);
    assert.strictEqual(runtime.notifications[0].subtitle, "Cookie 失效");
    assert.strictEqual(runtime.store["Do1ContactSnapshot"], previousSnapshot, "不应更新快照");
    assert.strictEqual(runtime.doneCount, 1);
});

test("部门 userList 空但 totalRows>0：判为异常，中止本轮不写快照不发通知", async () => {
    const previousSnapshot = snapshotV2({ u1: "张三" });
    const runtime = createRuntime({
        snapshot: previousSnapshot,
        pages: [pageResponse([person("u1", "张三"), person("u2", "李四")], { maxPage: 1 })],
        depts: { "": deptResponse({ userList: [], totalRows: 1 }) } // 异常：声称有 1 人却返回空
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.deptRequests.length, 1, "完整性异常不重试");
    assert.strictEqual(runtime.notifications.length, 0);
    assert.strictEqual(runtime.store["Do1ContactSnapshot"], previousSnapshot);
    assert.strictEqual(runtime.doneCount, 1);
});

test("部门树含子部门：递归收集归属成员", async () => {
    const runtime = createRuntime({
        snapshot: null,
        pages: [pageResponse([person("u1", "张三"), person("u2", "李四")], { maxPage: 1 })],
        depts: {
            "": deptResponse({
                deptlist: [{ id: "d1", departmentName: "研发部" }],
                userList: [person("u1", "张三")]
            }),
            d1: deptResponse({ userList: [person("u2", "李四")] })
        }
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.deptRequests.length, 2, "应同时请求根部门与子部门");
    assert.ok(runtime.deptRequests[1].body.includes("deptId=d1"));
    assert.deepStrictEqual(runtime.readSnapshot(), { u1: "张三", u2: "李四" });
});

test("部门返回 maxPage>1：翻页不支持时安全中止，不写快照、不发通知", async () => {
    const previousSnapshot = snapshotV2({ u1: "张三" });
    const runtime = createRuntime({
        snapshot: previousSnapshot,
        pages: [pageResponse([person("u1", "张三"), person("u2", "李四")], { maxPage: 1 })],
        depts: {
            "": deptResponse({ userList: [person("u1", "张三")], maxPage: 2, totalRows: 40 })
        }
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.deptRequests.length, 1, "完整性异常不重试");
    assert.strictEqual(runtime.notifications.length, 0);
    assert.strictEqual(runtime.store["Do1ContactSnapshot"], previousSnapshot);
    assert.strictEqual(runtime.doneCount, 1);
});

// ---------- 快照迁移 用例 ----------

test("旧格式快照（无 v=2）：按首次运行重建，不发通知", async () => {
    const runtime = createRuntime({
        // 旧格式：裸 { userId: personName }，无版本标记
        snapshot: JSON.stringify({ u1: "张三" }),
        pages: [pageResponse([person("u1", "张三"), person("u2", "李四")], { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 0, "旧快照迁移不应发变动通知");
    assert.deepStrictEqual(runtime.readSnapshot(), { u1: "张三", u2: "李四" }, "应重建为当前监测集");
    assert.strictEqual(JSON.parse(runtime.readRawSnapshot()).v, 2, "重写后的快照应带版本标记");
});

runAll();
