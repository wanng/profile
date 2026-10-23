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

function person(userId, personName, mobile) {
    return { userId, personName, mobile, userStatus: "2" };
}

// 快照 members 中的一条人员记录（不含 userId）
function rec(personName, mobile = "") {
    return { personName, mobile };
}

// 身份键：手机号非空用 m:，否则回退 u:
function keyOf(userId, mobile = "") {
    return mobile ? `m:${mobile}` : `u:${userId}`;
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

// 构造部门接口的业务失败响应（如 8888 页面已过期）
function deptError(code = "8888", desc = "页面已过期") {
    return { statusCode: 200, body: JSON.stringify({ code, desc }) };
}

// 当前格式（v3）快照原始字符串
function snapshotV3(members) {
    return JSON.stringify({ v: 3, members });
}

// 变动记录（v1）原始字符串
function changelogV1(entries) {
    return JSON.stringify({ v: 1, entries });
}

// 旧格式（v2）快照原始字符串，用于迁移用例
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
 * @param {string|null} opts.changelog   Do1ContactChangelog 的值，null/undefined 表示无记录
 * @param {object|null} opts.store       复用同一份存储的引用（用于连续多轮），null 表示新建
 * @param {Array} opts.pages             人员接口按页序号（1 起）给出响应：对象或 (options)=>响应
 * @param {object|null} opts.depts       部门接口按 deptId 给出响应（根 deptId 为 ""）：对象或 (options)=>响应
 * @param {Array<string>} opts.failSetKeys  写入这些键时抛异常，用于模拟存储故障
 * @returns 可用于断言的句柄
 */
function createRuntime({ cookie = "sessionToken=test-token", snapshot = null, changelog = null, store = null, pages = [], depts = null, failSetKeys = [] } = {}) {
    const storeRef = store || {};
    if (cookie !== null) storeRef["CookieDo1"] = cookie;
    if (snapshot !== null && snapshot !== undefined) storeRef["Do1ContactSnapshot"] = snapshot;
    if (changelog !== null && changelog !== undefined) storeRef["Do1ContactChangelog"] = changelog;
    const failKeys = new Set(failSetKeys);

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
        valueForKey: key => (key in storeRef ? storeRef[key] : null),
        setValueForKey: (value, key) => {
            if (failKeys.has(key)) {
                throw new Error(`测试注入写入失败: ${key}`);
            }
            storeRef[key] = value;
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
        store: storeRef,
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
            const raw = storeRef["Do1ContactSnapshot"];
            if (raw === undefined) return null;
            return JSON.parse(raw).members;
        },
        readRawSnapshot() {
            return storeRef["Do1ContactSnapshot"];
        },
        // 返回变动记录的 entries（无记录时为 null）
        readChangelog() {
            const raw = storeRef["Do1ContactChangelog"];
            if (raw === undefined) return null;
            return JSON.parse(raw).entries;
        },
        readRawChangelog() {
            return storeRef["Do1ContactChangelog"];
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

// ---------- 基础用例 ----------

test("首次运行：仅建立基准快照，不发通知", async () => {
    const runtime = createRuntime({
        snapshot: null,
        pages: [pageResponse([
            person("u1", "张三", "13800000001"),
            person("u2", "李四", "13800000002")
        ], { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 0, "首次运行不应发通知");
    assert.deepStrictEqual(runtime.readSnapshot(), {
        "m:13800000001": rec("张三", "13800000001"),
        "m:13800000002": rec("李四", "13800000002")
    });
    assert.strictEqual(runtime.doneCount, 1, "必须调用 $done 一次");
    assert.strictEqual(JSON.parse(runtime.readRawSnapshot()).v, 3, "快照应带 v3 版本标记");
});

test("新增：检出当前有、上次无的人员并通知（正文含姓名 手机号）", async () => {
    const runtime = createRuntime({
        snapshot: snapshotV3({
            "m:13800000001": rec("张三", "13800000001")
        }),
        pages: [pageResponse([
            person("u1", "张三", "13800000001"),
            person("u2", "李四", "13800000002")
        ], { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 1);
    assert.strictEqual(runtime.notifications[0].title, "道一云人员变动");
    assert.strictEqual(runtime.notifications[0].subtitle, "新增 1 / 减少 0");
    assert.ok(runtime.notifications[0].body.includes("李四 13800000002"), "正文应含「姓名 手机号」");
    assert.deepStrictEqual(runtime.readSnapshot(), {
        "m:13800000001": rec("张三", "13800000001"),
        "m:13800000002": rec("李四", "13800000002")
    });
});

test("消失：检出上次有、当前无的人员并通知", async () => {
    const runtime = createRuntime({
        snapshot: snapshotV3({
            "m:13800000001": rec("张三", "13800000001"),
            "m:13800000002": rec("李四", "13800000002")
        }),
        pages: [pageResponse([person("u1", "张三", "13800000001")], { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 1);
    assert.strictEqual(runtime.notifications[0].subtitle, "新增 0 / 减少 1");
    assert.ok(runtime.notifications[0].body.includes("李四 13800000002"), "正文应含「姓名 手机号」");
    assert.deepStrictEqual(runtime.readSnapshot(), {
        "m:13800000001": rec("张三", "13800000001")
    });
});

test("无变动：静默，但快照仍刷新", async () => {
    const runtime = createRuntime({
        snapshot: snapshotV3({
            "m:13800000001": rec("张三", "13800000001"),
            "m:13800000002": rec("李四", "13800000002")
        }),
        pages: [pageResponse([
            person("u1", "张三", "13800000001"),
            person("u2", "李四", "13800000002")
        ], { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 0, "无变动应静默");
    assert.deepStrictEqual(runtime.readSnapshot(), {
        "m:13800000001": rec("张三", "13800000001"),
        "m:13800000002": rec("李四", "13800000002")
    });
});

test("多页聚合：按 userId 去重并逐页拉取", async () => {
    const runtime = createRuntime({
        snapshot: null,
        pages: [
            pageResponse([
                person("u1", "张三", "13800000001"),
                person("u2", "李四", "13800000002")
            ], { maxPage: 2, currPage: 1 }),
            // 第二页含跨页重复的 u2，应被去重
            pageResponse([
                person("u2", "李四", "13800000002"),
                person("u3", "王五", "13800000003")
            ], { maxPage: 2, currPage: 2 })
        ]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.personRequests.length, 2, "应逐页拉取两页");
    assert.ok(runtime.personRequests[0].body.includes("page=1"));
    assert.ok(runtime.personRequests[1].body.includes("page=2"));
    assert.deepStrictEqual(runtime.readSnapshot(), {
        "m:13800000001": rec("张三", "13800000001"),
        "m:13800000002": rec("李四", "13800000002"),
        "m:13800000003": rec("王五", "13800000003")
    });
});

test("总页数以首屏为准：后续页返回偏小的 maxPage 不得提前收尾", async () => {
    const runtime = createRuntime({
        snapshot: null,
        pages: [
            // 首屏声明共 3 页
            pageResponse([person("u1", "张三", "13800000001")], { maxPage: 3, currPage: 1 }),
            // 第二页异常地返回 maxPage=1，不得因此把总页数改小
            pageResponse([person("u2", "李四", "13800000002")], { maxPage: 1, currPage: 2 }),
            pageResponse([person("u3", "王五", "13800000003")], { maxPage: 3, currPage: 3 })
        ]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.personRequests.length, 3, "应按首屏 maxPage 拉满 3 页");
    assert.ok(runtime.personRequests[2].body.includes("page=3"), "第三页必须被请求");
    assert.deepStrictEqual(runtime.readSnapshot(), {
        "m:13800000001": rec("张三", "13800000001"),
        "m:13800000002": rec("李四", "13800000002"),
        "m:13800000003": rec("王五", "13800000003")
    });
});

test("分页失败：HTTP 非 200 时中止，不更新快照、不发通知", async () => {
    const previousSnapshot = snapshotV3({ "m:13800000001": rec("张三", "13800000001") });
    const runtime = createRuntime({
        snapshot: previousSnapshot,
        pages: [
            pageResponse([
                person("u1", "张三", "13800000001"),
                person("u2", "李四", "13800000002")
            ], { maxPage: 2, currPage: 1 }),
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
    const previousSnapshot = snapshotV3({ "m:13800000001": rec("张三", "13800000001") });
    const runtime = createRuntime({
        snapshot: previousSnapshot,
        pages: [
            pageResponse([person("u1", "张三", "13800000001")], { maxPage: 2, currPage: 1 }),
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
    const previousSnapshot = snapshotV3({ "m:13800000001": rec("张三", "13800000001") });
    const runtime = createRuntime({
        snapshot: previousSnapshot,
        pages: [
            pageResponse([person("u1", "张三", "13800000001")], { maxPage: 2, currPage: 1 }),
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
        pages: [pageResponse([person("u1", "张三", "13800000001")], { maxPage: 1 })]
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
        current.push(person(`u${i}`, `员工${i}`, `138000000${String(i).padStart(2, "0")}`));
    }
    const runtime = createRuntime({
        snapshot: snapshotV3({}),
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
        pages: [pageResponse([person("u1", "张三", "13800000001")], { maxPage: 1 })]
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
        snapshot: snapshotV3({ "m:13800000001": rec("张三", "13800000001") }),
        // 名单里有虚拟号 v1（中化小泽），但它不在任何部门
        pages: [pageResponse([
            person("u1", "张三", "13800000001"),
            person("v1", "中化小泽", "13800000000")
        ], { maxPage: 1 })],
        depts: { "": deptResponse({ userList: [person("u1", "张三", "13800000001")] }) }
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 0, "虚拟号出现不应触发变动通知");
    assert.deepStrictEqual(runtime.readSnapshot(),
        { "m:13800000001": rec("张三", "13800000001") },
        "虚拟号不应进入快照");
});

test("有部门归属账号的新增仍正确报告", async () => {
    const runtime = createRuntime({
        snapshot: snapshotV3({ "m:13800000001": rec("张三", "13800000001") }),
        pages: [pageResponse([
            person("u1", "张三", "13800000001"),
            person("u2", "李四", "13800000002")
        ], { maxPage: 1 })],
        depts: { "": deptResponse({ userList: [person("u1", "张三"), person("u2", "李四")] }) }
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 1);
    assert.strictEqual(runtime.notifications[0].subtitle, "新增 1 / 减少 0");
    assert.ok(runtime.notifications[0].body.includes("李四 13800000002"));
});

test("有部门归属账号的消失仍正确报告", async () => {
    const runtime = createRuntime({
        snapshot: snapshotV3({
            "m:13800000001": rec("张三", "13800000001"),
            "m:13800000002": rec("李四", "13800000002")
        }),
        pages: [pageResponse([person("u1", "张三", "13800000001")], { maxPage: 1 })],
        depts: { "": deptResponse({ userList: [person("u1", "张三")] }) }
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 1);
    assert.strictEqual(runtime.notifications[0].subtitle, "新增 0 / 减少 1");
    assert.ok(runtime.notifications[0].body.includes("李四 13800000002"));
});

test("部门接口返回 8888：通知 Cookie 失效，中止且不重试、不写快照", async () => {
    const previousSnapshot = snapshotV3({ "m:13800000001": rec("张三", "13800000001") });
    const runtime = createRuntime({
        snapshot: previousSnapshot,
        pages: [pageResponse([
            person("u1", "张三", "13800000001"),
            person("u2", "李四", "13800000002")
        ], { maxPage: 1 })],
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
    const previousSnapshot = snapshotV3({ "m:13800000001": rec("张三", "13800000001") });
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
    const previousSnapshot = snapshotV3({ "m:13800000001": rec("张三", "13800000001") });
    const runtime = createRuntime({
        snapshot: previousSnapshot,
        pages: [pageResponse([
            person("u1", "张三", "13800000001"),
            person("u2", "李四", "13800000002")
        ], { maxPage: 1 })],
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
        pages: [pageResponse([
            person("u1", "张三", "13800000001"),
            person("u2", "李四", "13800000002")
        ], { maxPage: 1 })],
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
    assert.deepStrictEqual(runtime.readSnapshot(), {
        "m:13800000001": rec("张三", "13800000001"),
        "m:13800000002": rec("李四", "13800000002")
    });
});

test("部门返回 maxPage>1：翻页不支持时安全中止，不写快照、不发通知", async () => {
    const previousSnapshot = snapshotV3({ "m:13800000001": rec("张三", "13800000001") });
    const runtime = createRuntime({
        snapshot: previousSnapshot,
        pages: [pageResponse([
            person("u1", "张三", "13800000001"),
            person("u2", "李四", "13800000002")
        ], { maxPage: 1 })],
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

// ---------- 身份主键（手机号）用例 ----------

test("手机号相同、userId 变：同一人不报增删", async () => {
    const runtime = createRuntime({
        snapshot: snapshotV3({ "m:13800000001": rec("张三", "13800000001") }),
        pages: [pageResponse([person("new", "张三", "13800000001")], { maxPage: 1 })],
        depts: { "": deptResponse({ userList: [person("new", "张三")] }) }
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 0, "仅 userId 变化不应上报");
    assert.deepStrictEqual(runtime.readSnapshot(),
        { "m:13800000001": rec("张三", "13800000001") },
        "快照按手机号保持同一身份");
});

test("手机号变（同一人）：无抑制，报「减少 1 + 新增 1」", async () => {
    const runtime = createRuntime({
        snapshot: snapshotV3({ "m:13800000001": rec("张三", "13800000001") }),
        pages: [pageResponse([person("u1", "张三", "13900000009")], { maxPage: 1 })],
        depts: { "": deptResponse({ userList: [person("u1", "张三")] }) }
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 1, "手机号变化应报减少+新增");
    assert.strictEqual(runtime.notifications[0].subtitle, "新增 1 / 减少 1");
    assert.ok(runtime.notifications[0].body.includes("张三 13900000009"), "新增应含新手机号");
    assert.ok(runtime.notifications[0].body.includes("张三 13800000001"), "减少应含旧手机号");
    assert.deepStrictEqual(runtime.readSnapshot(),
        { "m:13900000009": rec("张三", "13900000009") },
        "快照应更新为新的手机号键");
});

test("手机号缺失：回退 u:<userId> 作键，比对仍正确", async () => {
    const runtime = createRuntime({
        snapshot: snapshotV3({ "u:u1": rec("张三") }),
        pages: [pageResponse([
            person("u1", "张三"),
            person("u2", "李四")
        ], { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 1);
    assert.strictEqual(runtime.notifications[0].subtitle, "新增 1 / 减少 0");
    assert.ok(runtime.notifications[0].body.includes("李四"), "无手机号时正文只含姓名");
    assert.deepStrictEqual(runtime.readSnapshot(), {
        "u:u1": rec("张三"),
        "u:u2": rec("李四")
    });
});

test("快照成员记录不含 userId 字段", async () => {
    const runtime = createRuntime({
        snapshot: null,
        pages: [pageResponse([person("u1", "张三", "13800000001")], { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    const members = runtime.readSnapshot();
    assert.deepStrictEqual(members, {
        "m:13800000001": { personName: "张三", mobile: "13800000001" }
    });
    Object.values(members).forEach(member => {
        assert.ok(!("userId" in member), "快照成员记录不应含 userId 字段");
    });

    // 无手机号的回退记录同样不含 userId
    const fallbackRuntime = createRuntime({
        snapshot: null,
        pages: [pageResponse([person("u9", "赵六")], { maxPage: 1 })]
    });
    await new ContactWatch().run();
    assert.deepStrictEqual(fallbackRuntime.readSnapshot(), {
        "u:u9": { personName: "赵六", mobile: "" }
    });
    Object.values(fallbackRuntime.readSnapshot()).forEach(member => {
        assert.ok(!("userId" in member), "回退记录的成员对象也不应含 userId");
    });
});

// ---------- 快照迁移 用例 ----------

test("v2 旧快照：按首次运行重建，不发通知", async () => {
    const runtime = createRuntime({
        // 旧 v2 格式：members 为 { key: name }
        snapshot: snapshotV2({ u1: "张三" }),
        pages: [pageResponse([
            person("u1", "张三", "13800000001"),
            person("u2", "李四", "13800000002")
        ], { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 0, "旧快照迁移不应发变动通知");
    assert.deepStrictEqual(runtime.readSnapshot(), {
        "m:13800000001": rec("张三", "13800000001"),
        "m:13800000002": rec("李四", "13800000002")
    }, "应重建为当前监测集");
    assert.strictEqual(JSON.parse(runtime.readRawSnapshot()).v, 3, "重写后的快照应为 v3");
});

// ---------- 变动记录持久化 用例 ----------

test("检出变动：追加完整明细记录，不受通知截断影响", async () => {
    // 构造超过 NAME_DISPLAY_LIMIT(20) 的增/减规模：通知正文会被截断，记录必须完整
    const previousMembers = {};
    const currentPersons = [];
    for (let i = 0; i < 25; i++) {
        const oldMobile = `13800000${String(i).padStart(3, "0")}`;
        previousMembers[`m:${oldMobile}`] = rec(`离职${i}`, oldMobile);
        const newMobile = `13900000${String(i).padStart(3, "0")}`;
        currentPersons.push(person(`new${i}`, `入职${i}`, newMobile));
    }

    const runtime = createRuntime({
        snapshot: snapshotV3(previousMembers),
        pages: [pageResponse(currentPersons, { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    // 通知正常发出且正文被截断
    assert.strictEqual(runtime.notifications.length, 1);
    assert.strictEqual(runtime.notifications[0].subtitle, "新增 25 / 减少 25");
    assert.ok(runtime.notifications[0].body.includes("等"), "通知正文应截断并追加等");

    const raw = JSON.parse(runtime.readRawChangelog());
    assert.strictEqual(raw.v, 1, "记录应带 v1 版本标记");
    const entries = raw.entries;
    assert.strictEqual(entries.length, 1, "检出变动应追加一条记录");
    assert.strictEqual(typeof entries[0].time, "string", "time 应为字符串");
    assert.ok(entries[0].time.length > 0, "time 应为非空字符串");
    assert.strictEqual(entries[0].added.length, 25, "记录内新增应为全量，不受截断影响");
    assert.strictEqual(entries[0].removed.length, 25, "记录内减少应为全量，不受截断影响");
    assert.deepStrictEqual(entries[0].added[0], rec("入职0", "13900000000"));
    assert.deepStrictEqual(entries[0].removed[0], rec("离职0", "13800000000"));
});

test("无变动：不写变动记录", async () => {
    const runtime = createRuntime({
        snapshot: snapshotV3({
            "m:13800000001": rec("张三", "13800000001"),
            "m:13800000002": rec("李四", "13800000002")
        }),
        pages: [pageResponse([
            person("u1", "张三", "13800000001"),
            person("u2", "李四", "13800000002")
        ], { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 0);
    assert.strictEqual(runtime.store["Do1ContactChangelog"], undefined, "无变动不应写记录");
});

test("首次运行建基准：不写变动记录", async () => {
    const runtime = createRuntime({
        snapshot: null,
        pages: [pageResponse([
            person("u1", "张三", "13800000001"),
            person("u2", "李四", "13800000002")
        ], { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 0);
    assert.strictEqual(runtime.store["Do1ContactChangelog"], undefined, "首次建基准不应写记录");
});

test("Cookie 失效（8888）：不写记录，且已有记录保持不变", async () => {
    const existing = changelogV1([
        { time: "2026-10-05 09:00:00", added: [rec("旧人", "13700000000")], removed: [] }
    ]);
    const runtime = createRuntime({
        snapshot: snapshotV3({ "m:13800000001": rec("张三", "13800000001") }),
        changelog: existing,
        pages: [pageResponse([
            person("u1", "张三", "13800000001"),
            person("u2", "李四", "13800000002")
        ], { maxPage: 1 })],
        depts: { "": deptError("8888", "页面已过期") }
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications[0].subtitle, "Cookie 失效");
    assert.strictEqual(runtime.store["Do1ContactChangelog"], existing, "已有记录不应被破坏");
});

test("拉取失败：不写记录，且已有记录保持不变", async () => {
    const existing = changelogV1([
        { time: "2026-10-05 09:00:00", added: [rec("旧人", "13700000000")], removed: [] }
    ]);
    const runtime = createRuntime({
        snapshot: snapshotV3({ "m:13800000001": rec("张三", "13800000001") }),
        changelog: existing,
        pages: [
            pageResponse([
                person("u1", "张三", "13800000001"),
                person("u2", "李四", "13800000002")
            ], { maxPage: 2, currPage: 1 }),
            { statusCode: 500, body: "server error" }
        ]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 0, "拉取失败不应发通知");
    assert.strictEqual(runtime.store["Do1ContactChangelog"], existing, "已有记录不应被破坏");
});

test("连续两轮各检出一次变动：记录累积且顺序正确", async () => {
    const store = {};
    const { ContactWatch } = freshRequire();

    // 第一轮：张三 -> 新增李四
    const round1 = createRuntime({
        store,
        snapshot: snapshotV3({ "m:13800000001": rec("张三", "13800000001") }),
        pages: [pageResponse([
            person("u1", "张三", "13800000001"),
            person("u2", "李四", "13800000002")
        ], { maxPage: 1 })]
    });
    await new ContactWatch().run();

    // 第二轮：再新增王五（不覆盖已落盘的快照与记录）
    const round2 = createRuntime({
        store,
        snapshot: null,
        changelog: null,
        pages: [pageResponse([
            person("u1", "张三", "13800000001"),
            person("u2", "李四", "13800000002"),
            person("u3", "王五", "13800000003")
        ], { maxPage: 1 })]
    });
    await new ContactWatch().run();

    const entries = round2.readChangelog();
    assert.strictEqual(entries.length, 2, "两轮变动应累积为两条记录");
    assert.strictEqual(entries[0].added[0].personName, "李四", "第一条记录仍在且对应第一轮");
    assert.strictEqual(entries[1].added[0].personName, "王五", "第二条记录对应第二轮");
    assert.strictEqual(round1.readChangelog().length, 2, "同一份存储被持续追加");
});

test("变动记录非法 JSON：从空重建，不抛错", async () => {
    const runtime = createRuntime({
        snapshot: snapshotV3({ "m:13800000001": rec("张三", "13800000001") }),
        changelog: "{not valid json",
        pages: [pageResponse([
            person("u1", "张三", "13800000001"),
            person("u2", "李四", "13800000002")
        ], { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.doneCount, 1, "解析失败不应抛错，仍正常结束");
    const entries = runtime.readChangelog();
    assert.strictEqual(entries.length, 1, "应从空重建后追加本轮记录");
    assert.strictEqual(entries[0].added[0].personName, "李四");
});

test("变动记录版本号非 1：从空重建，不抛错", async () => {
    const runtime = createRuntime({
        snapshot: snapshotV3({ "m:13800000001": rec("张三", "13800000001") }),
        changelog: changelogV1([{ time: "2026-01-01 00:00:00", added: [rec("旧人", "13700000000")], removed: [] }])
            .replace('"v":1', '"v":2'),
        pages: [pageResponse([
            person("u1", "张三", "13800000001"),
            person("u2", "李四", "13800000002")
        ], { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.doneCount, 1, "版本不符不应抛错，仍正常结束");
    const entries = runtime.readChangelog();
    assert.strictEqual(entries.length, 1, "应从空重建，丢弃旧版本记录");
    assert.strictEqual(entries[0].added[0].personName, "李四");
});

test("变动记录结构非法：从空重建，不抛错", async () => {
    const runtime = createRuntime({
        snapshot: snapshotV3({ "m:13800000001": rec("张三", "13800000001") }),
        changelog: JSON.stringify({ v: 1, entries: "not-an-array" }),
        pages: [pageResponse([
            person("u1", "张三", "13800000001"),
            person("u2", "李四", "13800000002")
        ], { maxPage: 1 })]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.doneCount, 1, "结构非法不应抛错，仍正常结束");
    const entries = runtime.readChangelog();
    assert.strictEqual(entries.length, 1, "应从空重建后追加本轮记录");
});

test("追加记录写入异常：通知与快照仍正常，$done 正常结束", async () => {
    const runtime = createRuntime({
        snapshot: snapshotV3({ "m:13800000001": rec("张三", "13800000001") }),
        pages: [pageResponse([
            person("u1", "张三", "13800000001"),
            person("u2", "李四", "13800000002")
        ], { maxPage: 1 })],
        failSetKeys: ["Do1ContactChangelog"]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 1, "通知应照常发出");
    assert.deepStrictEqual(runtime.readSnapshot(), {
        "m:13800000001": rec("张三", "13800000001"),
        "m:13800000002": rec("李四", "13800000002")
    }, "记录写入失败不应影响本轮快照更新");
    assert.strictEqual(runtime.store["Do1ContactChangelog"], undefined, "写入失败不落盘");
    assert.strictEqual(runtime.doneCount, 1, "$done 应正常结束");
});

test("快照写入异常：不追加记录（追加在快照之后）", async () => {
    const runtime = createRuntime({
        snapshot: snapshotV3({ "m:13800000001": rec("张三", "13800000001") }),
        pages: [pageResponse([
            person("u1", "张三", "13800000001"),
            person("u2", "李四", "13800000002")
        ], { maxPage: 1 })],
        failSetKeys: ["Do1ContactSnapshot"]
    });
    const { ContactWatch } = freshRequire();
    await new ContactWatch().run();

    assert.strictEqual(runtime.notifications.length, 1, "通知已发出");
    assert.strictEqual(runtime.store["Do1ContactChangelog"], undefined,
        "快照写入失败时本轮不留记录，避免下轮重复上报");
    assert.strictEqual(runtime.doneCount, 1);
});

runAll();
