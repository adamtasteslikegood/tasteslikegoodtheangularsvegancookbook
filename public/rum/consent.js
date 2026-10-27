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
 *
 * UI, storage, URL sanitization, and SSR link helpers live in
 * public/rum/consent-ui.js (window.__tlgConsentUi).
 */
(function () {
  'use strict';

  function bootConsent(ui) {
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

    var config = null;
    // 'cancelled': the script loaded while consent was withdrawn, so it was
    // not initialized; a later grant initializes it without refetching.
    var sdkState = 'idle'; // idle | loading | cancelled | ready | failed
    var queue = [];
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

    var getStore = ui.getStore;
    var readStore = ui.readStore;
    var writeStore = ui.writeStore;
    var removeStore = ui.removeStore;
    var beforeSend = ui.beforeSend;
    var ssrRecipeSlug = ui.ssrRecipeSlug;
    var revealSettingsControls = ui.revealSettingsControls;

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

    ui.restoreQueue(
      consentState,
      sessionStore,
      PENDING_ACTIONS_KEY,
      queue,
      MAX_QUEUE,
      persistQueue
    );

    var landing = ui.captureLanding(consentState, sessionStore, LANDING_KEY);

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

    var uiController = ui.createUiController({
      consentState: consentState,
      choose: choose,
      isEnabled: function () {
        return Boolean(config && config.enabled);
      },
    });
    var closeBanner = uiController.closeBanner;
    var showNotice = uiController.showNotice;
    var openSettings = uiController.openSettings;
    var showFirstBanner = uiController.showFirstBanner;

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

    ui.wireDocumentClick(openSettings, action, consentState, landing);

    window.tlgAnalytics = {
      action: action,
      openSettings: openSettings,
      consent: consentState,
      onConsentGranted: onConsentGranted,
    };

    function start() {
      // The withdrawal confirmation is one-shot: read and delete it before
      // anything can return early (no fetch, config failed or disabled), and
      // whatever its value, so it never lingers for a later visit.
      var pendingNotice = readStore(sessionStore, NOTICE_KEY);
      // One-shot means it must actually be gone: if removal fails, do not replay,
      // or every later page load in this tab would repeat it.
      var consumed = pendingNotice !== null && removeStore(sessionStore, NOTICE_KEY);
      // Only a withdrawal reloads, so 'denied' is the one value honoured, and
      // only while consent is still not granted (another tab may have granted
      // it since).
      var replayDenial = consumed && pendingNotice === 'denied';
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
  }

  if (typeof window !== 'undefined' && window.__tlgConsentUi) {
    bootConsent(window.__tlgConsentUi);
  } else if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var uiScript = document.createElement('script');
    uiScript.src = '/rum/consent-ui.js';
    uiScript.async = true;
    uiScript.onload = function () {
      if (window.__tlgConsentUi) bootConsent(window.__tlgConsentUi);
    };
    var parent = document.head || document.body || document.documentElement;
    if (parent) parent.appendChild(uiScript);
  }
})();
