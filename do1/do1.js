const do1Url = "https://qy.do1.com.cn/wxqyh/portal/checkWorkSignInCtrl/addsignin.do"
const do1Headers = {
    "Host": "qy.do1.com.cn",
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    "Cookie": "",
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/7.0.18(0x17001231) NetType/4G Language/zh_CN",
    "Referer": "https://qy.do1.com.cn/wxqyh/vp/module/checkwork.html?corp_id=wx53631950e42e0440&agentCode=checkwork"
}

// 签到
const signInRequest = {
    url: do1Url,
    method: "POST",
    headers: do1Headers,
    body: "isCheckBeforePhoto=&id=28744F3A-0D5A-4F22-BFC0-1D0A79AC8F60&againsignin=0&isgps=0&longitude=113.937828&latitude=22.522373&address=%E5%B9%BF%E4%B8%9C%E7%9C%81%E6%B7%B1%E5%9C%B3%E5%B8%82%E5%8D%97%E5%B1%B1%E5%8C%BA%E6%BB%A8%E6%B5%B7%E5%A4%A7%E9%81%93&isWorkDate=0&signDate=&ruleId=B321F185-E5DB-490E-B982-DC5BF6EEAF81&mapType=1&isMust=false&ruleTime="
}

// 签退
const signOutRequest = {
    url: do1Url,
    method: "POST",
    headers: do1Headers,
    body: "isCheckBeforePhoto=&id=E91EA6E2-82A8-4165-975C-337E98240B4A&againsignin=0&isgps=0&longitude=113.937828&latitude=22.522373&address=%E5%B9%BF%E4%B8%9C%E7%9C%81%E6%B7%B1%E5%9C%B3%E5%B8%82%E5%8D%97%E5%B1%B1%E5%8C%BA%E6%BB%A8%E6%B5%B7%E5%A4%A7%E9%81%93&isWorkDate=0&signDate=&ruleId=B321F185-E5DB-490E-B982-DC5BF6EEAF81&mapType=1&isMust=false&ruleTime="
}

const cookieName = "道一云"
const cookieKey = "CookieDo1"
const lastSuccessTimeKey = "LastSuccessTimeDo1"

const success = "success"
const fail = "fail"
const none = "none"

var Task = {
    run: function () {
        var lastSuccessTime = Store.get(lastSuccessTimeKey)
        if (lastSuccessTime && Now.time() - lastSuccessTime < 60 * 60 * 1000) {
            console.log("一小时内已成功签到/签退, 不再重试")
            $done(none)
            return
        }

        Today.isWorkDate().then(() => {
            var clock = Now.clock()

            // 07:00 - 09:30
            if (clock > 7 && clock <= 9.5) {
                console.log("开始签到")
                signInRequest.headers['Cookie'] = Store.get(cookieKey)
                return $task.fetch(signInRequest)
            }
            
            // 18:30 - 24:00
            if (clock > 18.5 && clock < 24) {
                console.log("开始签退")
                signOutRequest.headers['Cookie'] = Store.get(cookieKey)
                return $task.fetch(signOutRequest)
            }
            
            throw "什么都没做"
        }).then(response => {
            var json = JSON.parse(response.body)

            if (json['code'] == "0") {
                Store.put(lastSuccessTimeKey, Now.time().toString())
                $notify("道一云签到/签退成功", "", json['desc'])
                $done(success)
            }
            
            if (json['code'] == "88") {
                Store.put(lastSuccessTimeKey, Now.time().toString())
                $done(none)
            }

            $notify("道一云签到/签退失败", "", json['desc'])
            $done(fail)
        }).catch(reason => {
            console.log(reason)
            if (reason.error) {
                $notify("道一云签到/签退失败", "", reason.error)
                $done(fail)
            } else {
                $done(none)
            }
        })
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
        
        var cookie = this.read($request.headers['Cookie'], "sessionToken")
  
        if (!cookie) {
            $notify(failTitle, "", "Cookie关键值缺失")
            $done()
            return
        }

        var oldCookie = Store.get(cookieKey)
      
        if (!oldCookie || oldCookie != cookie) {
          console.log("抓取cookie url:" + $request.url)
          var success = Store.put(cookieKey, cookie)
          $notify(success ? successTitle : failTitle, "", "")
          $done()
          return
        }
         
        $done()
    },

    read: function (cookie, name) {
        if (!cookie) {
            return cookie
        }
        return cookie.split(";").filter(s => s.indexOf(name) != -1)[0]
    }
}

var Today = {

    holidayRequest: {
        url: "http://timor.tech/api/holiday/info"
    },

    isWorkDate: function () {
        return $task.fetch(this.holidayRequest).then(response => {
            var json = JSON.parse(response.body)
            var type = json.type.type
            if (![0, 3].includes(type)) {
                throw '今天不是工作日!!'
            }
        })
    },

    isHoliday: function () {
        return $task.fetch(this.holidayRequest).then(response => {
            var json = JSON.parse(response.body)
            var type = json.type.type
            if (![1, 2].includes(type)) {
                throw '今天不是节假日!!'
            }
        })
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
        console.log("put [" + key + ":" +value+"]")
        return $prefs.setValueForKey(value, key)
    }
}


if (typeof $request != "undefined") {
    Cookie.update()
  } else {
    Task.run()
}
  
