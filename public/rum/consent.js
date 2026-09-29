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
  var CONFIG_URL = '/rum/config';
  var SDK_URL = '/rum/datadog-rum-slim.js';
  var INTAKE_PATH = '/rum/intake';
  var SITE = 'us5.datadoghq.com';
  var MAX_QUEUE = 50;
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  var SSR_RECIPE_PATH = /^\/r\/([a-z0-9-]{1,200})$/;

  var config = null;
  var sdkState = 'idle'; // idle | loading | ready | failed
  var queue = [];
  var banner = null;
  var returnFocus = null;
  // The current page's explicit choice takes precedence when browser storage
  // is unavailable. In particular, a denied choice must fail closed even if a
  // stale persisted grant cannot be read or replaced.
  var pageConsent = null;

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

  var localStore = getStore('localStorage');
  var sessionStore = getStore('sessionStorage');

  function consentState() {
    if (pageConsent === 'granted' || pageConsent === 'denied') return pageConsent;
    var v = readStore(localStore, CONSENT_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  }

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
      var val = params ? params.get(UTM_KEYS[i]) : null;
      if (val) landing[UTM_KEYS[i]] = val.slice(0, 200);
    }
    if (canPersist) writeStore(sessionStore, LANDING_KEY, JSON.stringify(landing));
    return landing;
  }

  var landing = captureLanding();

  function flushQueue() {
    var rum = window.DD_RUM;
    if (!rum) return;
    while (queue.length) {
      var item = queue.shift();
      rum.addAction(item[0], item[1]);
    }
  }

  function loadSdk() {
    if (sdkState !== 'idle' || !config || !config.enabled) return;
    sdkState = 'loading';
    var script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = function () {
      // Consent can be withdrawn while the SDK script is in flight.
      if (consentState() !== 'granted') {
        sdkState = 'failed';
        queue = [];
        return;
      }
      var rum = window.DD_RUM;
      if (!rum) {
        sdkState = 'failed';
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
        trackUserInteractions: true,
        trackResources: true,
        trackLongTasks: true,
        defaultPrivacyLevel: 'mask-user-input',
        sessionPersistence: 'local-storage',
      });
      rum.setGlobalContextProperty('launch', landing);
      sdkState = 'ready';
      flushQueue();
    };
    script.onerror = function () {
      sdkState = 'failed';
      queue = [];
    };
    document.head.appendChild(script);
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
    if (queue.length < MAX_QUEUE) queue.push([name, context || {}]);
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
    var stored = writeStore(localStore, CONSENT_KEY, state);
    // A failed denial write must not leave a stale persisted grant. Removing
    // the key is also fail-closed: the next page shows the choice without
    // loading RUM.
    if (state === 'denied' && !stored) {
      stored = removeStore(localStore, CONSENT_KEY);
    }
    closeBanner(true);
    if (state === 'granted') {
      writeStore(sessionStore, LANDING_KEY, JSON.stringify(landing));
      // The initial SSR view was intentionally dropped before consent. Queue
      // it now so a first-visit grant still has a complete view -> save funnel.
      var slug = ssrRecipeSlug();
      if (slug && previous !== 'granted') {
        action('recipe_view', { surface: 'ssr', slug: slug });
      }
      loadSdk();
      return;
    }
    queue = [];
    removeStore(sessionStore, LANDING_KEY);
    if (sdkState !== 'idle') {
      if (window.DD_RUM && window.DD_RUM.stopSession) window.DD_RUM.stopSession();
      // Reload only when denial is safely persisted (or a stale grant was
      // removed). If both operations are blocked, stay on this stopped,
      // fail-closed page instead of reactivating a stale grant on reload.
      if (stored) window.location.reload();
    }
  }

  function makeButton(label, onClick, primary) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText =
      'margin:0 0 0 8px;padding:6px 14px;border-radius:6px;font:inherit;cursor:pointer;' +
      (primary
        ? 'background:#166534;color:#fff;border:1px solid #166534;'
        : 'background:#fff;color:#1c1917;border:1px solid #a8a29e;');
    b.addEventListener('click', onClick);
    return b;
  }

  function showBanner() {
    if (!config || !config.enabled || banner || !document.body) return;
    var state = consentState();
    var status =
      state === 'granted' ? ' Analytics is on.' : state === 'denied' ? ' Analytics is off.' : '';
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
          'no ads, no screen recording.' +
          status +
          ' '
      )
    );
    var link = document.createElement('a');
    link.href = '/privacy-policy#analytics';
    link.textContent = 'Details';
    link.style.cssText = 'color:inherit;text-decoration:underline;';
    text.appendChild(link);
    var actions = document.createElement('div');
    actions.appendChild(
      makeButton(
        'No thanks',
        function () {
          choose('denied');
        },
        false
      )
    );
    actions.appendChild(
      makeButton(
        'Allow analytics',
        function () {
          choose('granted');
        },
        true
      )
    );
    banner.appendChild(text);
    banner.appendChild(actions);
    document.body.appendChild(banner);
  }

  function openSettings(trigger) {
    closeBanner(false);
    returnFocus = trigger && typeof trigger.focus === 'function' ? trigger : null;
    showBanner();
    if (banner) {
      var first = banner.querySelector('button');
      if (first) first.focus();
    }
  }

  // SSR surface: a /r/<slug> page is a recipe view, and its save CTA is the
  // start of the view → save funnel (the save itself completes in the SPA).
  function ssrRecipeSlug() {
    var m = window.location.pathname.match(SSR_RECIPE_PATH);
    return m ? m[1] : null;
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
    if (target.closest('[data-save-recipe]')) {
      action('recipe_save_click', { surface: 'ssr', slug: ssrRecipeSlug() });
    }
  });

  window.tlgAnalytics = {
    action: action,
    openSettings: openSettings,
    consent: consentState,
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
    if (typeof window.fetch !== 'function') return;
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
          queue = [];
          return;
        }
        revealSettingsControls();
        var state = consentState();
        if (state === 'granted') loadSdk();
        else if (state === null) showBanner();
        var slug = ssrRecipeSlug();
        if (slug) action('recipe_view', { surface: 'ssr', slug: slug });
      });
  }

  start();
})();
