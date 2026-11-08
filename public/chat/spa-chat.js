/* Uni — Unique Spa House website chat (text via /api/chat, voice via ElevenLabs). No cookies. Counts only via the
   site's window.track (off unless enabled; event name and short slugs only, never what the guest types or says).
   Site build of bot/chat/spa-chat.js, adapted for the Astro layout (blueprint §4.11):
   - mounts inside the persisted #uni node (ClientRouter transition:persist), so a voice call survives page changes
   - never auto-opens; opened only by window.UniChat.open() from the header link, hero link, inline prompts or the bar
   - text chat is a true modal dialog: aria-modal, focus trap, background inert, full screen on mobile
   - a tap-to-start AI notice before the first message; a recording notice before the mic starts
   - a live voice call can be minimized to a non-modal call strip (mute, end, transcript) */
(function () {
  if (window.__uscLoaded) return; window.__uscLoaded = true;
  var API = '/api/chat';
  var LEAD_API = '/api/lead';
  var VOICE_SDK = '/chat/uni-voice.js';
  // Self-hosted AudioWorklets (public/chat/worklets): the CSP allows scripts from 'self' only, no blob: or CDN.
  var VOICE_WORKLETS = { rawAudioProcessor: '/chat/worklets/rawAudioProcessor.js', audioConcatProcessor: '/chat/worklets/audioConcatProcessor.js' };
  var VOICE_RESAMPLER = '/chat/worklets/libsamplerate.worklet.js';
  var AGENT_ID = 'agent_5001m5p0gcjhfqn9tdgn8ysdgwe3';
  var KEY = 'usc-chat-v2';
  var CONSENT_KEY = 'usc-ai-notice-v1';
  var WELCOME = "Hi, I'm Uni, the spa's AI assistant. Ask me about treatments, prices, specials or booking. Or tap the mic to talk to me.";
  var CHIPS = ['Massage prices', 'Current specials', 'Book an appointment', 'Locations & hours', 'Gift cards'];
  var LINKS = {
    book_san_diego: { label: 'Book in San Diego', href: 'https://book.squareup.com/appointments/ubclvdvkxdzjxk/location/LWTMBRFFB1D7G/services', ev: 'book_click', spa: 'SD' },
    book_del_mar: { label: 'Book in Del Mar', href: 'https://book.squareup.com/appointments/ubclvdvkxdzjxk/location/LXYVNKXTR50S3/services', ev: 'book_click', spa: 'DM' },
    gift_card: { label: 'Buy a gift card', href: 'https://app.squareup.com/gift/MLMCWB4BFADNP/order', ev: 'gift_card_click' },
    call_spa: { label: 'Call (858) 293-8900', href: 'tel:+18582938900', ev: 'call_click' }
  };
  var LOTUS = '<svg viewBox="0 0 48 44" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M24 35C18.6 28.4 18.2 17.6 24 8c5.8 9.6 5.4 20.4 0 27z"/><path transform="rotate(-34 24 35)" d="M24 35C18.6 28.4 18.2 17.6 24 8c5.8 9.6 5.4 20.4 0 27z"/><path transform="rotate(34 24 35)" d="M24 35C18.6 28.4 18.2 17.6 24 8c5.8 9.6 5.4 20.4 0 27z"/><path d="M15 39.5h18"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_MIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  var ICON_MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  var ICON_MUTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 10.6 6M12 18v3"/></svg>';

  function track(ev, props) { try { if (window.track) window.track(ev, props || {}); } catch (e) {} }
  var msgs = [];
  try { msgs = JSON.parse(sessionStorage.getItem(KEY) || '[]') || []; } catch (e) { msgs = []; }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-30))); } catch (e) {} }
  function consented() { try { return sessionStorage.getItem(CONSENT_KEY) === '1'; } catch (e) { return false; } }
  function setConsent() { try { sessionStorage.setItem(CONSENT_KEY, '1'); } catch (e) {} }

  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // Tiny, safe Markdown: escape first, then **bold**, [label](https://...), bare URLs, "- " lists.
  function inline(t) {
    t = esc(t);
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\[([^\]]{1,80})\]\((https?:\/\/[^\s)]+)\)/g, function (_, l, u) {
      return '<a href="' + u.replace(/"/g, '%22') + '" target="_blank" rel="noopener noreferrer">' + l + '</a>';
    });
    t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, function (_, p, u) {
      var label = /squareup\.com\/appointments/.test(u) ? 'Book online' : /squareup\.com\/gift/.test(u) ? 'Buy a gift card' : u.replace(/^https?:\/\//, '').slice(0, 40);
      return p + '<a href="' + u.replace(/"/g, '%22') + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
    });
    t = t.replace(/(\(858\) 293-8900)/g, '<a href="tel:+18582938900">$1</a>');
    return t;
  }
  function md(text) {
    var out = [], list = null;
    String(text).split(/\n/).forEach(function (line) {
      var m = line.match(/^\s*[-*•]\s+(.*)$/);
      if (m) { if (!list) { list = []; } list.push('<li>' + inline(m[1]) + '</li>'); return; }
      if (list) { out.push('<ul>' + list.join('') + '</ul>'); list = null; }
      if (line.trim()) out.push('<p>' + inline(line.trim()) + '</p>');
    });
    if (list) out.push('<ul>' + list.join('') + '</ul>');
    return out.join('');
  }

  // ---------- Build UI ----------
  var root = h('div', 'usc-root');
  root.setAttribute('data-nosnippet', '');
  var scrim = h('div', 'usc-scrim'); scrim.setAttribute('aria-hidden', 'true');
  var panel = h('div', 'usc-panel');
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'usc-title');
  panel.tabIndex = -1;
  var head = h('div', 'usc-head', '<div class="usc-avatar" aria-hidden="true">' + LOTUS + '</div><div class="usc-title"><b id="usc-title">Uni</b><span>The spa’s AI assistant</span></div>');
  var micBtn = h('button', 'usc-hbtn usc-mic', ICON_MIC); micBtn.type = 'button'; micBtn.setAttribute('aria-label', 'Talk to Uni by voice'); micBtn.setAttribute('aria-pressed', 'false');
  var minBtn = h('button', 'usc-hbtn usc-minbtn', ICON_MIN); minBtn.type = 'button'; minBtn.setAttribute('aria-label', 'Minimize, keep the call going'); minBtn.hidden = true;
  var close = h('button', 'usc-hbtn usc-close', ICON_X); close.type = 'button'; close.setAttribute('aria-label', 'Close chat');
  head.appendChild(micBtn); head.appendChild(minBtn); head.appendChild(close);

  var notice = h('div', 'usc-notice');
  notice.innerHTML = '<p><b>Uni is an AI assistant.</b> Your messages go to our AI providers so Uni can answer, and chats may be recorded and transcribed. Please don\'t share health or card details.</p>' +
    '<p><a href="/privacy/">How we use chat data</a></p>';
  var startBtn = h('button', 'usc-start', 'Start chat'); startBtn.type = 'button';
  notice.appendChild(startBtn);

  var vconfirm = h('div', 'usc-vconfirm'); vconfirm.hidden = true;
  vconfirm.innerHTML = '<p><b>Before we start:</b> voice calls with Uni are recorded and transcribed by our voice provider. Your browser will ask to use the microphone.</p>';
  var vgo = h('button', 'usc-vbtn usc-vend', '<span>Start the call</span>'); vgo.type = 'button';
  var vno = h('button', 'usc-vbtn', '<span>Not now</span>'); vno.type = 'button';
  var vrow = h('div', 'usc-vrow'); vrow.appendChild(vgo); vrow.appendChild(vno); vconfirm.appendChild(vrow);

  var log = h('div', 'usc-log'); log.setAttribute('aria-live', 'polite'); log.setAttribute('role', 'log'); log.setAttribute('aria-label', 'Conversation');
  var chips = h('div', 'usc-chips');
  var vbar = h('div', 'usc-vbar'); vbar.hidden = true;
  var vdot = h('span', 'usc-vdot'); var vtext = h('span', 'usc-vtext', 'Connecting…'); vtext.setAttribute('aria-live', 'polite');
  var vmute = h('button', 'usc-vbtn', ICON_MUTE + '<span>Mute</span>'); vmute.type = 'button';
  var vend = h('button', 'usc-vbtn usc-vend', '<span>End call</span>'); vend.type = 'button';
  vbar.appendChild(vdot); vbar.appendChild(vtext); vbar.appendChild(vmute); vbar.appendChild(vend);
  var form = h('form', 'usc-form');
  var input = h('textarea', 'usc-input'); input.rows = 1; input.placeholder = 'Type your question…'; input.maxLength = 1500; input.setAttribute('aria-label', 'Your message');
  var send = h('button', 'usc-send', ICON_SEND); send.type = 'submit'; send.setAttribute('aria-label', 'Send');
  form.appendChild(input); form.appendChild(send);
  var foot = h('div', 'usc-foot', 'Uni is an AI assistant and can make mistakes. Chats may be recorded and transcribed (see our Privacy page). Never share card or health details here.');
  panel.appendChild(head); panel.appendChild(notice); panel.appendChild(vconfirm); panel.appendChild(log); panel.appendChild(chips); panel.appendChild(vbar); panel.appendChild(form); panel.appendChild(foot);

  // Non-modal call strip (shown while a call is minimized)
  var strip = h('div', 'usc-strip'); strip.hidden = true; strip.setAttribute('role', 'region'); strip.setAttribute('aria-label', 'Call with Uni');
  var sdot = h('span', 'usc-vdot'); var stext = h('span', 'usc-stext', 'On a call with Uni');
  var sopen = h('button', 'usc-vbtn', '<span>Transcript</span>'); sopen.type = 'button';
  var smute = h('button', 'usc-vbtn', ICON_MUTE + '<span>Mute</span>'); smute.type = 'button';
  var send2 = h('button', 'usc-vbtn usc-vend', '<span>End</span>'); send2.type = 'button';
  strip.appendChild(sdot); strip.appendChild(stext); strip.appendChild(sopen); strip.appendChild(smute); strip.appendChild(send2);

  root.appendChild(scrim); root.appendChild(panel); root.appendChild(strip);

  function scroll() { log.scrollTop = log.scrollHeight; }
  function bubble(role, text) {
    var b = h('div', 'usc-msg ' + (role === 'user' ? 'usc-user' : 'usc-bot'));
    if (role === 'user') b.textContent = text; else b.innerHTML = md(text);
    log.appendChild(b); scroll(); return b;
  }
  function linkCard(key) {
    var l = LINKS[key]; if (!l) return false;
    var a = h('a', 'usc-linkcard'); a.href = l.href; a.textContent = l.label;
    a.setAttribute('data-track', l.ev);
    a.setAttribute('data-track-props', JSON.stringify(l.spa ? { spa: l.spa, placement: 'chat' } : { placement: 'chat' }));
    if (l.href.indexOf('http') === 0) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    var wrap = h('div', 'usc-msg usc-bot usc-cardwrap'); wrap.appendChild(a);
    log.appendChild(wrap); scroll(); return true;
  }
  function note(text) { log.appendChild(h('div', 'usc-err', esc(text))); scroll(); }
  function gate() {
    var ok = consented();
    notice.hidden = ok; log.hidden = !ok; chips.hidden = !ok; form.hidden = !ok;
    micBtn.disabled = !ok;
  }
  function render() {
    log.innerHTML = '';
    bubble('assistant', WELCOME);
    msgs.forEach(function (m) { if (m.role === 'link') linkCard(m.content); else bubble(m.role, m.content); });
    chips.innerHTML = '';
    if (!msgs.length) CHIPS.forEach(function (c) {
      var b = h('button', 'usc-chip'); b.type = 'button'; b.textContent = c;
      b.addEventListener('click', function () { ask(c); });
      chips.appendChild(b);
    });
    gate();
  }
  function history() { return msgs.filter(function (m) { return m.role === 'user' || m.role === 'assistant'; }).slice(-24); }

  // ---------- Text chat ----------
  var busy = false;
  function ask(text) {
    text = String(text || '').trim();
    if (!text || busy || !consented()) return;
    chips.innerHTML = '';
    if (voice) { // during a call, typed text goes to the voice agent
      try { voice.sendUserMessage(text); msgs.push({ role: 'user', content: text }); save(); bubble('user', text); input.value = ''; grow(); } catch (e) {}
      return;
    }
    busy = true; send.disabled = true;
    msgs.push({ role: 'user', content: text }); save();
    bubble('user', text);
    input.value = ''; grow();
    var t = h('div', 'usc-msg usc-bot usc-typing', '<i></i><i></i><i></i>'); t.setAttribute('aria-label', 'Uni is typing');
    log.appendChild(t); scroll();
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history() }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        t.remove();
        if (res.ok && res.d.reply) { msgs.push({ role: 'assistant', content: res.d.reply }); save(); bubble('assistant', res.d.reply); if (res.d.lead_captured) track('chat_lead', { channel: 'chat' }); }
        else { msgs.pop(); save(); note(res.d.error || 'Sorry, something went wrong. Please call (858) 293-8900.'); }
      })
      .catch(function () { t.remove(); msgs.pop(); save(); note('Connection problem. Please try again, or call (858) 293-8900.'); })
      .then(function () { busy = false; send.disabled = false; scroll(); input.focus(); });
  }

  // ---------- Voice (ElevenLabs) ----------
  var voice = null, starting = false, muted = false, sdkPromise = null;
  function loadSdk() {
    if (window.UniVoiceSDK) return Promise.resolve(window.UniVoiceSDK);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = VOICE_SDK; s.async = true;
      s.onload = function () { window.UniVoiceSDK ? resolve(window.UniVoiceSDK) : reject(new Error('sdk')); };
      s.onerror = function () { sdkPromise = null; reject(new Error('sdk')); };
      document.head.appendChild(s);
    });
    return sdkPromise;
  }
  function setVoiceUI(on, text, mode) {
    vbar.hidden = !on; root.classList.toggle('usc-calling', on);
    micBtn.setAttribute('aria-pressed', String(on));
    minBtn.hidden = !on;
    if (text) { vtext.textContent = text; stext.textContent = 'Uni call · ' + text; }
    vbar.setAttribute('data-mode', mode || ''); strip.setAttribute('data-mode', mode || '');
    input.placeholder = on ? 'Speak, or type to Uni…' : 'Type your question…';
    if (!on) { strip.hidden = true; root.classList.remove('usc-min'); }
  }
  function askVoice() { if (voice || starting) { stopVoice(); return; } vconfirm.hidden = false; vgo.focus(); }
  function startVoice() {
    vconfirm.hidden = true;
    if (voice || starting) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { note('Voice needs a browser with microphone support. You can keep typing.'); return; }
    starting = true; chips.innerHTML = '';
    setVoiceUI(true, 'Connecting…', 'connecting');
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); return loadSdk(); })
      .then(function (SDK) {
        return SDK.Conversation.startSession({
          agentId: AGENT_ID,
          connectionType: 'websocket',
          workletPaths: VOICE_WORKLETS,
          libsampleratePath: VOICE_RESAMPLER,
          clientTools: {
            show_link: function (p) {
              var k = p && p.link;
              if (!linkCard(k)) return 'Unknown link';
              msgs.push({ role: 'link', content: k }); save();
              return 'Link is now on the guest\'s screen';
            },
            save_lead: function (p) {
              // Optional Turnstile token (public/chat/turnstile.js; '' when Turnstile is off)
              var tok = window.ushTurnstileToken ? window.ushTurnstileToken() : Promise.resolve('');
              return tok
                .then(function (t) {
                  var body = Object.assign({}, p || {});
                  if (t) body['cf-turnstile-response'] = t;
                  return fetch(LEAD_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                })
                .then(function (r) { if (r.ok) track('chat_lead', { channel: 'voice' }); return r.ok ? 'Saved — the team has the request' : 'Failed — give the guest the spa phone number'; })
                .catch(function () { return 'Failed — give the guest the spa phone number'; });
            }
          },
          onConnect: function () { setVoiceUI(true, 'Listening…', 'listening'); track('voice_start'); },
          onDisconnect: function () { endVoiceUI(); },
          onError: function () { note('Voice hit a problem. You can keep typing, or call (858) 293-8900.'); },
          onModeChange: function (m) { if (voice) setVoiceUI(true, m.mode === 'speaking' ? 'Uni is speaking…' : (muted ? 'Muted' : 'Listening…'), m.mode); },
          onMessage: function (m) {
            var role = m.source === 'user' ? 'user' : 'assistant';
            var text = String(m.message || '').trim(); if (!text) return;
            var last = msgs[msgs.length - 1];
            if (role === 'user' && last && last.role === 'user' && last.content === text) return; // typed text echo
            msgs.push({ role: role, content: text }); save(); bubble(role, text);
          }
        });
      })
      .then(function (conv) { voice = conv; starting = false; muted = false; })
      .catch(function (err) {
        starting = false; voice = null; setVoiceUI(false);
        var denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        note(denied ? 'Microphone is blocked. Allow mic access to talk, or keep typing.' : 'Voice isn\'t available right now. You can keep typing, or call (858) 293-8900.');
      });
  }
  function endVoiceUI() { voice = null; starting = false; muted = false; vmute.querySelector('span').textContent = 'Mute'; smute.querySelector('span').textContent = 'Mute'; setVoiceUI(false); }
  function stopVoice() { var v = voice; endVoiceUI(); if (v) { try { v.endSession(); } catch (e) {} } }
  function toggleMute() {
    if (!voice) return; muted = !muted;
    try { voice.setMicMuted(muted); } catch (e) {}
    vmute.querySelector('span').textContent = muted ? 'Unmute' : 'Mute';
    smute.querySelector('span').textContent = muted ? 'Unmute' : 'Mute';
    setVoiceUI(true, muted ? 'Muted' : 'Listening…', muted ? 'muted' : 'listening');
  }

  micBtn.addEventListener('click', askVoice);
  vgo.addEventListener('click', startVoice);
  vno.addEventListener('click', function () { vconfirm.hidden = true; micBtn.focus(); });
  vend.addEventListener('click', stopVoice);
  vmute.addEventListener('click', toggleMute);
  smute.addEventListener('click', toggleMute);
  send2.addEventListener('click', function () { stopVoice(); });
  sopen.addEventListener('click', function () { open(sopen); });
  window.addEventListener('pagehide', stopVoice);

  // ---------- Modal: inert background + focus trap ----------
  var opener = null, isOpen = false;
  function host() { return document.getElementById('uni') || document.body; }
  function setInert(on) {
    var mine = host();
    Array.prototype.forEach.call(document.body.children, function (el) {
      if (el === mine || el.contains(root) || el.tagName === 'SCRIPT') return;
      if (on) { el.setAttribute('inert', ''); el.setAttribute('data-usc-inert', ''); }
      else if (el.hasAttribute('data-usc-inert')) { el.removeAttribute('inert'); el.removeAttribute('data-usc-inert'); }
    });
    document.documentElement.classList.toggle('usc-lock', on);
  }
  function focusables() {
    return Array.prototype.filter.call(panel.querySelectorAll('a[href], button:not([disabled]), textarea, input, [tabindex]:not([tabindex="-1"])'), function (el) {
      return !el.closest('[hidden]') && el.offsetParent !== null;
    });
  }
  panel.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var f = focusables(); if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // ---------- Open / close / minimize ----------
  function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; }
  function open(from) {
    if (!root.isConnected) mount();
    opener = from || document.activeElement;
    isOpen = true;
    root.classList.add('usc-open'); root.classList.remove('usc-min'); strip.hidden = true;
    render(); setInert(true);
    setTimeout(function () { (consented() ? input : startBtn).focus(); }, 30);
  }
  function restoreFocus() {
    var o = opener; opener = null;
    if (o && o.isConnected && typeof o.focus === 'function') o.focus();
  }
  function shut() {
    stopVoice();
    isOpen = false; root.classList.remove('usc-open'); setInert(false);
    restoreFocus();
  }
  function minimize() {
    if (!voice && !starting) { shut(); return; }
    isOpen = false; root.classList.remove('usc-open'); root.classList.add('usc-min'); setInert(false);
    strip.hidden = false;
    restoreFocus();
  }

  startBtn.addEventListener('click', function () { setConsent(); gate(); input.focus(); });
  close.addEventListener('click', shut);
  minBtn.addEventListener('click', minimize);
  scrim.addEventListener('click', function () { (voice || starting) ? minimize() : shut(); });
  form.addEventListener('submit', function (e) { e.preventDefault(); ask(input.value); });
  input.addEventListener('input', grow);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); } });
  root.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root.classList.contains('usc-open')) { e.preventDefault(); if (!vconfirm.hidden) { vconfirm.hidden = true; micBtn.focus(); return; } (voice || starting) ? minimize() : shut(); }
  });

  function mount() { host().appendChild(root); }
  mount();

  window.UniChat = {
    open: open,
    close: shut,
    isOpen: function () { return isOpen; },
    inCall: function () { return !!(voice || starting); },
    refreshInert: function () { if (isOpen) setInert(true); }
  };
})();
