/* ================================================================
   _shared/donate-popin.js — Canonical "Get Apps" pop-in
   ----------------------------------------------------------------
   Source of truth: app.zigmoon.com / index.html (2026-05-04 redesign,
   one-time €24 collection unlock).
   Inject into any app via:
     <script src="../_shared/donate-popin.js" defer></script>
   Then call window.openDonateModal() from any trigger.
   Idempotent: safe to load multiple times.
   ================================================================ */
(function () {
  if (window.openDonateModal) return; // idempotent
  if (document.getElementById('donate-overlay')) return; // markup already present

  /* ---------- CSS (lifted verbatim from index.html) ---------- */
  var css = `
#donate-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.78);
  display: flex; align-items: center; justify-content: center;
  z-index: 9999;
  opacity: 0; pointer-events: none;
  transition: opacity 0.35s ease;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
#donate-overlay.visible { opacity: 1; pointer-events: auto; }
#donate-overlay .donate-shell {
  display: flex; flex-direction: column; align-items: flex-end;
  gap: 12px; width: min(460px, 90vw);
}
#donate-overlay #donate-box {
  background: #0a0a0a; color: #f0f0f0;
  border: 1px solid #1f1f1f; border-radius: 12px;
  max-width: none; width: 100%; position: relative;
  font-family: 'IBM Plex Mono', 'Space Mono', monospace;
  overflow: hidden; box-shadow: 0 14px 60px rgba(0, 0, 0, 0.55);
  transform: translateY(18px); transition: transform 0.35s ease;
  max-height: 92vh; overflow-y: auto;
}
#donate-overlay.visible #donate-box { transform: translateY(0); }
#donate-overlay .donate-speed-banner {
  display: block; text-align: center;
  padding: 1.4rem 1.2rem 1.2rem;
  background: #080808; border-bottom: 1px solid #1a1a1a;
  color: #fff; line-height: 1.05;
  font-family: 'IBM Plex Mono', 'Space Mono', monospace;
}
#donate-overlay .donate-speed-banner .speed-figure {
  display: block; font-size: 44px; font-weight: 800;
  letter-spacing: -1px; color: #fff;
}
#donate-overlay .donate-speed-banner .speed-figure em { color: #fff; font-style: normal; }
#donate-overlay .donate-speed-banner .speed-label {
  display: block; margin-top: 6px;
  font-size: 11px; letter-spacing: 4px; text-transform: uppercase;
  color: #cfcfcf; opacity: 0.85;
}
#donate-overlay #donate-box-body {
  background: #050505; color: #f0f0f0;
  padding: 1.6rem 2.2rem 1.8rem;
  display: flex; flex-direction: column; align-items: stretch;
  gap: 14px; border-top: 1px solid #1a1a1a;
}
#donate-overlay .donate-shell .donate-close {
  position: static; align-self: flex-end;
  background: rgba(20,20,20,0.92); border: 1px solid #2a2a2a;
  padding: 8px 14px; border-radius: 999px;
  font-size: 11px; letter-spacing: 2px; text-transform: uppercase;
  cursor: pointer; color: #e5e5e5; opacity: 0.9;
  font-family: inherit; line-height: 1;
  transition: opacity 0.15s, background 0.15s, border-color 0.15s;
}
#donate-overlay .donate-shell .donate-close:hover { opacity: 1; background: #1a1a1a; border-color: #3a3a3a; }
#donate-overlay #donate-box .donate-skip {
  background: none; border: none; color: #999;
  font-size: 11px; letter-spacing: 1px; cursor: pointer;
  padding: 6px; margin-top: 2px; opacity: 0.6;
  font-family: inherit; transition: opacity 0.15s;
}
#donate-overlay #donate-box .donate-skip:hover { opacity: 1; text-decoration: underline; }
@media (max-width: 600px) {
  #donate-overlay .donate-shell { width: min(420px, 94vw); gap: 8px; max-height: 92vh; max-height: 92dvh; }
  #donate-overlay #donate-box { max-height: 86vh; max-height: 86dvh; overflow-y: auto; -webkit-overflow-scrolling: touch; }
  #donate-overlay .donate-speed-banner { padding: 12px 14px; }
  #donate-overlay .donate-speed-banner .speed-figure { font-size: 26px; }
  #donate-overlay .donate-speed-banner .speed-label { margin-top: 3px; font-size: 9px; letter-spacing: 2px; }
  #donate-overlay #donate-box-body { padding: 0.9rem 1.1rem 1rem; gap: 8px; }
  #donate-overlay .donate-shell .donate-close { padding: 6px 12px; font-size: 10px; letter-spacing: 1.5px; }
  #donate-overlay #donate-box .donate-skip { font-size: 10px; padding: 4px; margin-top: 0; }
}

/* 2026-05-04: hard-hide every known legacy donate overlay across the fleet,
   so users never see the obsolete dark-matte / wrong-typography pop-in even
   if some legacy code path tries to open it. The canonical pop-in
   (#donate-overlay) is the single source of truth. */
[id$="-donate-overlay"]:not(#donate-overlay),
#pay-backdrop, #pay-overlay, #paypal-modal, #pwa-install-overlay {
  display: none !important;
}
`;
  var style = document.createElement('style');
  style.setAttribute('data-donate-popin', '1');
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- HTML markup (mirrors index.html) ---------- */
  var html = `
<div id="donate-overlay" role="dialog" aria-modal="true" aria-label="Unlock every app — €24 one-time">
  <div class="donate-shell">
    <button class="donate-close" id="donate-close-btn" aria-label="Close">✕ close</button>
    <div id="donate-box">
      <div class="donate-speed-banner" aria-hidden="true">
        <span class="speed-figure"><em>75%+</em> FASTER</span>
        <span class="speed-label">installed app vs browser</span>
      </div>
      <div id="donate-box-body">
        <div id="paypal-subscribe-container" style="min-height:48px;width:100%;background:#000;border-radius:8px;padding:6px;box-sizing:border-box;"></div>
        <p style="font-size:10px;line-height:1.6;color:#888;margin:0;text-align:center;letter-spacing:0.5px;">
          Install unlocks automatically once the payment is approved.<br>One-time payment — no subscription, no recurring charge.
        </p>
        <button class="donate-skip" id="donate-skip-btn">No thanks — keep using the free web versions</button>
        <details style="margin-top:8px;width:100%;">
          <summary style="font-size:9px;letter-spacing:2px;text-transform:uppercase;opacity:0.35;cursor:pointer;outline:none;list-style:none;text-align:center;color:#999;">have a code?</summary>
          <div style="display:flex;gap:6px;margin-top:10px;">
            <input type="text" id="donate-code" placeholder="Promo code" autocomplete="off" spellcheck="false"
                   style="flex:1;background:#000;border:1px solid #1a1a1a;color:#fff;padding:8px 10px;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:2px;border-radius:4px;outline:none;text-transform:uppercase;" />
            <button id="donate-code-btn" type="button"
                    style="background:#1a1a1a;border:1px solid #333;color:#fff;padding:8px 14px;font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:1px;text-transform:uppercase;border-radius:4px;cursor:pointer;">OK</button>
          </div>
          <div id="donate-code-msg" style="font-size:10px;color:#ff6b6b;margin-top:6px;min-height:12px;text-align:center;letter-spacing:0.5px;"></div>
        </details>
      </div>
    </div>
  </div>
</div>`;

  function inject() {
    if (document.getElementById('donate-overlay')) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = html.trim();
    while (tmp.firstChild) document.body.appendChild(tmp.firstChild);
    wireUp();
  }

  /* ---------- Behaviour (mirrors index.html) ---------- */
  var STORAGE_KEY    = 'zm_subscribe_seen';
  var SUBSCRIBED_KEY = 'zigmoon_subscribed_v1';
  var VALID_CODES    = ['808316'];

  var paypalSdkPromise = null;
  function loadPaypalSdk() {
    if (paypalSdkPromise) return paypalSdkPromise;
    paypalSdkPromise = new Promise(function (resolve, reject) {
      if (window.paypal && window.paypal.HostedButtons) { resolve(window.paypal); return; }
      var s = document.createElement('script');
      s.src = 'https://www.paypal.com/sdk/js?client-id=BAAquYvIhLx-TZn41GHOZViIFLsBZAHw5qCpMSiwnh-UxVNGfQ4dcaKXu7dir8JGoogPhAGSupxrlEUfBY&components=hosted-buttons&disable-funding=venmo&currency=EUR';
      s.async = true;
      s.onload  = function () { resolve(window.paypal); };
      s.onerror = function () { paypalSdkPromise = null; reject(new Error('PayPal SDK failed to load')); };
      document.head.appendChild(s);
    });
    return paypalSdkPromise;
  }

  var btnRendered = false;
  function renderSubscribeButton() {
    var container = document.getElementById('paypal-subscribe-container');
    if (!container || btnRendered) return;
    loadPaypalSdk().then(function (paypal) {
      if (!paypal || btnRendered) return;
      btnRendered = true;
      paypal.HostedButtons({ hostedButtonId: 'DHFGPJBRF88Q4' })
        .render('#paypal-subscribe-container');
      var onPaypalMsg = function (ev) {
        try {
          if (!ev || !ev.origin) return;
          if (!/paypal\.com$/.test(new URL(ev.origin).hostname)) return;
          var d = ev.data;
          var txt = (typeof d === 'string') ? d : (d ? JSON.stringify(d) : '');
          if (/COMPLETED|payment\.captured|onApprove|order\.approved/i.test(txt)) {
            try { localStorage.setItem(SUBSCRIBED_KEY, '1'); } catch (_) {}
            container.innerHTML = '<p style="font-size:11px;text-align:center;letter-spacing:0.5px;color:#9de9ba;">Payment approved — thank you! You can now install the apps from each app\u2019s install button.</p>';
            window.removeEventListener('message', onPaypalMsg);
          }
        } catch (_) {}
      };
      window.addEventListener('message', onPaypalMsg);
    }).catch(function () {
      container.innerHTML = '<p style="font-size:10px;color:#ff6b6b;text-align:center;letter-spacing:0.5px;">PayPal could not load. Try a promo code below or check your connection.</p>';
    });
  }

  function openDonateModal() {
    var overlay = document.getElementById('donate-overlay');
    if (!overlay) return;
    overlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
    renderSubscribeButton();
  }
  function closeDonateModal() {
    var overlay = document.getElementById('donate-overlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    document.body.style.overflow = '';
  }
  window.openDonateModal  = openDonateModal;
  window.closeDonateModal = closeDonateModal;

  function wireUp() {
    var overlay = document.getElementById('donate-overlay');
    if (!overlay) return;

    var codeInput = document.getElementById('donate-code');
    var codeBtn   = document.getElementById('donate-code-btn');
    var codeMsg   = document.getElementById('donate-code-msg');
    function tryCode() {
      if (!codeInput) return;
      var v = (codeInput.value || '').trim();
      if (VALID_CODES.indexOf(v) !== -1) {
        try { localStorage.setItem(SUBSCRIBED_KEY, '1'); } catch (_) {}
        if (codeMsg) { codeMsg.style.color = '#9de9ba'; codeMsg.textContent = 'Code accepted — enjoy the install!'; }
        setTimeout(closeDonateModal, 900);
      } else if (v.length > 0) {
        if (codeMsg) { codeMsg.style.color = '#ff6b6b'; codeMsg.textContent = 'Invalid code'; }
      }
    }
    if (codeBtn)   codeBtn.addEventListener('click', tryCode);
    if (codeInput) codeInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); tryCode(); } });

    var closeBtn = document.getElementById('donate-close-btn');
    var skipBtn  = document.getElementById('donate-skip-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeDonateModal);
    if (skipBtn)  skipBtn.addEventListener('click', closeDonateModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeDonateModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && overlay.classList.contains('visible')) closeDonateModal(); });
  }

  /* ---------- Hijack legacy app-specific pop-ins (cam-, ctf-, k2-, mat-, sp-,
       pdfz-, vizion-, zord-, prez/pay-backdrop, …) so that ANY trigger opens
       the canonical pop-in instead of the legacy one. ---------- */

  // ALL known install button selectors across the fleet.
  // Order matters: most specific first. We intentionally include bare
  //   #install-btn / #installBtn / #installPwaBtn variants so non-prefixed
  //   apps (PREZ, MAILMAX, TYPOVIDEO, CUTTHEFLOW, COSTGENERATOR…) are caught.
  var INSTALL_BTN_SELECTOR = [
    '[id$="-install-btn"]',
    '#install-btn',
    '#installBtn',
    '#installPwaBtn',
    '#mobileInstallPwaBtn',
    '#install-button',
    '[data-zm-install-trigger]'
  ].join(',');

  // ALL known legacy overlay selectors. Anything matching is hidden + its
  //   classList.add('visible'/'show'/'open') is patched to open the canonical
  //   pop-in instead.
  var LEGACY_OVERLAY_SELECTOR = [
    '[id$="-donate-overlay"]',
    '#pay-backdrop',
    '#pay-overlay',
    '#paypal-modal',
    '#pwa-install-overlay'
  ].join(',');

  // ALL known legacy PayPal container selectors. We rename them so the
  //   legacy code's getElementById('paypal-container') returns null and its
  //   render path aborts cleanly.
  var LEGACY_PAYPAL_SELECTOR = [
    '[id$="-paypal-container"]',
    '[id$="-paypal-subscribe-container"]',
    '#paypal-container'                  // bare (PREZ)
  ].join(',');

  function hasPaid() {
    try { return localStorage.getItem(SUBSCRIBED_KEY) === '1'; } catch (_) { return false; }
  }

  function hijackLegacyOverlays() {
    // 1) Disable legacy PayPal containers so legacy code's render path aborts.
    //    SAFETY: only disable containers that live INSIDE a legacy donate
    //    overlay — never touch standalone PayPal containers used for other
    //    purposes (e.g. MAILMAX credit-pack checkout in `#cmm-paypal-container`).
    var ppNodes = document.querySelectorAll(LEGACY_PAYPAL_SELECTOR);
    Array.prototype.forEach.call(ppNodes, function (el) {
      if (!el) return;
      // Never disable the canonical container.
      if (el.id === 'paypal-subscribe-container') return;
      // Never disable a container that lives INSIDE the canonical pop-in.
      if (el.closest && el.closest('#donate-overlay')) return;
      // Only disable when nested inside a known legacy overlay — protects
      //   unrelated PayPal flows (credit packs, top-ups, etc.).
      if (!(el.closest && el.closest(LEGACY_OVERLAY_SELECTOR))) return;
      el.id = el.id + '__zm_disabled';
    });

    // 2) Hide legacy overlays + intercept any classList.add('visible' | 'show'
    //    | 'open' | 'is-open' | 'active') so legacy "open" calls route to the
    //    canonical pop-in.
    var OPEN_CLASSES = ['visible', 'show', 'open', 'is-open', 'active'];
    var nodes = document.querySelectorAll(LEGACY_OVERLAY_SELECTOR);
    Array.prototype.forEach.call(nodes, function (el) {
      if (!el || el.id === 'donate-overlay' || el.dataset.zmHijacked) return;
      el.dataset.zmHijacked = '1';
      el.style.setProperty('display', 'none', 'important');
      var list = el.classList;
      var origAdd = list.add.bind(list);
      list.add = function () {
        for (var i = 0; i < arguments.length; i++) {
          if (OPEN_CLASSES.indexOf(arguments[i]) !== -1) {
            try { window.openDonateModal(); } catch (_) {}
            return;
          }
        }
        return origAdd.apply(null, arguments);
      };
    });

    // 3) Capture-phase click listener on every install button variant.
    //    If the user has already paid (€24 unlock), let the original handler
    //    run (so the native PWA install prompt can fire). Otherwise gate the
    //    click and open the canonical pop-in instead.
    document.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest && ev.target.closest(INSTALL_BTN_SELECTOR);
      if (!t) return;
      if (t.dataset.zmInstallHijacked) return;
      // If a button lives inside the canonical pop-in itself, never hijack.
      if (t.closest && t.closest('#donate-overlay')) return;
      if (hasPaid()) return; // user paid → allow native install flow
      ev.preventDefault();
      ev.stopImmediatePropagation();
      try { window.openDonateModal(); } catch (_) {}
    }, true);
  }

  /* ---------- Auto-trigger (visit counter, mirrors index.html) ---------- */
  function scheduleAutoPrompt() {
    try { if (localStorage.getItem(SUBSCRIBED_KEY) === '1') return; } catch (_) {}
    var data;
    try { data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) { data = null; }
    var now = Date.now();
    if (!data) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ visits: 1, lastSeen: 0 })); } catch (_) {}
      return;
    }
    data.visits = (data.visits || 0) + 1;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
    if (data.visits < 4) return;
    if (data.lastSeen && (now - data.lastSeen) < 14 * 24 * 60 * 60 * 1000) return;
    var triggered = false;
    function onScrollTrigger() {
      if (triggered) return;
      if (window.scrollY > 300) {
        triggered = true;
        data.lastSeen = Date.now();
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
        window.removeEventListener('scroll', onScrollTrigger);
        openDonateModal();
      }
    }
    window.addEventListener('scroll', onScrollTrigger, { passive: true });
  }

  /* ---------- Bootstrap ---------- */
  function bootstrap() {
    inject();
    hijackLegacyOverlays();
    scheduleAutoPrompt();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
