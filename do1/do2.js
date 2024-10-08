const do1Url = "https://qy.do1.com.cn/wxqyh/portal/checkWorkSignInCtrl/addsignin.do"
const do1Headers = {
    "Host": "qy.do1.com.cn",
    "Origin": "https://qy.do1.com.cn",
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    "Cookie": "",
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.2(0x1800022c) NetType/4G Language/zh_CN",
    "Referer": "https://qy.do1.com.cn/wxqyh/vp/module/checkwork.html?corp_id=wx53631950e42e0440&agentCode=checkwork"
}

// 签到
const signInRequest = {
    url: do1Url,
    method: "POST",
    headers: do1Headers,
    body: "isCheckBeforePhoto=&id=AEE21D66-E6F8-4E9E-BB69-B369054CF3D3&againsignin=0&isgps=0&longitude=113.940327&latitude=22.526579&address=%E9%AB%98%E6%96%B0%E5%8D%97%E4%B9%9D%E9%81%9341%E5%8F%B7&isWorkDate=0&signDate=&ruleId=E2EBCF7D-1BF3-4420-B9C2-97102C1BA5FC&mapType=1&isMust=false&ruleTime="
}

// 签退
const signOutRequest = {
    url: do1Url,
    method: "POST",
    headers: do1Headers,
    body: "isCheckBeforePhoto=&id=8814FC84-EBDE-43C0-9A81-E0A18BD093A3&againsignin=0&isgps=0&longitude=113.940327&latitude=22.526579&address=%E9%AB%98%E6%96%B0%E5%8D%97%E4%B9%9D%E9%81%9341%E5%8F%B7&isWorkDate=0&signDate=&ruleId=E2EBCF7D-1BF3-4420-B9C2-97102C1BA5FC&mapType=1&isMust=false&ruleTime="
}

const cookieName = "道一云"
const cookieKey = "CookieDo1"
const lastSuccessTimeKey = "LastSuccessTimeDo1"
// 执行概率
const execProbabilityKey = "Probability"

const success = "success"
const fail = "fail"
const none = "none"

var Task = {
    run: function () {
        var execProbability =  Store.get(execProbabilityKey)
        if (!execProbability) {
            execProbability = 10
        }
        console.log("本次执行概率: " + execProbability + "%")

        var randomValue = Math.random() * 100;
        console.log("本次随机数: " + randomValue)

        if (randomValue > execProbability) {
            console.log("本次未执行！")
            Store.put(execProbabilityKey, "" + execProbability + 10)
            $done(none)
            return
        }

        console.log("本次执行成功！")
        Store.put(execProbabilityKey, "" + 10)

        var lastSuccessTime = Store.get(lastSuccessTimeKey)
        if (lastSuccessTime && Now.time() - lastSuccessTime < 60 * 60 * 1000) {
            console.log("一小时内已成功签到/签退, 不再重试")
            $done(none)
            return
        }

        var clock = Now.clock()
        var request = null

        // 07:00 - 09:30
        if (clock > 7 && clock <= 9.5) {
            console.log("开始签到")
            signInRequest.headers['Cookie'] = Store.get(cookieKey)
            request = signInRequest
        }
        
        // 18:30 - 24:00
        if (clock > 18.5 && clock < 24) {
            console.log("开始签退")
            signOutRequest.headers['Cookie'] = Store.get(cookieKey)
            request = signOutRequest
        }

        if (!request) {
            console.log("未到执行时间!")
            $done(none)
            return
        }

        // $task.fetch(request).then(response => {
        //     var json = JSON.parse(response.body)

        //     if (json['code'] == "0") {
        //         Store.put(lastSuccessTimeKey, Now.time().toString())
        //         $notify("道一云签到/签退成功", "", json['desc'])
        //         $done(success)
        //     }
            
        //     if (json['code'] == "88") {
        //         Store.put(lastSuccessTimeKey, Now.time().toString())
        //         $done(none)
        //     }

        //     $notify("道一云签到/签退失败", "", json['desc'])
        //     $done(fail)
        // }).catch(reason => {
        //     console.log(reason)
        //     if (reason.error) {
        //         $notify("道一云签到/签退失败", "", reason.error)
        //         $done(fail)
        //     } else {
        //         $done(none)
        //     }
        // })
    }
}
    
var Cookie = {

    update: function () {

        var failTitle = "更新" + cookieName + "Cookie失败‼️";
        var successTitle = "更新" + cookieName + "Cookie成功 🎉"

        if (!$request.headers) {
            $notify(failTitle, "", "配置错误, 无法读取请求头,")
            $done()
            return
        }
        
        var cookie = $request.headers['Cookie']
  
        if (!cookie && cookie.indexOf("sessionToken") != -1) {
            $notify(failTitle, "", "Cookie关键值缺失")
            $done()
            return
        }

        var oldCookie = Store.get(cookieKey)
      
        if (!oldCookie || oldCookie != cookie) {
          console.log("访问:[" + $request.url + "]")
          var success = Store.put(cookieKey, cookie)
          $notify(success ? successTitle : failTitle, "", "")
          $done()
          return
        }
         
        $done()
    }
}



var Now = {
    clock: function () {
        var now = new Date()
        var hours = now.getHours()
        var minutes = now.getMinutes()
        var clock = (hours * 60 + minutes) / 60
        return clock
    },

    time: function () {
        return new Date().getTime()
    }
}


var Store = {

    get: function (key) {
        return $prefs.valueForKey(key)
    },

    put: function (key, value) {
        console.log("保存:[" + key + ":" + value + "]")
        return $prefs.setValueForKey(value, key)
    }
}


if (typeof $request != "undefined") {
    Cookie.update()
  } else {
    Task.run()
}
  
