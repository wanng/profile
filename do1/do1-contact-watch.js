/*********************
 * 道一云人员变动监测
 *
 * 定时拉取全公司人员名单，与上一份快照按 userId 比对，
 * 检出新增（入职）/ 消失（离职）并推送通知；无变动则静默。
 ********************/

// ====================
// 配置
// ====================
class AppConfig {
    static API_HOST = "https://qy.do1.com.cn";

    static ENDPOINT = "/wxqyh/portal/selectUserAction/ajaxGetUserListByOrgID.do";

    static STORAGE = Object.freeze({
        cookie: {
            key: "CookieDo1",
            validator: c => typeof c === "string" && c.includes("sessionToken")
        },
        snapshot: "Do1ContactSnapshot"
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

    // 通知正文中每个分类最多列出的姓名数，超出部分截断并追加"等"
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
// 基础设施
// ====================
class HttpClient {
    constructor(cookie) {
        this.cookie = cookie;
    }

    async fetchPage(page) {
        return $task.fetch({
            url: AppConfig.API_HOST + AppConfig.ENDPOINT,
            method: "POST",
            headers: {
                ...AppConfig.API.headers,
                Cookie: this.cookie
            },
            body: `agentCode=ask&page=${page}`
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

            // 先完整拉取成功，才允许写入快照，避免把拉取不完整误判为人员离职
            const current = await this.fetchAll(cookie);

            const previous = this.loadSnapshot();
            if (previous === null) {
                this.saveSnapshot(current);
                console.log(`[BASELINE] 首次运行，建立基准快照，共 ${Object.keys(current).length} 人`);
                return;
            }

            const { added, removed } = ContactWatch.diff(previous, current);
            console.log(`[DIFF] 新增 ${added.length} 人，减少 ${removed.length} 人`);

            if (added.length > 0 || removed.length > 0) {
                $notify(
                    "道一云人员变动",
                    `新增 ${added.length} / 减少 ${removed.length}`,
                    this.buildBody(added, removed)
                );
            }

            this.saveSnapshot(current);
        } catch (error) {
            // 拉取失败/未捕获异常：不更新快照、不发变动通知，仅记录日志
            console.error(`[ERROR] ${error && error.stack ? error.stack : error}`);
        } finally {
            $done();
        }
    }

    // 逐页拉取全部人员，构建 { userId: personName } 映射，跨页按 userId 去重
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

            if (payload.code !== "0") {
                throw new Error(payload.desc || "接口返回失败");
            }

            const data = payload.data || {};
            const list = Array.isArray(data.pageData) ? data.pageData : [];
            list.forEach(person => {
                if (person && person.userId) {
                    members[person.userId] = person.personName;
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

    loadSnapshot() {
        const raw = StorageService.get(AppConfig.STORAGE.snapshot);
        if (!raw) {
            return null;
        }
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch (error) {
            console.log(`[SNAPSHOT] 快照解析失败，按首次运行处理: ${error.message}`);
            return null;
        }
    }

    saveSnapshot(members) {
        StorageService.set(AppConfig.STORAGE.snapshot, JSON.stringify(members));
    }

    // 按 userId 集合比对，返回新增/消失人员的姓名数组
    static diff(previous, current) {
        const added = Object.keys(current)
            .filter(userId => !(userId in previous))
            .map(userId => current[userId]);
        const removed = Object.keys(previous)
            .filter(userId => !(userId in current))
            .map(userId => previous[userId]);
        return { added, removed };
    }

    buildBody(added, removed) {
        const lines = [];
        if (added.length > 0) {
            lines.push(`新增：${ContactWatch.formatNames(added)}`);
        }
        if (removed.length > 0) {
            lines.push(`减少：${ContactWatch.formatNames(removed)}`);
        }
        return lines.join("\n");
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
