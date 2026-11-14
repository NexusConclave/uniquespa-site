/* Uni — Unique Spa House website chat (text via /api/chat, voice via ElevenLabs). No cookies. Counts only via the
   site's window.track (off unless enabled; event name and short slugs only, never what the guest types or says).
   Site build of bot/chat/spa-chat.js, adapted for the Astro layout (blueprint §4.11):
   - mounts inside the persisted #uni node (ClientRouter transition:persist), so a voice call survives page changes
   - never auto-opens; opened only by window.UniChat.open() from the header link, hero link, inline prompts or the bar
   - text chat is a true modal dialog: aria-modal, focus trap, background inert, full screen on mobile
   - a tap-to-start AI notice before the first message; a recording notice before the mic starts
   - a live voice call can be minimized to a non-modal call strip (mute, end, transcript)
   Booking (Uni books appointments, 13 Nov 2026): when the chat Worker answers with a booking ref (chat), or the voice agent
   calls the show_card_form client tool, Square's own secure card form (Web Payments SDK, web.squarecdn.com) opens in the
   chat with the spa's cancellation/no-show policy and a consent box. The card number lives only inside Square's iframe:
   this file only ever handles Square's one-time card token, and Uni (the AI) only hears "Booked: ..." or "Not booked: ...".
   Card-number-like digits a guest types or says are removed before they are stored, shown or sent. */
(function () {
  if (window.__uscLoaded) return; window.__uscLoaded = true;
  var API = '/api/chat';
  var LEAD_API = '/api/lead';
  var BOOK_API = '/api/book', BOOK_INTENT_API = '/api/book/intent', BOOK_CONFIG_API = '/api/book/config';
  // Only Square's own SDK may be loaded for the card form (the CSP allows this host and nothing else for it).
  var SQUARE_SDK_OK = /^https:\/\/(sandbox\.)?web\.squarecdn\.com\/v1\/square\.js$/;
  var CARDLIKE = /(?:\d[\s.\-]?){13,19}/g; // 13-19 digit runs: card numbers are never stored, shown or sent
  function redactCard(t) { return String(t).replace(CARDLIKE, '[card number removed]'); }
  var VOICE_SDK = '/chat/uni-voice.js';
  // Self-hosted AudioWorklets (public/chat/worklets): the CSP allows scripts from 'self' only, no blob: or CDN.
  var VOICE_WORKLETS = { rawAudioProcessor: '/chat/worklets/rawAudioProcessor.js', audioConcatProcessor: '/chat/worklets/audioConcatProcessor.js' };
  var VOICE_RESAMPLER = '/chat/worklets/libsamplerate.worklet.js';
  var AGENT_ID = 'agent_9401m6wnk56heqnv0j95xcbx15td';
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
    // An open card form stays as it is: rebuilding the log would reload Square's iframe and lose what the guest typed.
    if (booking && !booking.done && log.contains(booking.box)) { gate(); return; }
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
    text = redactCard(String(text || '').trim());
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
        if (res.ok && res.d.reply) {
          msgs.push({ role: 'assistant', content: res.d.reply }); save(); bubble('assistant', res.d.reply);
          if (res.d.lead_captured) track('chat_lead', { channel: 'chat' });
          if (res.d.booking && /^[A-Z0-9]{12}$/.test(res.d.booking.ref || '')) openCardForm(res.d.booking.ref, 'chat');
        }
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
      .then(function (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); return Promise.all([loadSdk(), voiceAgentId()]); })
      .then(function (both) {
        var SDK = both[0];
        return SDK.Conversation.startSession({
          agentId: both[1],
          connectionType: 'websocket',
          workletPaths: VOICE_WORKLETS,
          libsampleratePath: VOICE_RESAMPLER,
          clientTools: {
            show_card_form: function (p) {
              var ref = p && String(p.booking_ref || '').trim().toUpperCase();
              if (!/^[A-Z0-9]{12}$/.test(ref)) return 'Failed: no valid booking_ref. Offer the booking link or the phone instead.';
              if (!isOpen) open();
              return openCardForm(ref, 'voice');
            },
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
            var text = redactCard(String(m.message || '').trim()); if (!text) return;
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
  // The chat Worker may name another agent (the acceptance copy names the booking TEST copy, so PR previews never use
  // or change the live agent). No answer, an error or a bad id within 1.5 s -> the live agent above.
  function voiceAgentId() {
    var fallback = new Promise(function (r) { setTimeout(function () { r(AGENT_ID); }, 1500); });
    var asked = fetch(BOOK_CONFIG_API, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (d) { var id = d && d.voice_agent_id; return typeof id === 'string' && /^agent_[a-z0-9]{20,40}$/.test(id) ? id : AGENT_ID; })
      .catch(function () { return AGENT_ID; });
    return Promise.race([asked, fallback]);
  }

  // ---------- Booking: Square's secure card form ----------
  var sqPromise = null, booking = null;
  function loadSquare(url) {
    if (window.Square && window.Square.payments) return Promise.resolve(window.Square);
    if (!SQUARE_SDK_OK.test(url || '')) return Promise.reject(new Error('sdk url'));
    if (sqPromise) return sqPromise;
    sqPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = url; s.async = true;
      s.onload = function () { window.Square && window.Square.payments ? resolve(window.Square) : reject(new Error('sdk')); };
      s.onerror = function () { sqPromise = null; reject(new Error('sdk')); };
      document.head.appendChild(s);
    });
    return sqPromise;
  }
  function postJson(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d || {} }; }); });
  }
  function closeBooking() {
    var b = booking; booking = null;
    if (b && b.card) { try { b.card.destroy(); } catch (e) {} }
  }
  // What Uni is told afterwards: never card data, only the result.
  function tellUni(line) {
    msgs.push({ role: 'assistant', content: line }); save(); bubble('assistant', line);
    if (voice) { try { voice.sendContextualUpdate('booking_result: ' + line); } catch (e) {} }
  }
  var bookSeq = 0;
  function openCardForm(ref, channel) {
    closeBooking();
    var id = 'usc-sqcard-' + (++bookSeq);
    var box = h('div', 'usc-msg usc-bot usc-book');
    box.setAttribute('role', 'group'); box.setAttribute('aria-labelledby', id + '-t');
    box.innerHTML = '<p class="usc-book-t" id="' + id + '-t"><b>Secure card form</b></p><p class="usc-book-sum">Loading…</p>';
    log.appendChild(box); scroll();
    var b = { ref: ref, channel: channel, box: box, card: null, busy: false, done: false };
    booking = b;
    var sum = box.querySelector('.usc-book-sum');
    function fail(msg) { sum.textContent = msg; scroll(); return 'Failed: ' + msg + ' Offer the booking link or the phone instead.'; }
    return postJson(BOOK_INTENT_API, { ref: ref }).then(function (res) {
      if (booking !== b) return 'Replaced by a newer card form.';
      if (!res.ok || !res.d.intent) return fail(res.d.message || 'This booking form has expired. Please ask Uni for the time again.');
      var v = res.d; b.view = v;
      sum.innerHTML = '<b>' + esc(v.service) + '</b><br>' + esc(v.time) + ' (Pacific) · ' + esc(v.spa) + '<br>For ' + esc(v.guest);
      var test = v.live ? '' : '<p class="usc-book-test">TEST ONLY: nothing will be booked and no card will be saved.</p>';
      var pend = v.policy_ready ? '' : '<span class="usc-book-pend">Wording pending: not final</span>';
      var rest = h('div', 'usc-book-body');
      rest.innerHTML = test +
        '<p class="usc-book-note">Type your card in Square\'s secure form below. Uni never sees or hears your card.</p>' +
        '<div class="usc-sqcard" id="' + id + '"></div>' +
        '<div class="usc-policy"><b>Cancellation and no-show policy</b> ' + pend + '<p>' + esc(v.policy) + '</p></div>' +
        '<label class="usc-consent"><input type="checkbox"> <span>I agree to this policy and to the spa saving this card on file in Square for this booking.</span></label>' +
        '<div class="usc-book-row"><button type="button" class="usc-vbtn usc-vend usc-book-go" disabled><span>Book</span></button>' +
        '<button type="button" class="usc-vbtn usc-book-no"><span>Cancel</span></button></div>' +
        '<p class="usc-book-st" aria-live="polite"></p>';
      box.appendChild(rest); scroll();
      var go = rest.querySelector('.usc-book-go'), no = rest.querySelector('.usc-book-no'), tick = rest.querySelector('.usc-consent input'), st = rest.querySelector('.usc-book-st');
      function ready() { go.disabled = !(tick.checked && b.card && !b.busy && !b.done); }
      tick.addEventListener('change', ready);
      no.addEventListener('click', function () {
        if (b.busy || b.done) return;
        b.done = true; closeBooking(); rest.remove(); sum.textContent = 'Card form closed. Nothing was booked.';
        tellUni('Not booked: the guest closed the card form.');
      });
      go.addEventListener('click', function () { if (!go.disabled) submit(); });
      function submit() {
        b.busy = true; ready(); st.textContent = 'Saving your card securely…';
        var details = { intent: 'STORE', customerInitiated: true, sellerKeyedIn: false,
          billingContact: { givenName: v.given_name || '', familyName: v.family_name || '', email: v.email || '' } };
        Promise.resolve().then(function () { return b.card.tokenize(details); }).then(function (t) {
          if (!t || t.status !== 'OK' || !t.token) { var e = new Error('tokenize'); e.user = true; throw e; }
          // Newer SDKs verify the buyer (SCA) inside tokenize(details); older ones need verifyBuyer for a STORE token.
          if (b.payments && typeof b.payments.verifyBuyer === 'function' && !(t.details && t.details.verification)) {
            return b.payments.verifyBuyer(t.token, details).then(function (vr) { return { token: t.token, verification: vr && vr.token }; }, function () { return { token: t.token }; });
          }
          return { token: t.token };
        }).then(function (tok) {
          st.textContent = 'Booking…';
          var body = { intent: v.intent, card_token: tok.token, consent: true };
          if (tok.verification) body.verification_token = tok.verification;
          return postJson(BOOK_API, body);
        }).then(function (res) {
          b.busy = false;
          var d = res.d || {};
          if (res.ok && d.ok && d.booked) {
            b.done = true; closeBooking(); rest.remove();
            var line = 'Booked: ' + d.booked.service + ', ' + d.booked.time + ' at ' + d.booked.spa + '.' + (d.dry_run ? ' (Test only: nothing was really booked.)' : ' A confirmation comes from Square.') + (typeof d.notice === 'string' && d.notice ? ' ' + d.notice : '');
            sum.innerHTML = '<b>' + (d.dry_run ? 'Test complete (nothing booked)' : 'Booked') + '</b><br>' + esc(d.booked.service) + '<br>' + esc(d.booked.time) + ' (Pacific) · ' + esc(d.booked.spa) + (typeof d.notice === 'string' && d.notice ? '<br>' + esc(d.notice) : '');
            tellUni(line);
            return;
          }
          var again = d.reason === 'card_declined' || d.reason === 'verification_required' || d.reason === 'calendar_unavailable';
          st.textContent = d.message || 'We couldn\'t complete the booking. Please call (858) 293-8900.';
          if (again) { ready(); return; } // the guest may fix the card and press Book again; never automatic
          b.done = true; closeBooking(); rest.querySelector('.usc-sqcard').remove(); ready(); no.remove();
          tellUni('Not booked: ' + st.textContent);
        }).catch(function (e) {
          b.busy = false;
          st.textContent = e && e.user ? 'Please check the card details and try again.' : 'Connection problem. Nothing was booked. Please try again or call (858) 293-8900.';
          ready();
        });
      }
      return loadSquare(v.sdk_url).then(function (Sq) {
        b.payments = Sq.payments(v.app_id, v.location_id);
        return b.payments.card();
      }).then(function (card) {
        if (booking !== b) { try { card.destroy(); } catch (e) {} return 'Replaced by a newer card form.'; }
        b.card = card;
        return card.attach('#' + id).then(function () { ready(); scroll(); return 'The secure card form is on the guest\'s screen. Not booked yet: wait for booking_result.'; });
      }).catch(function () {
        rest.remove(); return fail('The secure card form couldn\'t load. Please book online or call (858) 293-8900.');
      });
    }, function () { return fail('Connection problem. Please book online or call (858) 293-8900.'); });
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
