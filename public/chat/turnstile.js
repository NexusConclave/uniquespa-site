/* Optional Cloudflare Turnstile for lead submissions (uni-chat review finding #7).
   OFF unless the page carries <meta name="ush-turnstile-site-key" content="..."> (BaseLayout adds it only when
   PUBLIC_TURNSTILE_SITE_KEY is set at build time). The Worker checks tokens only when its TURNSTILE_SECRET is set.
   window.ushTurnstileToken() -> Promise<string>: a fresh single-use token, or '' when off or on any failure
   (the Worker then answers 403 "Please try again, or call..." and the form/voice agent shows the phone number).
   Appearance "interaction-only": most visitors never see anything; a challenge box appears only when needed. */
(function () {
  if (window.ushTurnstileToken) return;
  var SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  var loading = null;
  function siteKey() {
    var m = document.querySelector('meta[name="ush-turnstile-site-key"]');
    return (m && m.getAttribute('content')) || '';
  }
  function load() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!loading) {
      loading = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = SRC; s.async = true;
        s.onload = function () { window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')); };
        s.onerror = function () { loading = null; reject(new Error('turnstile')); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }
  window.ushTurnstileToken = function () {
    var key = siteKey();
    if (!key) return Promise.resolve('');
    return load().then(function (ts) {
      return new Promise(function (resolve) {
        var box = document.createElement('div');
        box.className = 'ush-turnstile';
        box.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647';
        document.body.appendChild(box);
        var id = null, settled = false;
        function done(token) {
          if (settled) return; settled = true;
          try { if (id !== null) ts.remove(id); } catch (e) {}
          box.remove();
          resolve(typeof token === 'string' ? token : '');
        }
        try {
          id = ts.render(box, { sitekey: key, action: 'lead', appearance: 'interaction-only',
            callback: done, 'error-callback': function () { done(''); }, 'expired-callback': function () { done(''); },
            'timeout-callback': function () { done(''); } });
        } catch (e) { done(''); }
        setTimeout(function () { done(''); }, 30000);
      });
    }).catch(function () { return ''; });
  };
})();
