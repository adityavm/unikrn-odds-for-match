/**
 * get the current tab's url if allowed
 * @param  {Function} cb function to call when successfully got tab url
 */
function getCurrentTabUrl(cb) {

  var queryInfo = {
    active: true,
    currentWindow: true
  };

  chrome.tabs.query(queryInfo, function(tabs) {
    var
      tab = tabs[0],
      url = tab.url;

    console.assert(typeof url == 'string', 'tab.url should be a string');
    cb(url);
  });
}

/**
 * make xmlhttprequest
 * @param  {String} url URL to fetch
 * @return {Object}     { successHandler, errorHandler }
 */
function xhr(url, post) {
  var
    data = null,
    lastResponse = null,
    request = new XMLHttpRequest();

  // callbacks
  var
    _successCb = function(){ },
    _errorCb = function(){ };

  request.open(post ? "POST" : "GET", url);
  request["content-type"] = "application/json";
  request.responseType = "json";
  request.onload = function() {
    lastResponse = request.response;
    if (lastResponse.error) {
      console.error(lastResponse.msg_trans);
      _errorCb(lastResponse);
      return;
    }

    data = lastResponse.data;
    _successCb(data);
  }
  request.send(JSON.stringify(post));

  return {
    onSuccess: function(cb) { _successCb = cb; },
    onError: function(cb) { _errorCb = cb; }
  };
}

/**
 * fetch events either from storage or api
 * depending on expiry set
 * @param  {Function} success success handler
 * @param  {Function} error   erorr handler
 */
function fetchEvents(success, error) {

  // if stored data is still fresh
  var storage = getItem("events");
  if (storage && +new Date() <= storage.expiry) {
    success(storage.items);
    return storage.items;
  }

  var getEvents = xhr("https://unikrn.com/apiv2/events/current=1");

  getEvents.onSuccess(function(events){
    var streamMap = events.items.map(function(e) {
      if (e.streams.length === 0 || e.state > 3) return;

      // only twitch + live streams
      var streams = e.streams.map(function(s) {
        if (
          s.stream_type !== "stream_twitch" ||
          s.is_live === false
        ) return null;
        var channel = s.video_html.match(/\?channel=(\w+)/)[1].toLowerCase();
        return channel;
      });

      if (streams[0] === null) return;

      // create quick map
      var teams = [{
        name: e.markets[0].team_name,
        odds: e.markets[0].odd,
      }, {
        name: e.markets[1].team_name,
        odds: e.markets[1].odd,
      }];
      return [e.eid, teams, [].concat(streams), e.name];
    })
    // only valid events
    .filter(function(e) {
      return !!e;
    });

    console.log(streamMap);
    setItem("events", { items: streamMap, expiry: +new Date() + 300000}); // store for 15 mins
    success(streamMap); // next
  });

  getEvents.onError(function(data){
    error(data);
  });
}

function fetchPending(success, error) {

  var pending = getItem("pending");
  if (pending && +new Date() < pending.expiry) {
    success(pending.items);
    return pending.items;
  }

  var session = getItem("session").session;
  var getPending = xhr("https://unikrn.com/apiv2/user/pendingbets/coin", { session_id: session });

  getPending.onSuccess(function(data){
    console.log(data.items);
  });

  getPending.onError(function(data){
    console.error(data);
  })

}

/**
 * ghetto templating function
 * @param  {Object} data (key,val) pairs of data to substitute (global substitution)
 * @return {String} template string post substitutions
 */
function getTmpl(data) {
  var str = ""+
  '<div class="team">                 '+
  '   <div class="name">{name}</div>  '+
  '   <div class="odds">{odds}</div>  '+
  '</div>';

  for (var i in data) {
    var re = new RegExp("{"+i+"}", "g");
    str = str.replace(re, data[i]);
  };

  return str;
}

// show no data message
function markNoData() {
  document.querySelector(".without-data").classList.add("show");
  document.querySelector(".with-data").classList.remove("show");
}

// show data
function markYesData() {
  document.querySelector(".without-data").classList.remove("show");
  document.querySelector(".with-data").classList.add("show");
}

// add item to localstorage
function setItem(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

// get item from localstorage
function getItem(key) {
  var item = localStorage.getItem(key);
  return item ? JSON.parse(item) : null;
}

/**
 * gets session id from main unikrn site
 * @return { onSuccess, onError }
 */
function getSessionId(success, error) {

  var oldSession = getItem("session");
  if (oldSession && +new Date() < oldSession.expiry) {
    success(oldSession.sessionId);
    return oldSession.sessionId;
  }

  var iframe = document.querySelector("iframe");
  iframe.src = "https://delta.dev.unikrn.com/msgBus";

  window.addEventListener("message", function(msg) {
    if (!msg.data) {
      error(msg);
    }

    var session = msg.data.sessionId;
    setItem("session", {
      session: session,
      expiry: +new Date() + 43200000,
    });
    success(session);
  });

  iframe.onload = function(){
    iframe.contentWindow.postMessage({ request: "sessionId"}, "*");
  }
}

/*
 * main
 */
document.addEventListener("DOMContentLoaded", function() {
  getSessionId(
    function(pending) {
      fetchPending(
        function(data) {
          console.log(data);
        },
        function(data) {
          console.error(data);
        }
      );
    },
    function(error) {
      console.log(error);
    }
  );

  fetchEvents(
    function(data) {
      getCurrentTabUrl(function(url) {
        var channel = url.match(/https?:\/\/(?:www\.)?twitch\.tv\/([^\/]+)/);
        if (!channel) {
          markNoData();
          return;
        };

        // match to event
        var
          chnl = channel[1].toLowerCase(),
          event = data.filter(function(ev) { return ev[2].indexOf(chnl) > -1; });

        if (event.length === 0) {
          markNoData();
          return;
        }

        // if more than one match, take the latest
        var
          ev = event[0],
          team1 = document.querySelector(".team-1"),
          team2 = document.querySelector(".team-2"),
          name = document.querySelector(".event-name"),
          link = document.querySelector(".event-link");

        // populate html
        name.innerHTML = ev[3];
        team1.innerHTML = getTmpl({ name: ev[1][0].name, odds: ev[1][0].odds });
        team2.innerHTML = getTmpl({ name: ev[1][1].name, odds: ev[1][1].odds });
        link.href = "https://unikrn.com/s/e" + ev[0];
        markYesData();
      });
    },
    function(data) {
      alert(data);
    }
  );
});
