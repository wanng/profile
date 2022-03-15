const cookieName = '米游社'
const signurlKey = 'chavy_signurl_mihoyo'
const signheaderKey = 'chavy_signheader_mihoyo'
const chavy = init()
const signurlVal = 'https://api-takumi.mihoyo.com/event/bbs_sign_reward/sign'
const signheaderVal = chavy.getdata(signheaderKey)
const signinfo = []
let bbslist = []

// 签到请求
const signRequest = {
  url: signurlVal,
  method: "POST",
  headers: JSON.parse(signheaderVal),
  body: '{"act_id":"e202009291139501","region":"cn_gf01","uid":"220552623"}'
}

sign()

function sign() {
  signbbs()
  check()
}

function signbbs(bbs) {
  chavy.post(signRequest , (error, response, data) => showmsg(data))
}


function showmsg(info) {
  console.log("响应结果:")
  console.log(info)

  const i = JSON.parse(info)
  chavy.msg(cookieName, '米游社签到', i.message)
  chavy.done()
}

function init() {
  isSurge = () => {
    return undefined === this.$httpClient ? false : true
  }
  isQuanX = () => {
    return undefined === this.$task ? false : true
  }
  getdata = (key) => {
    if (isSurge()) return $persistentStore.read(key)
    if (isQuanX()) return $prefs.valueForKey(key)
  }
  setdata = (key, val) => {
    if (isSurge()) return $persistentStore.write(key, val)
    if (isQuanX()) return $prefs.setValueForKey(key, val)
  }
  msg = (title, subtitle, body) => {
    if (isSurge()) $notification.post(title, subtitle, body)
    if (isQuanX()) $notify(title, subtitle, body)
  }
  log = (message) => console.log(message)
  get = (url, cb) => {
    if (isSurge()) {
      $httpClient.get(url, cb)
    }
    if (isQuanX()) {
      url.method = 'GET'
      $task.fetch(url).then((resp) => cb(null, {}, resp.body))
    }
  }
  post = (url, cb) => {
    if (isSurge()) {
      $httpClient.post(url, cb)
    }
    if (isQuanX()) {
      url.method = 'POST'
      $task.fetch(url).then((resp) => cb(null, {}, resp.body))
    }
  }
  done = (value = {}) => {
    $done(value)
  }
  return { isSurge, isQuanX, msg, log, getdata, setdata, get, post, done }
}