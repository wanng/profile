/*********************
 * 道一云人员变动监测
 *
 * 定时拉取全公司人员名单与部门归属，以手机号为主键与上一份快照比对，
 * 检出新增（入职）/ 消失（离职）并推送通知；无变动则静默。
 * 检出的变动同时追加到持久化记录，供事后查阅。
 * 不属于任何部门的账号（虚拟号）被排除在监测之外。
 ********************/

// ====================
// 配置
// ====================
class AppConfig {
    static API_HOST = "https://qy.do1.com.cn";

    // 人员名单接口
    static ENDPOINT = "/wxqyh/portal/selectUserAction/ajaxGetUserListByOrgID.do";

    // 部门树与成员接口
    static DEPT_ENDPOINT = "/wxqyh/portal/departmentAction/getChildDeptAndPerson.do";

    // 快照格式版本；升级后旧格式快照按首次运行处理
    static SNAPSHOT_VERSION = 3;

    // 变动记录格式版本；版本不符时视为空记录重建
    static CHANGELOG_VERSION = 1;

    static STORAGE = Object.freeze({
        cookie: {
            key: "CookieDo1",
            validator: c => typeof c === "string" && c.includes("sessionToken")
        },
        snapshot: "Do1ContactSnapshot",
        changelog: "Do1ContactChangelog"
    });

    static API = Object.freeze({
        headers: Object.freeze({
            Host: "qy.do1.com.cn",
            Origin: "https://qy.do1.com.cn",
            Referer: "https://qy.do1.com.cn/wxqyh/vp/module/leaveapply.html?corp_id=wx53631950e42e0440&agentCode=ask",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.73(0x18004939) NetType/WIFI Language/zh_CN"
        })
    });

    // 接口返回该 code 表示 Cookie 会话已失效（desc 为「页面已过期」），属确定性失败，不重试
    static SESSION_EXPIRED_CODE = "8888";

    // 通知正文中每个分类最多列出的人员条数，超出部分截断并追加"等"
    static NAME_DISPLAY_LIMIT = 20;
}

// ====================
// 存储
// ====================
class StorageService {
    static get(key) {
        return $prefs.valueForKey(key);
    }

    static set(key, value) {
        $prefs.setValueForKey(value, key);
    }
}

// ====================
// 错误类型
// ====================
// 接口返回 code:"8888"（页面已过期）= Cookie 会话失效，需要单独通知并中止
class CookieExpiredError extends Error {}

// ====================
// 基础设施
// ====================
class HttpClient {
    constructor(cookie) {
        this.cookie = cookie;
    }

    fetchPage(page) {
        return this.postJson(AppConfig.ENDPOINT, `agentCode=ask&page=${page}`);
    }

    fetchDept(deptId) {
        return this.postJson(AppConfig.DEPT_ENDPOINT, `agentCode=ask&sortTop=1&deptId=${encodeURIComponent(deptId)}`);
    }

    postJson(endpoint, body) {
        return $task.fetch({
            url: AppConfig.API_HOST + endpoint,
            method: "POST",
            headers: {
                ...AppConfig.API.headers,
                Cookie: this.cookie
            },
            body
        });
    }
}

// ====================
// 核心逻辑
// ====================
class ContactWatch {
    constructor(httpClient) {
        this.httpClient = httpClient;
    }

    async run() {
        try {
            const cookie = StorageService.get(AppConfig.STORAGE.cookie.key);
            if (!AppConfig.STORAGE.cookie.validator(cookie)) {
                console.log("[CHECK] Cookie 缺失或不含 sessionToken，终止本轮");
                $notify("道一云人员变动", "Cookie 无效", "请重新登录道一云以更新 Cookie");
                return;
            }

            // 人员名单与部门归属都成功拉取后，才允许写入快照，
            // 避免把"拉取不完整"误判为人员离职
            const persons = await this.fetchAll(cookie);
            const deptMembers = await this.fetchDeptMembers(cookie);

            // 仅保留归属部门内的账号（无部门归属的虚拟号被排除），
            // 并以身份键（手机号优先）组织当前监测集；快照不存 userId
            const current = {};
            Object.values(persons).forEach(person => {
                if (deptMembers.has(person.userId)) {
                    current[ContactWatch.identityKey(person)] = {
                        personName: person.personName,
                        mobile: person.mobile
                    };
                }
            });
            console.log(`[FILTER] 名单 ${Object.keys(persons).length} 人，其中归属部门 ${Object.keys(current).length} 人`);

            const previous = this.loadSnapshot();
            if (previous === null) {
                this.saveSnapshot(current);
                console.log(`[BASELINE] 首次运行，建立基准快照，共 ${Object.keys(current).length} 人`);
                return;
            }

            const { added, removed } = ContactWatch.diff(previous, current);
            const hasChanges = added.length > 0 || removed.length > 0;
            console.log(`[DIFF] 新增 ${added.length} 人，减少 ${removed.length} 人`);

            if (hasChanges) {
                $notify(
                    "道一云人员变动",
                    `新增 ${added.length} / 减少 ${removed.length}`,
                    this.buildBody(added, removed)
                );
            }

            this.saveSnapshot(current);

            // 变动记录在快照写入成功之后追加：快照写入失败时本轮不留记录，
            // 避免下一轮把同一批变动重复记录
            if (hasChanges) {
                this.appendChangelog(added, removed);
            }
        } catch (error) {
            if (error instanceof CookieExpiredError) {
                // Cookie 会话失效：通知用户重新登录；不更新快照、不发变动通知
                console.log(`[CHECK] Cookie 会话失效: ${error.message}`);
                $notify("道一云人员变动", "Cookie 失效", "登录已过期，请重新登录道一云以更新 Cookie");
            } else {
                // 其它拉取失败/未捕获异常：不更新快照、不发变动通知，仅记录日志
                console.error(`[ERROR] ${error && error.stack ? error.stack : error}`);
            }
        } finally {
            $done();
        }
    }

    // 逐页拉取全部人员，构建 { userId: { userId, personName, mobile } }，跨页按 userId 去重
    async fetchAll(cookie) {
        const client = this.httpClient || new HttpClient(cookie);
        const members = {};
        let page = 1;
        let maxPage = 1;

        do {
            const response = await client.fetchPage(page);
            if (!response || response.statusCode !== 200) {
                throw new Error(`HTTP ${response ? response.statusCode : "无响应"}`);
            }

            let payload;
            try {
                payload = JSON.parse(response.body);
            } catch (error) {
                throw new Error(`响应解析失败: ${error.message}`);
            }

            if (String(payload.code) === AppConfig.SESSION_EXPIRED_CODE) {
                throw new CookieExpiredError(payload.desc || "页面已过期");
            }

            if (payload.code !== "0") {
                throw new Error(payload.desc || "接口返回失败");
            }

            const data = payload.data || {};
            const list = Array.isArray(data.pageData) ? data.pageData : [];
            list.forEach(person => {
                if (person && person.userId) {
                    members[person.userId] = {
                        userId: person.userId,
                        personName: person.personName,
                        mobile: ContactWatch.normalizeMobile(person.mobile)
                    };
                }
            });

            console.log(`[FETCH] 第 ${page} 页，累计 ${Object.keys(members).length} 人`);

            // maxPage 只以首屏响应为准；后续页返回的 maxPage 一律忽略，
            // 避免异常页把总页数改小而提前结束遍历、漏抓人员
            if (page === 1) {
                const reportedMax = Number(data.maxPage);
                maxPage = Number.isFinite(reportedMax) && reportedMax >= 1 ? reportedMax : 1;
            }
            page += 1;
        } while (page <= maxPage);

        return members;
    }

    // 从根部门开始遍历部门树，返回归属成员 userId 集合
    async fetchDeptMembers(cookie) {
        const client = this.httpClient || new HttpClient(cookie);
        const members = new Set();
        const visited = new Set(); // 防止部门树异常成环导致重复遍历
        const queue = [""]; // 根调用 deptId 传空串

        while (queue.length > 0) {
            const deptId = queue.shift();
            if (visited.has(deptId)) {
                continue;
            }
            visited.add(deptId);

            const data = await this.fetchDeptData(client, deptId);
            data.userList.forEach(user => {
                if (user && user.userId) {
                    members.add(user.userId);
                }
            });
            // 响应中的 deptlist 为该部门的子部门，继续入队递归
            data.deptlist.forEach(child => {
                if (child && child.id && !visited.has(child.id)) {
                    queue.push(child.id);
                }
            });
        }

        console.log(`[DEPT] 归属成员共 ${members.size} 人`);
        return members;
    }

    // 单次拉取一个部门；任何失败直接抛出，交由上层终止本轮（不重试）
    async fetchDeptData(client, deptId) {
        const response = await client.fetchDept(deptId);
        if (!response || response.statusCode !== 200) {
            throw new Error(`HTTP ${response ? response.statusCode : "无响应"}`);
        }

        let payload;
        try {
            payload = JSON.parse(response.body);
        } catch (error) {
            throw new Error(`响应解析失败: ${error.message}`);
        }

        if (String(payload.code) === AppConfig.SESSION_EXPIRED_CODE) {
            throw new CookieExpiredError(payload.desc || "页面已过期");
        }

        if (payload.code !== "0") {
            throw new Error(payload.desc || `业务失败 code=${payload.code}`);
        }

        const data = payload.data || {};
        const userList = Array.isArray(data.userList) ? data.userList : [];
        const deptlist = Array.isArray(data.deptlist) ? data.deptlist : [];
        const totalRows = Number(data.totalRows);
        const maxPage = Number(data.maxPage);

        // 完整性防御：列表为空却声称有数据，说明响应不完整，
        // 不得据此判定该部门无人（否则在职成员会被误判为虚拟号）
        if (userList.length === 0 && Number.isFinite(totalRows) && totalRows > 0) {
            throw new Error(`部门 ${deptId || "(root)"} 返回空成员列表但 totalRows=${data.totalRows}`);
        }
        // 该接口的翻页能力未经验证；出现多页时安全中止，避免漏抓成员被误判为离职
        if (Number.isFinite(maxPage) && maxPage > 1) {
            throw new Error(`部门 ${deptId || "(root)"} 返回 maxPage=${data.maxPage}，不支持翻页，安全中止`);
        }

        return { userList, deptlist };
    }

    // 读取当前监测集；无快照、解析失败或版本号非当前值时返回 null，按首次运行处理
    loadSnapshot() {
        const raw = StorageService.get(AppConfig.STORAGE.snapshot);
        if (!raw) {
            return null;
        }

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            console.log(`[SNAPSHOT] 快照解析失败，按首次运行处理: ${error.message}`);
            return null;
        }

        if (!parsed || typeof parsed !== "object" || parsed.v !== AppConfig.SNAPSHOT_VERSION ||
            !parsed.members || typeof parsed.members !== "object") {
            // 版本号非当前值（含无版本标记的裸对象、旧的 v2）：忽略它并重建，
            // 避免升级后误报一次性"离职"
            console.log("[SNAPSHOT] 快照格式过旧或无效，按首次运行处理");
            return null;
        }

        return parsed.members;
    }

    saveSnapshot(members) {
        StorageService.set(
            AppConfig.STORAGE.snapshot,
            JSON.stringify({ v: AppConfig.SNAPSHOT_VERSION, members })
        );
    }

    // 读取变动记录；缺失、解析失败、版本号非当前值或结构非法时返回空数组，从空开始追加
    loadChangelog() {
        const raw = StorageService.get(AppConfig.STORAGE.changelog);
        if (!raw) {
            return [];
        }

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            console.log(`[CHANGELOG] 变动记录解析失败，从空重建: ${error.message}`);
            return [];
        }

        if (!parsed || typeof parsed !== "object" || parsed.v !== AppConfig.CHANGELOG_VERSION ||
            !Array.isArray(parsed.entries)) {
            console.log("[CHANGELOG] 变动记录格式无效，从空重建");
            return [];
        }

        return parsed.entries;
    }

    // 把本轮变动作为一条记录追加到持久化记录；记录为完整明细，不参与比对与通知渲染。
    // 写入失败只记录日志，不影响本轮快照更新与 $done 正常结束
    appendChangelog(added, removed) {
        try {
            const entries = this.loadChangelog();
            entries.push({
                time: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }),
                added: added.map(ContactWatch.toRecord),
                removed: removed.map(ContactWatch.toRecord)
            });
            StorageService.set(
                AppConfig.STORAGE.changelog,
                JSON.stringify({ v: AppConfig.CHANGELOG_VERSION, entries })
            );
        } catch (error) {
            console.error(`[CHANGELOG] 变动记录写入失败: ${error && error.stack ? error.stack : error}`);
        }
    }

    // 以手机号为身份主键；手机号缺失时回退 userId，避免无法识别
    static identityKey(person) {
        return person.mobile ? `m:${person.mobile}` : `u:${person.userId}`;
    }

    static normalizeMobile(mobile) {
        if (mobile === null || mobile === undefined) {
            return "";
        }
        return String(mobile).trim();
    }

    // 变动记录中的明细条目：仅保留姓名与手机号
    static toRecord(person) {
        return { personName: person.personName, mobile: person.mobile };
    }

    // 按身份键求集合差：新增 = 当前有、上次无；消失 = 上次有、当前无
    static diff(previous, current) {
        const added = Object.keys(current)
            .filter(key => !(key in previous))
            .map(key => current[key]);
        const removed = Object.keys(previous)
            .filter(key => !(key in current))
            .map(key => previous[key]);
        return { added, removed };
    }

    buildBody(added, removed) {
        const lines = [];
        if (added.length > 0) {
            lines.push(`新增：${ContactWatch.formatNames(added.map(ContactWatch.describePerson))}`);
        }
        if (removed.length > 0) {
            lines.push(`减少：${ContactWatch.formatNames(removed.map(ContactWatch.describePerson))}`);
        }
        return lines.join("\n");
    }

    // 通知中的展示文案：姓名 + 手机号（无手机号时只显示姓名）
    static describePerson(person) {
        return person.mobile ? `${person.personName} ${person.mobile}` : `${person.personName}`;
    }

    static formatNames(names) {
        const limit = AppConfig.NAME_DISPLAY_LIMIT;
        if (names.length <= limit) {
            return names.join("、");
        }
        return names.slice(0, limit).join("、") + ` 等 ${names.length} 人`;
    }
}

// ====================
// 入口：QX 运行时直接执行，Node 下导出供测试驱动
// ====================
if (typeof module !== "undefined" && module.exports) {
    module.exports = { AppConfig, StorageService, HttpClient, ContactWatch };
} else {
    new ContactWatch().run();
}
