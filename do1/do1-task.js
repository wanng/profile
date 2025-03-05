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

    // 新增参数配置
    static getProbabilityParam() {
        const sourcePath = $environment?.sourcePath || '';
        const sourceUrl = new URL(sourcePath);
        const sourceHash = sourceUrl.hash;
        const scriptParams = new URLSearchParams(sourceHash.substring(1));
        return scriptParams.get("probability") || "on";
    }
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
        const val = $prefs.valueForKey(key);
        console.log(`[STORAGE] 读取键值 ${key}: ${val?.substring(0,15)}...`);
        return val;
    }

    static set(key, value) {
        console.log(`[STORAGE] 设置键值 ${key}: ${value}`);
        $prefs.setValueForKey(value, key);
    }

    static checkRecentSuccess() {
        const last = parseInt(this.get(AppConfig.STORAGE.lastSuccess)) || 0;
        const currentTime = Date.now();
        const timeDiff = currentTime - last;
        const shouldSkip = last !== 0 && timeDiff < 3_600_000;
        console.log(`[CHECK] 最近成功检查: ${shouldSkip ? '跳过执行' : '允许执行'}`);
        return shouldSkip;
    }
}

// ====================
// 业务逻辑抽象
// ====================
class AttendanceValidator {
    static validateCookie() {
        const cookie = StorageService.get(AppConfig.STORAGE.cookie.key);
        const isValid = AppConfig.STORAGE.cookie.validator(cookie);
        console.log(`[VALIDATE] Cookie有效性检查: ${isValid ? '通过' : '失败'}`);
        return isValid;
    }
}

class ProbabilityController {
    static checkExecution(probabilityKey) {
        const currentProb = parseInt(StorageService.get(probabilityKey)) || 10;
        const rand = Math.random() * 100;
        console.log(`[PROB] 当前概率 ${currentProb}%, 随机值 ${rand.toFixed(2)}`);

        if (rand > currentProb) {
            const newProb = Math.min(currentProb + 10, 100);
            StorageService.set(probabilityKey, newProb.toString());
            console.log(`[PROB] 未命中概率，提升至 ${newProb}%`);
            return false;
        }
        console.log(`[PROB] 命中概率，继续执行`);
        return true;
    }
}

// ====================
// 核心业务实现
// ====================
class AttendanceService {
    constructor(httpClient = new HttpClient()) {
        this.httpClient = httpClient;
        this.probability = AppConfig.getProbabilityParam();
    }

    async execute() {
        console.log(`[EXEC] 开始执行任务流程`);
        try {
            if (!this.preCheck()) {
                console.log(`[EXEC] 前置检查未通过，终止执行`);
                return;
            }
            await this.processCheckIn();
        } catch (error) {
            this.handleError(error);
        } finally {
            $done();
        }
    }

    preCheck() {
        console.log(`[CHECK] 开始前置检查`);
        if (!AttendanceValidator.validateCookie()) {
            console.log(`[CHECK] Cookie无效，终止流程`);
            this.notify("Cookie无效");
            return false;
        }
        
        if (StorageService.checkRecentSuccess()) {
            console.log(`[CHECK] 近期已成功执行，跳过本次`);
            return false;
        }

        if (this.probability === "off") {
            console.log(`[PROB] 概率控制已关闭，跳过概率检查`);
            return true;
        }

        return ProbabilityController.checkExecution(AppConfig.STORAGE.probability);
    }

    async processCheckIn() {
        console.log(`[PROCESS] 开始处理签到流程`);
        const checkType = this.determineCheckType();
        if (!checkType) {
            console.log(`[PROCESS] 未匹配到有效签到类型`);
            return;
        }
        console.log(`[PROCESS] 检测到签到类型: ${checkType}`);

        await this.verifyLeaveStatus();
        console.log(`[PROCESS] 请假状态验证通过`);
        const result = await this.submitSign(checkType);
        this.handleResult(result);
    }

    determineCheckType() {
        const currentHour = TimeUtils.currentHour;
        const checkType = Object.entries(AppConfig.CHECK_RULES).find(([_, rule]) =>
            currentHour > rule.timeRange[0] && currentHour <= rule.timeRange[1]
        )?.[0];
        console.log(`[TIME] 当前时间 ${currentHour.toFixed(2)}H, 匹配类型 ${checkType || '无'}`);
        return checkType;
    }

    async verifyLeaveStatus() {
        console.log(`[VERIFY] 开始验证请假状态`);
        const { data } = await this.httpClient.get(
            AppConfig.API.endpoints.calendar,
            { searchDate: TimeUtils.today }
        );
        
        if (data?.conditionVo?.askList?.some(this.isCurrentLeave)) {
            console.log(`[VERIFY] 检测到请假记录`);
            throw new Error("当前处于请假状态");
        }
    }

    async submitSign(type) {
        const rule = AppConfig.CHECK_RULES[type];
        console.log(`[SIGN] 提交签到请求，类型: ${type}, 规则ID: ${rule.id}`);
        const result = await this.httpClient.post(AppConfig.API.endpoints.sign, {
            ruleId: rule.id,
            ...AppConfig.LOCATION
        });
        console.log(`[SIGN] 请求响应: ${JSON.stringify(result)}`);
        return result;
    }

    handleResult(response) {
        console.log(`[RESULT] 处理响应结果，状态码: ${response.code}`);
        if (!['0', '88'].includes(response.code)) {
            throw new Error(response.desc || "未知错误");
        }

        StorageService.set(AppConfig.STORAGE.lastSuccess, Date.now().toString());
        StorageService.set(AppConfig.STORAGE.probability, "10");
        console.log(`[RESET] 重置执行概率为10%`);
        this.notify(response.code === "0" ? "操作成功" : "重复操作", response.desc);
    }

    handleError(error) {
        console.error(`[ERROR] ${error.stack || error}`);
        this.notify("操作失败", error.message.replace("Error: ", ""));
    }

    notify(title, message = "") {
        console.log(`[NOTIFY] 发送通知: ${title} - ${message}`);
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
        console.log(`[HTTP] ${method}请求 ${endpoint}`);

        const requestConfig = {
            url: method === 'GET' ? this.addQueryParams(url, data) : url,
            method,
            headers,
            body: method !== 'GET' ? this.encodeFormData(data) : undefined
        };
        console.log(`[HTTP] 请求参数 ${JSON.stringify(requestConfig).substring(0, 120)}...`);

        const response = await $task.fetch(requestConfig);
        console.log(`[HTTP] 响应状态码: ${response.statusCode}, 响应体长度: ${response.body?.length || 0}`);

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
    console.log(`[INIT] 检测到请求拦截`);
    const cookie = $request.headers?.Cookie;
    if (cookie && AppConfig.STORAGE.cookie.validator(cookie)) {
        StorageService.set(AppConfig.STORAGE.cookie.key, cookie);
        $notify("道一云", "Cookie更新成功", "凭证已保存");
    }
    $done();
} else {
    console.log(`[INIT] 启动定时任务`);
    new AttendanceService().execute();
}
