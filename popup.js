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
function xhr(url) {
  var
    data = null,
    lastResponse = null,
    request = new XMLHttpRequest();

  // callbacks
  var
    _successCb = function(){ },
    _errorCb = function(){ };

  request.open("GET", url);
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
  request.send();

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

  var storage = localStorage.getItem("events");
  storage = storage ? JSON.parse(storage) : null;

  // if stored data is still fresh
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
        var channel = s.video_html.match(/\?channel=(\w+)/)[1];
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
      return [e.eid, teams, [].concat(streams)];
    })
    // only valid events
    .filter(function(e) {
      return !!e;
    });

    console.log(streamMap);
    localStorage.setItem("events", JSON.stringify({ items: streamMap, expiry: +new Date() + 900000})); // store for 15 mins
    success(streamMap); // next
  });

  getEvents.onError(function(data){
    error(data);
  });
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

  console.log(str, data);
  return str;
}

/*
 * main
 */
document.addEventListener("DOMContentLoaded", function() {
  fetchEvents(
    function(data) {
      getCurrentTabUrl(function(url) {
        var channel = url.match(/https?:\/\/(?:www\.)?twitch\.tv\/([^\/]+)/);
        if (!channel[1]) return;

        // match to event
        var event = data.filter(function(ev) { return ev[2].indexOf(channel[1]) > -1; });

          // if more than one match, take the latest
          var
            ev = event[0],
            team1 = document.querySelector(".team-1"),
            team2 = document.querySelector(".team-2"),
            link = document.querySelector(".event-link");

          // populate html
          team1.innerHTML = getTmpl({ name: ev[1][0].name, odds: ev[1][0].odds });
          team2.innerHTML = getTmpl({ name: ev[1][1].name, odds: ev[1][1].odds });
          link.href = "https://unikrn.com/s/e" + ev[0];
        });
      },
      function(data) {
        alert(data);
      }
    );
});
