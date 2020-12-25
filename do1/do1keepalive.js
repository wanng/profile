const do1Url = "https://qy.do1.com.cn/wxqyh/portal/cooperationPortalCtl/continueSession.do"
const do1Headers = {
    "Host": "qy.do1.com.cn",
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    "Cookie": "",
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/7.0.18(0x17001231) NetType/4G Language/zh_CN",
    "Referer": "https://qy.do1.com.cn/wxqyh/vp/module/checkwork.html?corp_id=wx53631950e42e0440&agentCode=checkwork"
}
const do1body = "agentCode=checkwork"

// 保活
const keepAliveRequest = {
    url: do1Url,
    method: "POST",
    headers: do1Headers,
    body: do1body
}

const cookieName = "道一云"
const cookieKey = "CookieDo1"
const lastSuccessTimeKey = "LastSuccessTimeDo1"

var Task = {
    run: function (ttl) {
        if (ttl-- <= 0) {
            $done()
            return
        }
        keepAliveRequest.headers['Cookie'] = Store.get(cookieKey)
        $task.fetch(keepAliveRequest).then(response => {
            console.log("body:" + response.body)
            var json = JSON.parse(response.body)
            
            if (json['code'] == "0") {
                console.log(cookieName + " KeepAlive SUCCESS")
                $done()
                return
            }

            var clock = Now.clock()
            if (clock >= 9 && clock <= 21) {
                console.log(cookieName + " KeepAlive FAIL" + json['desc'])
                $notify("道一云保活", "", json['desc'])
            }
            $done()
        }).catch(reason => {
            console.log(cookieName + " KeepAlive FAIL " + reason.error)
            Task.run(ttl)
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
        console.log("put [" + key + " : " +value+"]")
        return $prefs.setValueForKey(value, key)
    }
}



if (!$request) {
    Task.run(60)   
}
  
