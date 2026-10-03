/*
 * Analytics consent gate + Datadog RUM loader (KAN-292 / RCP-101).
 *
 * ONE script, shared by the Angular SPA (index.html) and the Flask SSR pages
 * (Backend templates/public/base_public.html). Both are served from the same
 * origin, so the consent choice lives in ONE localStorage key and a choice made
 * on /r/<slug> holds in /kitchen and vice versa.
 *
 * Guarantees (unit-tested in src/rum-consent.test.ts):
 *   - Until the visitor clicks "Allow analytics", the Datadog SDK is never
 *     requested, never initialised, and nothing is sent to /rum/intake.
 *   - The SDK is served same-origin (/rum/datadog-rum-slim.js, copied out of
 *     node_modules at build time) and posts to the same-origin intake proxy
 *     (/rum/intake), so the CSP keeps script-src and connect-src at 'self'.
 *   - RUM Measure only: the slim build carries no Session Replay recorder, and
 *     sessionReplaySampleRate is pinned to 0 anyway.
 *   - The choice is withdrawable: any element with [data-analytics-settings]
 *     reopens the banner; withdrawing stops the session and reloads the page
 *     so the SDK is gone. Those controls ship `hidden` and are revealed only
 *     when RUM is configured.
 *   - When the server has no RUM application configured (/rum/config answers
 *     {enabled:false}), no banner is shown: there is nothing to consent to.
 *
 * Public API for the SPA: window.tlgAnalytics.action(name, context) — a no-op
 * unless consent is granted; queued until the SDK has loaded.
 */
(function () {
  'use strict';

  var CONSENT_KEY = 'tlg.analytics-consent';
  var LANDING_KEY = 'tlg.analytics-landing';
  var PENDING_ACTIONS_KEY = 'tlg.analytics-pending-actions';
  // One-shot confirmation that survives the reload a withdrawal triggers.
  var NOTICE_KEY = 'tlg.analytics-notice';
  var CONFIG_URL = '/rum/config';
  var SDK_URL = '/rum/datadog-rum-slim.js';
  var INTAKE_PATH = '/rum/intake';
  var SITE = 'us5.datadoghq.com';
  var MAX_QUEUE = 50;
  // The documented allowlist (privacy policy section 3.4). Every read and
  // write below iterates these constants, never key names taken from a URL,
  // so an unknown utm_* parameter can carry nothing to Datadog.
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  var SSR_RECIPE_PATH = /^\/r\/([a-z0-9-]{1,200})$/;

  var config = null;
  // 'cancelled': the script loaded while consent was withdrawn, so it was
  // not initialized; a later grant initializes it without refetching.
  var sdkState = 'idle'; // idle | loading | cancelled | ready | failed
  var queue = [];
  var banner = null;
  var returnFocus = null;
  // The current page's explicit choice takes precedence when browser storage
  // is unavailable. In particular, a denied choice must fail closed even if a
  // stale persisted grant cannot be read or replaced.
  var pageConsent = null;
  // A denial explicitly chosen on this page must not be overridden by a grant
  // in another tab. Remote withdrawals are different: a later remote grant
  // should restore every tab that followed that shared withdrawal.
  var localDenial = false;
  var consentGrantedListeners = [];
  var grantPendingConfig = false;

  function getStore(name) {
    try {
      return window[name];
    } catch (e) {
      return null;
    }
  }

  function readStore(store, key) {
    try {
      return store ? store.getItem(key) : null;
    } catch (e) {
      return null;
    }
  }

  function writeStore(store, key, value) {
    try {
      if (!store) return false;
      store.setItem(key, value);
      return true;
    } catch (e) {
      /* storage disabled: the choice lasts for this page only */
      return false;
    }
  }

  function removeStore(store, key) {
    try {
      if (!store) return false;
      store.removeItem(key);
      return true;
    } catch (e) {
      /* storage disabled */
      return false;
    }
  }

  // Value of one allowlisted key from URLSearchParams, or null.
  function utmValue(params, key) {
    if (!params || typeof params.get !== 'function') return null;
    var v = params.get(key);
    return v ? String(v).slice(0, 200) : null;
  }

  var localStore = getStore('localStorage');
  var sessionStore = getStore('sessionStorage');

  function consentState() {
    if (pageConsent === 'granted' || pageConsent === 'denied') return pageConsent;
    var v = readStore(localStore, CONSENT_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  }

  function onConsentGranted(listener) {
    if (typeof listener !== 'function') return function () {};
    consentGrantedListeners.push(listener);
    return function () {
      var index = consentGrantedListeners.indexOf(listener);
      if (index !== -1) consentGrantedListeners.splice(index, 1);
    };
  }

  function notifyConsentGranted() {
    var listeners = consentGrantedListeners.slice();
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i]();
      } catch (e) {
        /* analytics callbacks must never break consent handling */
      }
    }
  }

  function clearQueue() {
    queue = [];
    removeStore(sessionStore, PENDING_ACTIONS_KEY);
  }

  function persistQueue() {
    if (consentState() !== 'granted' || queue.length === 0) {
      removeStore(sessionStore, PENDING_ACTIONS_KEY);
      return;
    }
    try {
      writeStore(sessionStore, PENDING_ACTIONS_KEY, JSON.stringify(queue.slice(0, MAX_QUEUE)));
    } catch (e) {
      /* JSON/storage failure: keep the in-memory queue only */
    }
  }

  // Only the custom actions this site emits may be replayed from storage; a
  // tampered pending-actions entry cannot inject arbitrary Datadog actions.
  var RESTORABLE_ACTIONS = ['recipe_view', 'recipe_save_click', 'recipe_saved'];

  function restoreQueue() {
    if (consentState() !== 'granted') {
      removeStore(sessionStore, PENDING_ACTIONS_KEY);
      return;
    }
    var raw = readStore(sessionStore, PENDING_ACTIONS_KEY);
    if (!raw) return;
    try {
      var saved = JSON.parse(raw);
      if (!Array.isArray(saved)) throw new Error('invalid pending action queue');
      for (var i = 0; i < saved.length && queue.length < MAX_QUEUE; i++) {
        var item = saved[i];
        if (
          Array.isArray(item) &&
          typeof item[0] === 'string' &&
          RESTORABLE_ACTIONS.indexOf(item[0]) !== -1 &&
          item[1] &&
          typeof item[1] === 'object' &&
          !Array.isArray(item[1])
        ) {
          queue.push([item[0], item[1]]);
        }
      }
      persistQueue();
    } catch (e) {
      removeStore(sessionStore, PENDING_ACTIONS_KEY);
    }
  }

  restoreQueue();

  /*
   * Launch-referral attribution, captured synchronously at script start —
   * before Angular's router or the ?save= guard rewrites the URL. Kept in
   * memory until consent is granted. Only then is it persisted in
   * sessionStorage for later pages and sent as RUM global context. The
   * referrer is reduced to origin + path so a query string on the referring
   * page is never kept.
   */
  function captureLanding() {
    var canPersist = consentState() === 'granted';
    var existing = canPersist ? readStore(sessionStore, LANDING_KEY) : null;
    if (existing) {
      try {
        return JSON.parse(existing);
      } catch (e) {
        /* fall through and recapture */
      }
    }
    var landing = { landing_path: window.location.pathname, referrer: null };
    var ref = document.referrer;
    if (ref) {
      try {
        var u = new URL(ref);
        if (u.host !== window.location.host) landing.referrer = u.origin + u.pathname;
      } catch (e) {
        /* unparseable referrer: leave null */
      }
    }
    var params = null;
    try {
      params = new URLSearchParams(window.location.search);
    } catch (e) {
      params = null;
    }
    for (var i = 0; i < UTM_KEYS.length; i++) {
      var val = utmValue(params, UTM_KEYS[i]);
      if (val) landing[UTM_KEYS[i]] = val;
    }
    if (canPersist) writeStore(sessionStore, LANDING_KEY, JSON.stringify(landing));
    return landing;
  }

  var landing = captureLanding();

  /*
   * Datadog's built-in URL fields (view.url, view.referrer, resource.url, ...)
   * carry full query strings and fragments. Reduce every one to origin + path,
   * keeping only the utm_* allowlist for our own origin; a foreign URL (e.g.
   * the referrer) keeps no query at all. Unparseable values are dropped.
   */
  function sanitizeUrl(value) {
    if (typeof value !== 'string' || !value) return value;
    var u;
    try {
      u = new URL(value, window.location.origin);
    } catch (e) {
      return '';
    }
    // URL.origin is the literal string "null" for data:, blob:, javascript:,
    // and other opaque schemes, while URL.pathname can contain the complete
    // inline payload. Only network URLs are safe to retain in telemetry.
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    var out = u.origin + u.pathname;
    if (u.origin === window.location.origin) {
      var kept = [];
      for (var i = 0; i < UTM_KEYS.length; i++) {
        var v = utmValue(u.searchParams, UTM_KEYS[i]);
        if (v) kept.push(UTM_KEYS[i] + '=' + encodeURIComponent(v));
      }
      if (kept.length) out += '?' + kept.join('&');
    }
    return out;
  }

  // Host and path stop at quotes, but once a query or fragment starts the
  // match runs to the next whitespace, so quoted and parenthesised values
  // (?email='a@b', ?q=(x)) are captured whole and then dropped by
  // sanitizeUrl. Only UNBALANCED trailing wrappers (a stack frame's "(...)",
  // a quoted URL's closing quote, sentence punctuation) are peeled off and
  // put back after sanitizing.
  var URL_IN_TEXT = /https?:\/\/[^\s"'<>?#]+(?:[?#][^\s<>]*)?/g;

  function count(str, ch) {
    return str.split(ch).length - 1;
  }

  function isUnbalancedTail(str) {
    var last = str.slice(-1);
    if (last === ')') return count(str, ')') > count(str, '(');
    if (last === '"' || last === "'") return count(str, last) % 2 === 1;
    return last === '.' || last === ',' || last === ';' || last === ':';
  }

  function scrubUrlsInText(text) {
    if (typeof text !== 'string' || !text) return text;
    return text.replace(URL_IN_TEXT, function (match) {
      var suffix = '';
      while (match.length && isUnbalancedTail(match)) {
        suffix = match.slice(-1) + suffix;
        match = match.slice(0, -1);
      }
      return sanitizeUrl(match) + suffix;
    });
  }

  function beforeSend(event) {
    if (event.view) {
      event.view.url = sanitizeUrl(event.view.url);
      event.view.referrer = sanitizeUrl(event.view.referrer);
      if (event.view.performance && event.view.performance.lcp) {
        event.view.performance.lcp.resource_url = sanitizeUrl(
          event.view.performance.lcp.resource_url
        );
      }
    }
    if (event.resource) event.resource.url = sanitizeUrl(event.resource.url);
    if (event.error) {
      if (event.error.resource) {
        event.error.resource.url = sanitizeUrl(event.error.resource.url);
      }
      // Error text can embed a full URL (e.g. a failed fetch naming
      // location.href); scrub every absolute URL inside it the same way.
      event.error.message = scrubUrlsInText(event.error.message);
      event.error.stack = scrubUrlsInText(event.error.stack);
      event.error.handling_stack = scrubUrlsInText(event.error.handling_stack);
      // error.causes[] is NOT in SDK 7.15's modifiable fields for beforeSend
      // (browser-rum-core assembly.ts), so edits there would be discarded.
      // If any chained cause carries a URL the scrub would change, drop the
      // whole error event rather than send it.
      var causes = event.error.causes;
      if (causes && causes.length) {
        for (var c = 0; c < causes.length; c++) {
          var cause = causes[c] || {};
          if (
            scrubUrlsInText(cause.message) !== cause.message ||
            scrubUrlsInText(cause.stack) !== cause.stack
          ) {
            return false;
          }
        }
      }
    }
    return true;
  }

  function flushQueue() {
    var rum = window.DD_RUM;
    if (!rum) return;
    while (queue.length) {
      var item = queue[0];
      try {
        rum.addAction(item[0], item[1]);
      } catch (e) {
        // Leave this action and the remainder persisted for the next page.
        return;
      }
      queue.shift();
      persistQueue();
    }
  }

  function loadSdk() {
    if (!config || !config.enabled) return;
    if (sdkState === 'cancelled') {
      // Granted again after a load that finished during a withdrawal.
      if (consentState() === 'granted') initSdk();
      return;
    }
    if (sdkState !== 'idle') return;
    sdkState = 'loading';
    var script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = function () {
      // Consent can be withdrawn while the SDK script is in flight: keep the
      // loaded script uninitialized and recoverable (#3587 review), not
      // 'failed', so a later grant on this page can still start it.
      if (consentState() !== 'granted') {
        sdkState = 'cancelled';
        clearQueue();
        return;
      }
      initSdk();
    };
    script.onerror = function () {
      sdkState = 'failed';
      clearQueue();
    };
    document.head.appendChild(script);
  }

  function initSdk() {
    var rum = window.DD_RUM;
    if (!rum) {
      sdkState = 'failed';
      clearQueue();
      return;
    }
    rum.init({
      applicationId: config.applicationId,
      clientToken: config.clientToken,
      site: SITE,
      service: config.service,
      env: config.env,
      version: config.version,
      proxy: window.location.origin + INTAKE_PATH,
      sessionSampleRate: config.sessionSampleRate,
      sessionReplaySampleRate: 0,
      // Automatic click actions are named from element text, which here
      // includes user-owned values (profile name, recipe and cookbook
      // names). The readout needs only the explicit custom actions.
      trackUserInteractions: false,
      trackResources: true,
      trackLongTasks: true,
      defaultPrivacyLevel: 'mask',
      sessionPersistence: 'local-storage',
      beforeSend: beforeSend,
    });
    rum.setGlobalContextProperty('launch', landing);
    sdkState = 'ready';
    flushQueue();
  }

  // Actions raised before /rum/config answers (config === null) are queued
  // too — a cold SPA deep link renders its recipe before that fetch returns.
  // The queue is dropped if the config turns out to be disabled.
  function action(name, context) {
    if (consentState() !== 'granted' || (config && !config.enabled)) return;
    if (sdkState === 'ready') {
      window.DD_RUM.addAction(name, context || {});
      return;
    }
    if (sdkState === 'failed') return;
    if (queue.length < MAX_QUEUE) {
      queue.push([name, context || {}]);
      persistQueue();
    }
  }

  function closeBanner(restoreFocus) {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
    if (restoreFocus && returnFocus && typeof returnFocus.focus === 'function') {
      returnFocus.focus();
    }
    returnFocus = null;
  }

  function choose(state) {
    var previous = consentState();
    pageConsent = state;
    localDenial = state === 'denied';
    var stored = writeStore(localStore, CONSENT_KEY, state);
    // A failed denial write must not leave a stale persisted grant. Removing
    // the key is also fail-closed: the next page shows the choice without
    // loading RUM.
    if (state === 'denied' && !stored) {
      stored = removeStore(localStore, CONSENT_KEY);
    }
    closeBanner(true);
    if (state === 'granted') {
      applyGrant(previous);
      showNotice(state, true);
      return;
    }
    shutDown();
    // Reload only when denial is safely persisted (or a stale grant was
    // removed). If both operations are blocked, stay on this stopped,
    // fail-closed page instead of reactivating a stale grant on reload.
    // Reload also needs the one-shot confirmation stored, or the withdrawal
    // would go unconfirmed; shutDown() has already stopped collection, so
    // staying on this page and confirming here is just as safe.
    if (sdkState !== 'idle' && stored && writeStore(sessionStore, NOTICE_KEY, state)) {
      window.location.reload();
      return;
    }
    showNotice(state, true);
  }

  // Confirm the choice after the banner closes, so a click is never silent.
  // A polite status region, removed after a few seconds; it holds no controls,
  // so it needs no focus management. The region is mounted EMPTY and filled in
  // a later task: screen readers announce changes to a live region that
  // already exists, and can miss text present when the region is inserted.
  // `withHint` adds the footer instruction, which only makes sense while the
  // "Analytics choice" control is shown (RUM enabled).
  var NOTICE_FILL_DELAY = 100;
  var notice = null;
  function showNotice(state, withHint) {
    if (!document.body) return;
    if (notice && notice.parentNode) notice.parentNode.removeChild(notice);
    notice = document.createElement('div');
    notice.setAttribute('role', 'status');
    notice.setAttribute('data-analytics-notice', '');
    notice.style.cssText =
      'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;max-width:420px;' +
      'margin:0 auto;padding:10px 14px;background:#1c1917;color:#fafaf9;border-radius:10px;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.18);font:14px/1.4 system-ui,sans-serif;text-align:center;';
    var text =
      (state === 'granted' ? 'Analytics allowed.' : 'Analytics off.') +
      (withHint ? ' Change it any time from "Analytics choice" in the footer.' : '');
    document.body.appendChild(notice);
    var shown = notice;
    if (typeof window.setTimeout !== 'function') {
      shown.textContent = text;
      return;
    }
    window.setTimeout(function () {
      if (!shown.parentNode) return;
      // Another tab may have changed consent since the region was mounted:
      // never announce a choice that is no longer in effect, either way.
      var nowGranted = consentState() === 'granted';
      if ((state === 'granted') !== nowGranted) {
        shown.parentNode.removeChild(shown);
        if (notice === shown) notice = null;
        return;
      }
      shown.textContent = text;
      window.setTimeout(function () {
        if (shown.parentNode) shown.parentNode.removeChild(shown);
        if (notice === shown) notice = null;
      }, 5000);
    }, NOTICE_FILL_DELAY);
  }

  function applyGrant(previous) {
    writeStore(sessionStore, LANDING_KEY, JSON.stringify(landing));
    var sdkPresent = sdkState === 'ready' || sdkState === 'cancelled';
    if (sdkPresent && window.DD_RUM && window.DD_RUM.setTrackingConsent) {
      // Re-allowed on a page where it was withdrawn without a reload. Restore
      // SDK consent FIRST: actions added while it is 'not-granted' are dropped.
      window.DD_RUM.setTrackingConsent('granted');
    }
    // The initial SSR view was intentionally dropped before consent. Queue
    // it now so a first-visit grant still has a complete view -> save funnel.
    var slug = ssrRecipeSlug();
    if (slug && previous !== 'granted') {
      action('recipe_view', { surface: 'ssr', slug: slug });
    }
    if (previous !== 'granted') notifyConsentGranted();
    if (sdkState === 'ready') flushQueue();
    loadSdk();
  }

  // Stop everything on this page: queued and persisted pending actions, the
  // landing attribution, and the SDK itself. stopSession() alone is not a
  // withdrawal (the next interaction starts a new session); 'not-granted'
  // stops all collection and sending. An in-flight SDK load is caught by the
  // consent re-check in script.onload.
  function shutDown() {
    clearQueue();
    removeStore(sessionStore, LANDING_KEY);
    if (sdkState !== 'idle') {
      var rum = window.DD_RUM;
      if (rum && rum.setTrackingConsent) rum.setTrackingConsent('not-granted');
      if (rum && rum.stopSession) rum.stopSession();
    }
  }

  // Cross-tab consent. The key is shared by every tab on this origin; the
  // browser fires `storage` only in the OTHER tabs. A withdrawal (or removal /
  // storage.clear()) elsewhere fails this tab closed at once. A grant made
  // elsewhere (e.g. in the privacy-policy tab the Details link opens) applies
  // here only if this page has not made its own choice.
  function onStorage(event) {
    if (!event || (event.key !== CONSENT_KEY && event.key !== null)) return;
    if (event.storageArea && localStore && event.storageArea !== localStore) return;
    var next = event.key === null ? null : event.newValue;
    if (next === 'granted') {
      if (localDenial) return;
      // Release the remote-withdrawal override so the shared stored grant is
      // authoritative again. This also lets consentState() observe it while
      // /rum/config is still pending.
      pageConsent = null;
      if (!config) {
        grantPendingConfig = true;
        return;
      }
      if (!config.enabled) return;
      closeBanner(false);
      applyGrant(null);
      return;
    }
    grantPendingConfig = false;
    pageConsent = 'denied';
    closeBanner(false);
    shutDown();
  }

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('storage', onStorage);
  }

  // `selected` is null before any choice; otherwise true for the button
  // matching the stored choice, which gets aria-pressed and a visible ring.
  function makeButton(label, onClick, primary, selected) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText =
      'margin:0 0 0 8px;padding:6px 14px;border-radius:6px;font:inherit;cursor:pointer;' +
      (primary
        ? 'background:#166534;color:#fff;border:1px solid #166534;'
        : 'background:#fff;color:#1c1917;border:1px solid #a8a29e;') +
      // Selection ring as box-shadow, not outline: an inline outline would
      // replace the native focus outline on the selected button.
      (selected ? 'box-shadow:0 0 0 2px #fafaf9,0 0 0 5px #ca8a04;font-weight:600;' : '');
    if (selected !== null) b.setAttribute('aria-pressed', selected ? 'true' : 'false');
    if (selected) {
      // A visible text marker, not only a ring: on reopen, focus goes to
      // "No thanks" (fail-closed), so after a grant two buttons carry rings and
      // the ring alone cannot say which one is the choice. Hidden from screen
      // readers, which already hear "pressed" from aria-pressed.
      var tag = document.createElement('span');
      tag.setAttribute('aria-hidden', 'true');
      tag.setAttribute('data-analytics-selected', '');
      tag.textContent = ' \u2713 current';
      tag.style.cssText = 'font-size:12px;font-weight:700;';
      b.appendChild(tag);
    }
    if (!primary) b.setAttribute('data-analytics-deny', '');
    b.addEventListener('click', onClick);
    return b;
  }

  function showBanner() {
    if (!config || !config.enabled || banner || !document.body) return;
    var state = consentState();
    var chosen = state === 'granted' || state === 'denied';
    banner = document.createElement('div');
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Analytics choice');
    banner.setAttribute('data-analytics-banner', '');
    banner.style.cssText =
      'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;max-width:640px;' +
      'margin:0 auto;padding:12px 14px;background:#fafaf9;color:#1c1917;' +
      'border:1px solid #d6d3d1;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.12);' +
      'font:14px/1.4 system-ui,sans-serif;display:flex;flex-wrap:wrap;align-items:center;gap:8px;';
    var text = document.createElement('p');
    text.style.cssText = 'margin:0;flex:1 1 280px;';
    text.appendChild(
      document.createTextNode(
        'May we measure page speed and which recipes get saved? Via Datadog, only if you allow it: ' +
          'no ads, no screen recording. '
      )
    );
    var link = document.createElement('a');
    link.href = '/privacy-policy#analytics';
    // A new tab keeps THIS page, and its in-memory landing referrer/UTM, alive
    // while the visitor reads the policy: nothing is sent to Datadog before
    // consent, and a grant made in the policy tab reaches this tab through the
    // storage event (onStorage above).
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Details (opens in a new tab)';
    link.style.cssText = 'color:inherit;text-decoration:underline;';
    text.appendChild(link);
    var actions = document.createElement('div');
    actions.appendChild(
      makeButton(
        'No thanks',
        function () {
          choose('denied');
        },
        false,
        chosen ? state === 'denied' : null
      )
    );
    actions.appendChild(
      makeButton(
        'Allow analytics',
        function () {
          choose('granted');
        },
        true,
        chosen ? state === 'granted' : null
      )
    );
    if (chosen) {
      // Reopened from "Analytics choice": say plainly what is in effect, on
      // its own line, not only through the button styling.
      var current = document.createElement('p');
      current.setAttribute('data-analytics-current', '');
      current.style.cssText = 'margin:0;flex:1 1 100%;font-weight:600;';
      current.textContent =
        'Your current choice: ' +
        (state === 'granted' ? 'analytics allowed.' : 'no analytics ("No thanks").');
      banner.appendChild(current);
    }
    banner.appendChild(text);
    banner.appendChild(actions);
    document.body.appendChild(banner);
  }

  // Deliberate fail-closed keyboard default: focus "No thanks", so an
  // accidental Enter can never opt someone in. Selected by attribute, not DOM
  // order, so reordering the buttons cannot silently invert it.
  function focusDeny() {
    if (!banner) return;
    var deny = banner.querySelector('[data-analytics-deny]');
    if (deny) deny.focus({ preventScroll: true });
  }

  function openSettings(trigger) {
    closeBanner(false);
    returnFocus = trigger && typeof trigger.focus === 'function' ? trigger : null;
    showBanner();
    focusDeny();
  }

  // First display arrives asynchronously after /rum/config, and a role=region
  // inserted later is not announced. Moving focus to the safe choice makes
  // the question perceivable to screen-reader and keyboard users; closing
  // the banner returns focus to whatever had it before.
  function showFirstBanner() {
    var active = document.activeElement;
    showBanner();
    if (!banner) return;
    returnFocus =
      active && active !== document.body && typeof active.focus === 'function' ? active : null;
    focusDeny();
  }

  // SSR surface: a /r/<slug> page is a recipe view, and its save CTA is the
  // start of the view → save funnel (the save itself completes in the SPA).
  function ssrRecipeSlug() {
    var m = window.location.pathname.match(SSR_RECIPE_PATH);
    return m ? m[1] : null;
  }

  // Before consent the landing lives only in this page's memory, so the SSR
  // save link (/?save=<slug>#kitchen) would drop it. Carry ONLY the utm_*
  // tags the visitor arrived with onto that same-origin link. The destination
  // server receives those tags through ordinary navigation, but the URL gains
  // no data it did not already have and nothing is sent to Datadog. The external
  // referrer is deliberately NOT carried (it would put new data in a URL); that
  // journey keeps UTM attribution but not the referrer. After consent the
  // landing is already in sessionStorage, so nothing is needed.
  function carryUtmAcrossSave(link) {
    if (consentState() === 'granted' || !link.getAttribute) return;
    var href = link.getAttribute('href');
    if (!href) return;
    var u;
    try {
      u = new URL(href, window.location.origin);
    } catch (e) {
      return;
    }
    if (u.origin !== window.location.origin) return;
    var changed = false;
    for (var i = 0; i < UTM_KEYS.length; i++) {
      var key = UTM_KEYS[i];
      var val = landing[key];
      if (typeof val === 'string' && val && !u.searchParams.get(key)) {
        u.searchParams.set(key, val);
        changed = true;
      }
    }
    if (changed) link.setAttribute('href', u.pathname + u.search + u.hash);
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var settingsTrigger = target.closest('[data-analytics-settings]');
    if (settingsTrigger) {
      event.preventDefault();
      openSettings(settingsTrigger);
      return;
    }
    var saveLink = target.closest('[data-save-recipe]');
    if (saveLink) {
      action('recipe_save_click', { surface: 'ssr', slug: ssrRecipeSlug() });
      carryUtmAcrossSave(saveLink);
    }
  });

  window.tlgAnalytics = {
    action: action,
    openSettings: openSettings,
    consent: consentState,
    onConsentGranted: onConsentGranted,
  };

  // The "Analytics choice" controls ship with the `hidden` attribute, so a page
  // without RUM (or without JS) never shows a control that does nothing. One
  // style rule reveals them, including ones Angular renders later.
  function revealSettingsControls() {
    var style = document.createElement('style');
    style.textContent = '[data-analytics-settings][hidden]{display:inline !important}';
    document.head.appendChild(style);
  }

  function start() {
    // The withdrawal confirmation is one-shot: read and delete it before
    // anything can return early (no fetch, config failed or disabled), and
    // whatever its value, so it never lingers for a later visit.
    var pendingNotice = readStore(sessionStore, NOTICE_KEY);
    if (pendingNotice !== null) removeStore(sessionStore, NOTICE_KEY);
    // Only a withdrawal reloads, so 'denied' is the one value honoured, and
    // only while consent is still not granted (another tab may have granted
    // it since).
    var replayDenial = pendingNotice === 'denied';
    function confirmWithdrawal(withHint) {
      if (replayDenial && consentState() !== 'granted') showNotice('denied', withHint);
    }
    if (typeof window.fetch !== 'function') {
      confirmWithdrawal(false);
      return;
    }
    window
      .fetch(CONFIG_URL, { credentials: 'same-origin' })
      .then(function (res) {
        return res.ok ? res.json() : { enabled: false };
      })
      .catch(function () {
        return { enabled: false };
      })
      .then(function (cfg) {
        config = cfg && cfg.enabled ? cfg : { enabled: false };
        if (!config.enabled) {
          clearQueue();
          // The footer control stays hidden, so no instruction to use it.
          confirmWithdrawal(false);
          return;
        }
        revealSettingsControls();
        confirmWithdrawal(true);
        var state = consentState();
        if (state === 'granted') {
          if (grantPendingConfig) {
            grantPendingConfig = false;
            writeStore(sessionStore, LANDING_KEY, JSON.stringify(landing));
            notifyConsentGranted();
          }
          loadSdk();
        } else if (state === null) showFirstBanner();
        var slug = ssrRecipeSlug();
        if (slug) action('recipe_view', { surface: 'ssr', slug: slug });
      });
  }

  start();
})();
