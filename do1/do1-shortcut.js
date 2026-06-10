/*********************
 * 道一云签到快捷指令版
 * 基于架构优化版，去除请假验证和概率控制
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
        lastSuccess: "LastSuccessTimeDo1"
    });

    static LOCATION = Object.freeze({
        coordinates: [113.940327, 22.526579],
        address: "广东省深圳市南山区高新南九道55号"
    });

    static CHECK_RULES = Object.freeze({
        checkIn: {
            id: "AEE21D66-E6F8-4E9E-BB69-B369054CF3D3", // 修正签到ID
            timeRange: [7.0, 9.5],
            ruleId: "E2EBCF7D-1BF3-4420-B9C2-97102C1BA5FC" // 新增固定规则ID
        },
        checkOut: {
            id: "8814FC84-EBDE-43C0-9A81-E0A18BD093A3",
            timeRange: [18.5, 24.0],
            ruleId: "E2EBCF7D-1BF3-4420-B9C2-97102C1BA5FC" // 新增固定规则ID
        }
    });

    // 新增固定请求参数
    static FIXED_PARAMS = Object.freeze({
        common: {
            isCheckBeforePhoto: "",
            againsignin: "0",
            isgps: "0",
            isWorkDate: "0",
            signDate: "",
            mapType: "1",
            isMust: "false",
            ruleTime: ""
        }
    });

    static API = Object.freeze({
        endpoints: {
            sign: "/wxqyh/portal/checkWorkSignInCtrl/addsignin.do"
        },
        headers: Object.freeze({
            Host: "qy.do1.com.cn",
            Origin: AppConfig.API_HOST,
            Referer: "https://qy.do1.com.cn/wxqyh/vp/module/checkwork.html?corp_id=wx53631950e42e0440&agentCode=checkwork",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.73(0x18004939) NetType/WIFI Language/zh_CN"
        })
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

// ====================
// 核心业务实现
// ====================
class AttendanceService {
    constructor(httpClient = new HttpClient()) {
        this.httpClient = httpClient;
        this.result = "failure"; // 默认失败
    }

    async execute() {
        console.log(`[EXEC] 开始执行任务流程`);
        try {
            if (!this.preCheck()) {
                console.log(`[EXEC] 前置检查未通过，终止执行`);
                $done(this.result);
                return;
            }
            const success = await this.processCheckIn();
            this.result = success ? "success" : "failure";
        } catch (error) {
            this.handleError(error);
        } finally {
            $done(this.result);
        }
    }

    preCheck() {
        console.log(`[CHECK] 开始前置检查`);
        if (!AttendanceValidator.validateCookie()) {
            console.log(`[CHECK] Cookie无效，终止流程`);
            this.notify("签到失败", "Cookie无效，请重新获取");
            return false;
        }
        
        if (StorageService.checkRecentSuccess()) {
            console.log(`[CHECK] 近期已成功执行，跳过本次`);
            this.result = "success"; // 近期已成功，视为成功
            return false;
        }

        return true;
    }

    async processCheckIn() {
        console.log(`[PROCESS] 开始处理签到流程`);
        const checkType = this.determineCheckType();
        if (!checkType) {
            console.log(`[PROCESS] 未匹配到有效签到类型`);
            this.notify("签到失败", "不在签到时间范围内");
            return false;
        }
        console.log(`[PROCESS] 检测到签到类型: ${checkType}`);

        const result = await this.submitSign(checkType);
        this.handleResult(result);
        return true;
    }

    determineCheckType() {
        const currentHour = TimeUtils.currentHour;
        const checkType = Object.entries(AppConfig.CHECK_RULES).find(([_, rule]) =>
            currentHour > rule.timeRange[0] && currentHour <= rule.timeRange[1]
        )?.[0];
        console.log(`[TIME] 当前时间 ${currentHour.toFixed(2)}H, 匹配类型 ${checkType || '无'}`);
        return checkType;
    }

    async submitSign(type) {
        const rule = AppConfig.CHECK_RULES[type];
        console.log(`[SIGN] 提交签到请求，类型: ${type}, 规则ID: ${rule.id}`);
        
        // 构建符合要求的body参数
        const requestBody = {
            ...AppConfig.FIXED_PARAMS.common,
            id: rule.id,
            ruleId: rule.ruleId,
            longitude: AppConfig.LOCATION.coordinates[0],
            latitude: AppConfig.LOCATION.coordinates[1],
            address: AppConfig.LOCATION.address
        };

        const result = await this.httpClient.post(
            AppConfig.API.endpoints.sign,
            requestBody
        );
        console.log(`[SIGN] 请求响应: ${JSON.stringify(result)}`);
        return result;
    }

    handleResult(response) {
        console.log(`[RESULT] 处理响应结果，状态码: ${response.code}`);
        if (!['0', '88'].includes(response.code)) {
            throw new Error(response.desc || "未知错误");
        }

        StorageService.set(AppConfig.STORAGE.lastSuccess, Date.now().toString());
        console.log(`[SUCCESS] 签到成功，已记录成功时间`);
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
            .map(([k, v]) => {
                // 处理空值参数
                if (v === null || v === undefined) return '';
                return `${k}=${encodeURIComponent(v)}`;
            })
            .filter(Boolean) // 过滤空值
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
