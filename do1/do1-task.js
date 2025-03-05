/*********************
 * 道一云签到优化版（架构优化版）
 * 遵循SOLID原则重构，提升可维护性和扩展性
 ********************/

// ====================
// 抽象与配置
// ====================
class AppConfig {
    static API_HOST = "https://qy.do1.com.cn";
    
    static STORAGE = Object.freeze({
        cookie: {
            key: "CookieDo1",
            validator: c => c?.includes("sessionToken")
        },
        lastSuccess: "LastSuccessTimeDo1",
        probability: "ExecProbabilityDo1"
    });

    static LOCATION = Object.freeze({
        coordinates: [113.940327, 22.526579],
        address: "高新南九道41号"
    });

    static CHECK_RULES = Object.freeze({
        checkIn: {
            id: "AEE21D66-E6E8-4E9E-BB69-B369054CF3D3",
            timeRange: [7.0, 9.5]
        },
        checkOut: {
            id: "8814FC84-EBDE-43C0-9A81-E0A18BD093A3",
            timeRange: [18.5, 24.0]
        }
    });

    static API = Object.freeze({
        endpoints: {
            sign: "/wxqyh/portal/checkWorkSignInCtrl/addsignin.do",
            calendar: "/wxqyh/portal/checkWorkDateCtrl/getOneDateCalendarInfo.do"
        },
        headers: (() => {
            const host = new URL(AppConfig.API_HOST).hostname;
            return Object.freeze({
                Host: host,
                Origin: AppConfig.API_HOST,
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.2(0x1800022c) NetType/4G Language/zh_CN"
            });
        })()
    });
}

// ====================
// 工具层
// ====================
class TimeUtils {
    static get currentHour() {
        const d = new Date();
        return d.getHours() + d.getMinutes() / 60;
    }

    static get today() {
        const pad = n => n.toString().padStart(2, '0');
        const d = new Date();
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    }
}

class StorageService {
    static get(key) {
        return $prefs.valueForKey(key);
    }

    static set(key, value) {
        $prefs.setValueForKey(value, key);
    }

    static checkRecentSuccess() {
        const last = parseInt(this.get(AppConfig.STORAGE.lastSuccess));
        return last && (Date.now() - last) < 3_600_000;
    }
}

// ====================
// 业务逻辑抽象
// ====================
class AttendanceValidator {
    static validateCookie() {
        const cookie = StorageService.get(AppConfig.STORAGE.cookie.key);
        return AppConfig.STORAGE.cookie.validator(cookie);
    }
}

class ProbabilityController {
    static checkExecution(probabilityKey) {
        const currentProb = parseInt(StorageService.get(probabilityKey)) || 10;
        const rand = Math.random() * 100;

        if (rand > currentProb) {
            const newProb = Math.min(currentProb + 10, 100);
            StorageService.set(probabilityKey, newProb.toString());
            return false;
        }
        return true;
    }
}

// ====================
// 核心业务实现
// ====================
class AttendanceService {
    constructor(httpClient = new HttpClient()) {
        this.httpClient = httpClient;
    }

    async execute() {
        try {
            if (!this.preCheck()) return;
            await this.processCheckIn();
        } catch (error) {
            this.handleError(error);
        } finally {
            $done();
        }
    }

    preCheck() {
        if (!AttendanceValidator.validateCookie()) {
            this.notify("Cookie无效");
            return false;
        }
        if (StorageService.checkRecentSuccess()) return false;
        return ProbabilityController.checkExecution(AppConfig.STORAGE.probability);
    }

    async processCheckIn() {
        const checkType = this.determineCheckType();
        if (!checkType) return;

        await this.verifyLeaveStatus();
        const result = await this.submitSign(checkType);
        this.handleResult(result);
    }

    determineCheckType() {
        const currentHour = TimeUtils.currentHour;
        return Object.entries(AppConfig.CHECK_RULES).find(([_, rule]) =>
            currentHour > rule.timeRange[0] && currentHour <= rule.timeRange[1]
        )?.[0];
    }

    async verifyLeaveStatus() {
        const { data } = await this.httpClient.get(
            AppConfig.API.endpoints.calendar,
            { searchDate: TimeUtils.today }
        );
        
        if (data?.conditionVo?.askList?.some(this.isCurrentLeave)) {
            throw new Error("当前处于请假状态");
        }
    }

    async submitSign(type) {
        const rule = AppConfig.CHECK_RULES[type];
        return this.httpClient.post(AppConfig.API.endpoints.sign, {
            ruleId: rule.id,
            ...AppConfig.LOCATION
        });
    }

    handleResult(response) {
        if (!['0', '88'].includes(response.code)) {
            throw new Error(response.desc || "未知错误");
        }

        StorageService.set(AppConfig.STORAGE.lastSuccess, Date.now().toString());
        StorageService.set(AppConfig.STORAGE.probability, "10");
        this.notify(response.code === "0" ? "操作成功" : "重复操作", response.desc);
    }

    handleError(error) {
        console.error(`[ERR] ${error.stack || error}`);
        this.notify("操作失败", error.message.replace("Error: ", ""));
    }

    notify(title, message = "") {
        $notify("道一云", title, message);
    }

    isCurrentLeave(record) {
        const now = Date.now();
        return now >= new Date(record.startTime) && now <= new Date(record.endTime);
    }
}

// ====================
// 基础设施层
// ====================
class HttpClient {
    async get(endpoint, params) {
        return this.request('GET', endpoint, params);
    }

    async post(endpoint, data) {
        return this.request('POST', endpoint, data);
    }

    async request(method, endpoint, data) {
        const url = AppConfig.API_HOST + endpoint;
        const headers = this.buildHeaders();
        
        const response = await $task.fetch({
            url: method === 'GET' ? this.addQueryParams(url, data) : url,
            method,
            headers,
            body: method !== 'GET' ? this.encodeFormData(data) : undefined
        });

        if (response.statusCode !== 200) {
            throw new Error(`HTTP ${response.statusCode}`);
        }
        return JSON.parse(response.body);
    }

    addQueryParams(url, params) {
        const query = Object.entries(params)
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
            .join('&');
        return query ? `${url}?${query}` : url;
    }

    encodeFormData(data) {
        return Object.entries(data)
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
            .join('&');
    }

    buildHeaders() {
        return {
            ...AppConfig.API.headers,
            Cookie: StorageService.get(AppConfig.STORAGE.cookie.key)
        };
    }
}

// ====================
// 执行入口
// ====================
if (typeof $request !== "undefined") {
    const cookie = $request.headers?.Cookie;
    if (cookie && AppConfig.STORAGE.cookie.validator(cookie)) {
        StorageService.set(AppConfig.STORAGE.cookie.key, cookie);
        $notify("道一云", "Cookie更新成功", "凭证已保存");
    }
    $done();
} else {
    new AttendanceService().execute();
}
