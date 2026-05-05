// ==UserScript==
// @name         001-005 常见番号磁力检索助手
// @namespace    local://115emby/jav-local-skrbtso-helper-test
// @version      0.2.9
// @description  在常见 JAV/Nyaa 页面提取番号，调用本机/服务器 SkrBTSo helper 获取前 3 条 magnet；MissAV 页面附带防失焦暂停。
// @author       local
// @match        *://javdb.com/*
// @match        *://*.javdb.com/*
// @match        *://missav.ai/*
// @match        *://*.missav.ai/*
// @match        *://nyaa.si/*
// @match        *://*.nyaa.si/*
// @match        *://manko.fun/*
// @match        *://*.manko.fun/*
// @include      http://localhost:*/*
// @include      https://localhost:*/*
// @include      http://127.0.0.1:*/*
// @include      https://127.0.0.1:*/*
// @include      file:///*
// @include      *://*javlibrary.*/*
// @include      *://*javlib.*/*
// @include      *://*javbus.*/*
// @include      *://*onejav.*/*
// @include      *://*avsox.*/*
// @include      *://*jav321.*/*
// @include      *://*javdb.*/*
// @include      *://*missav.*/*
// @include      *://*jable.tv/*
// @include      *://*supjav.*/*
// @include      *://*jav.guru/*
// @include      *://*njav.tv/*
// @include      *://*avgle.*/*
// @include      *://*thisav.*/*
// @include      *://*nyaa.si/*
// @include      *://*manko.fun/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      127.0.0.1
// @connect      localhost
// @connect      115.com
// @connect      my.115.com
// @connect      webapi.115.com
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const SEARCH_ORIGIN = 'https://skrbtso.top';
  const DEFAULT_HELPER_URL = 'http://127.0.0.1:8787/skrbtso/search';
  const HELPER_URL_KEY = 'jlht_skrbtso_helper_url';
  const HELPER_TOKEN_KEY = 'jlht_skrbtso_helper_token';
  const HELPER_MODE_KEY = 'jlht_skrbtso_helper_mode';
  const LAST_RESULTS_KEY = 'jlht_skrbtso_last_results_v2';
  const PANEL_COLLAPSED_KEY = 'jlht_panel_collapsed';
  const OFFLINE115_SAVE_PATH_KEY = 'jlht_115_save_path';
  const OFFLINE115_SAVE_PATH_CID_KEY = 'jlht_115_save_path_cid';
  const OFFLINE115_AUTO_RENAME_KEY = 'jlht_115_auto_rename';
  const OFFLINE115_AUTO_DELETE_SMALL_KEY = 'jlht_115_auto_delete_small';
  const OFFLINE115_DELETE_SIZE_THRESHOLD_KEY = 'jlht_115_delete_size_threshold';
  const HELPER_MODE_LOCAL = 'local';
  const HELPER_MODE_SERVER = 'server';
  const DEFAULT_OFFLINE115_SAVE_PATH = '115默认离线目录';
  const DEFAULT_OFFLINE115_SAVE_PATH_CID = '0';
  const DEFAULT_OFFLINE115_DELETE_SIZE_THRESHOLD = 100;
  const OFFLINE115_MONITOR_MAX_ATTEMPTS = 120;
  const OFFLINE115_MONITOR_INTERVAL_MS = 10000;
  const OFFLINE115_PROCESS_DELAY_MS = 5000;
  const OFFLINE115_SCAN_MAX_DEPTH = 3;
  const QUERY_SUFFIX = 'UC';
  const MAX_RESULTS = 3;
  const HELPER_TIMEOUT_MS = 180000;
  const INITIAL_REFRESH_RETRIES = 30;
  const INITIAL_REFRESH_INTERVAL_MS = 1000;
  const NAVIGATION_REFRESH_RETRIES = 24;
  const NAVIGATION_REFRESH_INTERVAL_MS = 500;
  const RESUME_REFRESH_RETRIES = 6;
  const DOM_REFRESH_DEBOUNCE_MS = 300;
  const LOCATION_POLL_INTERVAL_MS = 1000;
  const CODE_PREFIX_BLOCKLIST = new Set([
    'AAC', 'AVC', 'BT', 'CHS', 'CODE', 'DVD', 'ENG', 'FHD', 'HD', 'HEVC', 'HTML',
    'HTTP', 'JAV', 'MAGNET', 'MISSAV', 'MKV', 'MOVIE', 'MP4', 'SD', 'SUB', 'UC',
    'UHD', 'VIDEO', 'WEB', 'WEBRIP', 'WWW', 'XVID',
  ]);

  const state = {
    query: '',
    results: [],
    busy: false,
    lastAutoQuery: '',
    queryTouched: false,
    lastLocationHref: location.href,
    refreshInterval: 0,
    mutationRefreshTimer: 0,
    settingsSaveTimer: 0,
  };

  const ui = {};

  installMissavNeverPause();

  function isMissavHost() {
    const host = location.hostname.toLowerCase();
    return host === 'missav.ai' || host.endsWith('.missav.ai') || host.includes('missav.');
  }

  function isMankoHost() {
    const host = location.hostname.toLowerCase();
    return host === 'manko.fun' || host.endsWith('.manko.fun');
  }

  function injectPageScript(source) {
    const parent = document.documentElement || document.head || document.body;
    if (!parent) {
      document.addEventListener('DOMContentLoaded', () => injectPageScript(source), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.textContent = source;
    parent.appendChild(script);
    script.remove();
  }

  function installMissavNeverPause() {
    if (!isMissavHost()) return;

    injectPageScript(`
      (() => {
        'use strict';
        if (window.__jlhtMissavNeverPauseInstalled) return;
        window.__jlhtMissavNeverPauseInstalled = true;

        const logPrefix = '[missav.ai never-pause]';
        const nativeAddEventListener = EventTarget.prototype.addEventListener;

        window.open = function (...args) {
          console.warn(logPrefix, 'blocked popup:', args[0]);
          return null;
        };

        function resumeVideo(video) {
          if (!video || !video.paused) return;
          video.play().catch((error) => console.warn(logPrefix, 'autoplay blocked:', error));
        }

        function hookVideo() {
          document.querySelectorAll('video').forEach((video) => {
            if (video.__jlhtNeverPauseHooked) return;

            const originalPause = video.pause;
            video.pause = function (...args) {
              if (document.hidden || !document.hasFocus()) {
                console.log(logPrefix, 'blocked pause() while page is hidden or unfocused');
                setTimeout(() => resumeVideo(this), 500);
                return undefined;
              }
              return originalPause.apply(this, args);
            };

            video.__jlhtNeverPauseHooked = true;
          });
        }

        try {
          Object.defineProperty(document, 'hidden', {
            get: () => false,
            configurable: false,
            enumerable: true,
          });
          Object.defineProperty(document, 'visibilityState', {
            get: () => 'visible',
            configurable: false,
            enumerable: true,
          });
        } catch (error) {
          console.warn(logPrefix, 'failed to override visibility state:', error);
        }

        EventTarget.prototype.addEventListener = function (type, listener, options) {
          if (type === 'visibilitychange' || type === 'blur' || type === 'focus') {
            return undefined;
          }
          return nativeAddEventListener.call(this, type, listener, options);
        };

        let tries = 0;
        const interval = setInterval(() => {
          hookVideo();
          tries += 1;
          if (tries > 30) clearInterval(interval);
        }, 1500);

        nativeAddEventListener.call(window, 'focus', () => {
          setTimeout(() => {
            document.querySelectorAll('video').forEach(resumeVideo);
          }, 300);
        });

        if (document.readyState === 'loading') {
          nativeAddEventListener.call(document, 'DOMContentLoaded', hookVideo, { once: true });
        } else {
          hookVideo();
        }

        console.log(logPrefix, 'installed');
      })();
    `);
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(String(value || '').replace(/\+/g, ' '));
    } catch (_error) {
      return String(value || '');
    }
  }

  function getStoredValue(key, fallback) {
    if (typeof GM_getValue !== 'function') return fallback;
    const value = GM_getValue(key, fallback);
    return typeof value === 'string' ? value : fallback;
  }

  function getStoredBoolean(key, fallback) {
    if (typeof GM_getValue !== 'function') return fallback;
    const value = GM_getValue(key, fallback ? '1' : '0');
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const text = String(value || '').toLowerCase();
    return text === '1' || text === 'true' || text === 'yes';
  }

  function getStoredJson(key, fallback) {
    if (typeof GM_getValue !== 'function') return fallback;
    const value = GM_getValue(key, '');
    if (!value || typeof value !== 'string') return fallback;
    try {
      return JSON.parse(value);
    } catch (_error) {
      return fallback;
    }
  }

  function setStoredJson(key, value) {
    if (typeof GM_setValue !== 'function') return;
    GM_setValue(key, JSON.stringify(value));
  }

  function validateHelperUrl(value) {
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol)) return '';
      return url.toString();
    } catch (_error) {
      return '';
    }
  }

  function isLocalHelperUrl(value) {
    try {
      const url = new URL(validateHelperUrl(value));
      const localHost = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
      return localHost && url.port === '8787' && url.pathname.replace(/\/+$/, '') === '/skrbtso/search';
    } catch (_error) {
      return false;
    }
  }

  function getHelperMode() {
    const mode = getStoredValue(HELPER_MODE_KEY, '');
    if (mode === HELPER_MODE_LOCAL || mode === HELPER_MODE_SERVER) return mode;

    const savedUrl = normalizeText(getStoredValue(HELPER_URL_KEY, ''));
    return savedUrl && !isLocalHelperUrl(savedUrl) ? HELPER_MODE_SERVER : HELPER_MODE_LOCAL;
  }

  function isUsingLocalHelper() {
    return getHelperMode() === HELPER_MODE_LOCAL;
  }

  function getServerHelperUrl() {
    const savedUrl = normalizeText(getStoredValue(HELPER_URL_KEY, ''));
    if (!savedUrl || isLocalHelperUrl(savedUrl)) return '';
    return savedUrl;
  }

  function getHelperUrl() {
    if (isUsingLocalHelper()) return DEFAULT_HELPER_URL;
    return getServerHelperUrl() || DEFAULT_HELPER_URL;
  }

  function getHelperToken() {
    return normalizeText(getStoredValue(HELPER_TOKEN_KEY, ''));
  }

  function getOffline115SavePath() {
    return normalizeText(getStoredValue(OFFLINE115_SAVE_PATH_KEY, DEFAULT_OFFLINE115_SAVE_PATH)) || DEFAULT_OFFLINE115_SAVE_PATH;
  }

  function getOffline115SavePathCid() {
    const cid = normalizeText(getStoredValue(OFFLINE115_SAVE_PATH_CID_KEY, DEFAULT_OFFLINE115_SAVE_PATH_CID));
    return /^\d+$/.test(cid) ? cid : DEFAULT_OFFLINE115_SAVE_PATH_CID;
  }

  function getOffline115AutoRename() {
    return getStoredBoolean(OFFLINE115_AUTO_RENAME_KEY, false);
  }

  function getOffline115AutoDeleteSmall() {
    return getStoredBoolean(OFFLINE115_AUTO_DELETE_SMALL_KEY, false);
  }

  function getOffline115DeleteSizeThreshold() {
    const raw = Number(getStoredValue(OFFLINE115_DELETE_SIZE_THRESHOLD_KEY, String(DEFAULT_OFFLINE115_DELETE_SIZE_THRESHOLD)));
    return Number.isFinite(raw) && raw > 0 ? Math.max(1, Math.floor(raw)) : DEFAULT_OFFLINE115_DELETE_SIZE_THRESHOLD;
  }

  function hasOffline115PostProcessing() {
    return getOffline115AutoRename() || getOffline115AutoDeleteSmall();
  }

  function getOffline115DisplayPath() {
    const savePath = getOffline115SavePath();
    const cid = getOffline115SavePathCid();
    if (cid === DEFAULT_OFFLINE115_SAVE_PATH_CID) return `${savePath}（不指定 CID）`;
    if (savePath) return `${savePath}（CID: ${cid}）`;
    return `CID: ${cid}`;
  }

  function getHelperDisplayUrl() {
    const modeLabel = isUsingLocalHelper() ? '本机' : '服务器';
    const safeUrl = getHelperUrl().replace(/[?&](?:token|authorization)=[^&]*/ig, '');
    return `${modeLabel} ${safeUrl}`;
  }

  function updateHelperAddressUi() {
    const displayUrl = getHelperDisplayUrl();
    if (ui.helperAddressText) ui.helperAddressText.textContent = `当前抓取服务：${displayUrl}`;
    if (ui.savedHelperUrlText) ui.savedHelperUrlText.textContent = displayUrl;
    if (ui.localHelperUrlText) ui.localHelperUrlText.textContent = DEFAULT_HELPER_URL;
  }

  function saveLastResults() {
    setStoredJson(LAST_RESULTS_KEY, {
      query: state.query,
      results: state.results,
      savedAt: Date.now(),
    });
  }

  function restoreLastResults() {
    const saved = getStoredJson(LAST_RESULTS_KEY, null);
    if (!saved || !Array.isArray(saved.results) || saved.results.length === 0) return false;

    state.query = normalizeText(saved.query);
    state.results = saved.results.map((item) => normalizeResultItem(item, state.query));
    if (state.query && ui.queryInput && !normalizeText(ui.queryInput.value)) {
      ui.queryInput.value = state.query;
      state.lastAutoQuery = state.query;
    }
    return true;
  }

  function normalizeCode(prefix, number) {
    const safePrefix = String(prefix || '').toUpperCase().replace(/[_\s]+/g, '-').replace(/-+/g, '-');
    const safeNumber = String(number || '').replace(/^0+(?=\d{3,})/, '');
    if (!safePrefix || !safeNumber) return '';
    if (CODE_PREFIX_BLOCKLIST.has(safePrefix)) return '';
    if (/^(?:19|20)\d{2}$/.test(safeNumber) && /^(FHD|HD|SD|UHD|WEB|H)$/.test(safePrefix)) return '';
    return `${safePrefix}-${safeNumber}`;
  }

  function findCodeCandidates(text) {
    const normalized = normalizeText(text).toUpperCase();
    const candidates = [];
    const add = (prefix, number) => {
      const code = normalizeCode(prefix, number);
      if (code && !candidates.includes(code)) candidates.push(code);
    };
    const addRawCode = (code) => {
      const safeCode = normalizeText(code).toUpperCase().replace(/_/g, '-');
      if (safeCode && !candidates.includes(safeCode)) candidates.push(safeCode);
    };

    let match = normalized.match(/\bFC2(?:[-_\s]?PPV)?[-_\s]?(\d{5,8})\b/);
    if (match) add('FC2-PPV', match[1]);

    match = normalized.match(/\b(HEYZO|TOKYO[-_\s]?HOT|CARIBBEANCOM|CARIB|1PONDO|10MUSUME|PACOPACOMAMA|KIN8TENGOKU)[-_\s]?([A-Z]?\d{3,8})\b/);
    if (match) add(match[1], match[2]);

    const numericDated = normalized.matchAll(/\b(\d{6})[-_](\d{2,3})\b/g);
    for (const item of numericDated) addRawCode(`${item[1]}-${item[2]}`);

    const suffixed = normalized.matchAll(/\b([A-Z]{2,12})[-_\s]?(\d{2,6})(?:[-_\s]?(?:UC|UNCENSORED))\b/g);
    for (const item of suffixed) add(item[1], item[2]);

    const general = normalized.matchAll(/\b([A-Z]{2,12})[-_\s]?(\d{2,6})\b/g);
    for (const item of general) add(item[1], item[2]);
    return candidates;
  }

  function extractCodeFromText(text) {
    return findCodeCandidates(text)[0] || '';
  }

  function isUrlNoiseSegment(segment) {
    const text = String(segment || '').toLowerCase();
    return !text ||
      /^(?:cn|en|ja|jp|zh|tw|ko|th|vi|id|ms|de|fr|es|it|pt|ru)$/.test(text) ||
      /^(?:dm|dmz|genre|genres|tag|tags|search|movie|movies|video|videos|watch|play|embed|uncensored)\d*$/.test(text) ||
      /^(?:page|sort|date|new|latest|hot|popular|ranking|rankings)\d*$/.test(text);
  }

  function extractCodeFromUrl(url) {
    let parsed;
    try {
      parsed = new URL(url || location.href, location.href);
    } catch (_error) {
      return '';
    }

    const segments = safeDecode(parsed.pathname)
      .split('/')
      .map((segment) => segment.replace(/\.[a-z0-9]{2,6}$/i, '').trim())
      .filter(Boolean);

    for (const segment of segments.slice().reverse()) {
      if (isUrlNoiseSegment(segment)) continue;
      const code = extractCodeFromText(segment.replace(/[_.]+/g, ' '));
      if (code) return code;
    }

    const pathText = segments
      .filter((segment) => !isUrlNoiseSegment(segment))
      .join(' ')
      .replace(/[/?#=&_.]+/g, ' ');
    const pathCode = extractCodeFromText(pathText);
    if (pathCode) return pathCode;

    const params = [];
    parsed.searchParams.forEach((value, name) => {
      if (!/(?:id|code|keyword|q|s|search|word|title|video|movie|cid|vid)/i.test(name)) return;
      params.push(value);
    });

    const paramsCode = extractCodeFromText(params.map(safeDecode).join(' ').replace(/[/?#=&_.]+/g, ' '));
    if (paramsCode) return paramsCode;

    return extractCodeFromText(safeDecode(parsed.hash).replace(/[/?#=&_.]+/g, ' '));
  }

  function extractCodeFromElements(selectors) {
    const nodes = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)).slice(0, 80));
    for (const node of nodes) {
      const text = node.getAttribute('data-clipboard-text') ||
        node.getAttribute('title') ||
        node.getAttribute('alt') ||
        node.getAttribute('aria-label') ||
        node.textContent;
      const code = extractCodeFromText(String(text || '').replace(/\bCopy title:\s*/i, '').replace(/\bposter\b/i, ''));
      if (code) return code;
    }
    return '';
  }

  function extractMankoCode() {
    const elementCode = extractCodeFromElements([
      'main .space-y-2 .text-blue-400',
      'main [class*="space-y-2"] [class*="text-blue-400"]',
      '.space-y-2 .text-blue-400',
      '[class*="space-y-2"] [class*="text-blue-400"]',
      'main iframe[title]',
      'iframe[title]',
      '.movie-grid-container a[title]',
      '.movie-grid-container button[title^="Copy title:"]',
      '.movie-grid-container img[alt]',
      'a[href*="/movie-info/"][title]',
      'button[title^="Copy title:"]',
      'img[alt*="poster"]',
    ]);
    if (elementCode) return elementCode;

    return extractCodeFromText(document.body ? document.body.innerText : '');
  }

  function getPageCode() {
    const pathCode = extractCodeFromUrl();
    if (pathCode) return pathCode;

    if (isMankoHost()) {
      const mankoCode = extractMankoCode();
      if (mankoCode) return mankoCode;
    }

    const labeledBlocks = Array.from(
      document.querySelectorAll('.panel-block, .video-meta-panel .item, .movie-panel-info .item, .metadata .item, tr, dl, li')
    );

    for (const block of labeledBlocks) {
      const text = normalizeText(block.textContent);
      if (!/(番号|番號|識別碼|识别码|品番|ID|Code)/i.test(text)) continue;
      const code = extractCodeFromText(text);
      if (code) return code;
    }

    const selectors = [
      '#video_id .text',
      '.header_hobby + *',
      '[data-clipboard-text]',
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[name="description"]',
      '.video-meta-panel .first-block .value',
      '.movie-panel-info .first-block .value',
      '.panel-block .value',
      '.movie-id',
      '.video-id',
      '.video-code',
      '.code',
      'h2.title',
      'h1',
      'title',
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (!node) continue;
      const text = node.getAttribute('data-clipboard-text') ||
        node.getAttribute('content') ||
        node.getAttribute('title') ||
        node.getAttribute('value') ||
        node.textContent;
      const code = extractCodeFromText(text);
      if (code) return code;
    }

    return extractCodeFromText(document.title);
  }

  function normalize115Name(value) {
    return String(value || '')
      .toUpperCase()
      .replace(/\[[^\]]*\]/g, '')
      .replace(/【[^】]*】/g, '')
      .replace(/\([^\)]*\)/g, '')
      .replace(/[^A-Z0-9]+/g, '');
  }

  function getFileNameExtension(name) {
    const match = String(name || '').match(/(\.[^.]+)$/);
    return match ? match[1] : '';
  }

  function extractMagnetHash(magnet) {
    const match = String(magnet || '').match(/btih:([a-z0-9]{32,40})/i);
    return match ? match[1].toLowerCase() : '';
  }

  function get115ItemName(item) {
    return normalizeText(item && (item.n || item.name));
  }

  function get115ItemId(item) {
    return String(item && (item.cid || item.fid || item.file_id || item.fileId || '') || '');
  }

  function is115Folder(item) {
    return Boolean(item) && !item.sha;
  }

  function is115VideoFile(item) {
    if (!item || !item.sha) return false;
    return /\.(?:mp4|mkv|avi|wmv|mov|flv|rmvb|rm|ts|m2ts|webm|m4v|3gp|mpeg|mpg)$/i.test(get115ItemName(item));
  }

  function buildDefaultQuery() {
    const code = getPageCode();
    return code ? `${code} ${QUERY_SUFFIX}` : '';
  }

  function canReplaceAutoQuery() {
    if (!ui.queryInput) return !state.queryTouched;
    const currentQuery = normalizeText(ui.queryInput.value);
    return !state.queryTouched || !currentQuery || currentQuery === state.lastAutoQuery;
  }

  function clearSearchResultsForNewPage(query) {
    if (state.query && state.query !== query) state.query = '';
    setBusy(false);
  }

  function refreshDefaultQueryFromPage(force) {
    if (!ui.queryInput || state.busy) return false;
    if (state.queryTouched && !force) return false;
    if (force && !canReplaceAutoQuery()) return false;

    const query = buildDefaultQuery();
    if (!query || query === state.lastAutoQuery) return false;

    ui.queryInput.value = query;
    state.lastAutoQuery = query;
    state.queryTouched = false;
    clearSearchResultsForNewPage(query);
    setStatus(`已识别：${query}`, 'success');
    return true;
  }

  function stopDefaultQueryRefreshLoop() {
    if (!state.refreshInterval) return;
    clearInterval(state.refreshInterval);
    state.refreshInterval = 0;
  }

  function scheduleDefaultQueryRefreshLoop(maxAttempts, intervalMs, force) {
    stopDefaultQueryRefreshLoop();

    let attempts = 0;
    const attemptLimit = Math.max(1, maxAttempts);
    const tick = () => {
      attempts += 1;
      const refreshed = refreshDefaultQueryFromPage(Boolean(force));
      if (refreshed || attempts >= attemptLimit || (state.queryTouched && !force)) {
        stopDefaultQueryRefreshLoop();
      }
    };

    state.refreshInterval = setInterval(tick, intervalMs);
    tick();
  }

  function handlePageLocationChange() {
    if (!ui.queryInput || state.busy) return;
    if (!canReplaceAutoQuery()) return;

    state.queryTouched = false;
    clearSearchResultsForNewPage('');
    setStatus('页面已变化，正在重新识别番号...', 'loading');
    scheduleDefaultQueryRefreshLoop(NAVIGATION_REFRESH_RETRIES, NAVIGATION_REFRESH_INTERVAL_MS, true);
  }

  function checkPageLocationChange() {
    const href = location.href;
    if (href === state.lastLocationHref) return;
    if (state.busy) return;

    state.lastLocationHref = href;
    handlePageLocationChange();
  }

  function queueDomRefresh() {
    if (state.busy || !canReplaceAutoQuery()) return;

    clearTimeout(state.mutationRefreshTimer);
    state.mutationRefreshTimer = setTimeout(() => {
      state.mutationRefreshTimer = 0;
      checkPageLocationChange();
      refreshDefaultQueryFromPage(false);
    }, DOM_REFRESH_DEBOUNCE_MS);
  }

  function scheduleDefaultQueryRefresh() {
    scheduleDefaultQueryRefreshLoop(INITIAL_REFRESH_RETRIES, INITIAL_REFRESH_INTERVAL_MS, false);
    setInterval(checkPageLocationChange, LOCATION_POLL_INTERVAL_MS);
    window.addEventListener('popstate', checkPageLocationChange);
    window.addEventListener('hashchange', checkPageLocationChange);
    window.addEventListener('pageshow', () => {
      checkPageLocationChange();
      scheduleDefaultQueryRefreshLoop(RESUME_REFRESH_RETRIES, INITIAL_REFRESH_INTERVAL_MS, false);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      checkPageLocationChange();
      scheduleDefaultQueryRefreshLoop(RESUME_REFRESH_RETRIES, INITIAL_REFRESH_INTERVAL_MS, false);
    });

    if (typeof MutationObserver === 'function') {
      const observer = new MutationObserver((mutations) => {
        if (state.queryTouched) return;
        const onlyPanelChanged = mutations.every((mutation) => ui.panel && ui.panel.contains(mutation.target));
        if (onlyPanelChanged) return;
        queueDomRefresh();
      });
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }
  }

  function buildSearchUrl(query) {
    return `${SEARCH_ORIGIN}/search/${encodeURIComponent(query)}.html`;
  }

  function buildHelperUrl(query) {
    const url = new URL(getHelperUrl());
    url.searchParams.set('q', query);
    url.searchParams.set('query', query);
    url.searchParams.set('max', String(MAX_RESULTS));
    url.searchParams.set('url', buildSearchUrl(query));
    return url.toString();
  }

  function compactErrorMessage(message) {
    const text = normalizeText(message);
    if (/launch_persistent_context|Target page, context or browser has been closed|process did exit/i.test(text)) {
      return '本机浏览器启动失败。请重新点一次检索；如果还失败，重启 helper 后再试。';
    }
    return text.length > 220 ? `${text.slice(0, 220)}...` : text;
  }

  function requestJson(url) {
    const headers = {
      Accept: 'application/json,text/plain,*/*',
    };
    const token = getHelperToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: HELPER_TIMEOUT_MS,
        responseType: 'json',
        headers,
        onload(response) {
          let payload = response.response;
          if (!payload && response.responseText) {
            try {
              payload = JSON.parse(response.responseText);
            } catch (_error) {
              payload = null;
            }
          }

          if (response.status < 200 || response.status >= 300) {
            const message = payload && (payload.error || payload.message);
            reject(new Error(compactErrorMessage(message || `抓取服务 HTTP ${response.status}`)));
            return;
          }

          if (!payload || typeof payload !== 'object') {
            reject(new Error('抓取服务返回格式无效'));
            return;
          }

          if (payload.ok === false) {
            reject(new Error(compactErrorMessage(payload.error || payload.message || '抓取服务返回失败')));
            return;
          }

          resolve(payload);
        },
        ontimeout() {
          reject(new Error('抓取服务超时，请确认服务已启动并等待完成'));
        },
        onerror() {
          reject(new Error('无法连接抓取服务，请确认 helper 地址、token 和反代配置。'));
        },
      });
    });
  }

  function normalizeResultItem(item, query) {
    const title = normalizeText(item && item.title) || '未识别标题';
    const queryCode = normalizeText(item && item.queryCode) || extractCodeFromText(query);
    const resultCode = normalizeText(item && item.resultCode) || extractCodeFromText(title);
    const fileSize = normalizeText(item && (item.fileSize || item.size || item.file_size));
    const helperMatched = item && typeof item.titleMatched === 'boolean' ? item.titleMatched : null;
    const titleMatched = helperMatched !== null ? helperMatched : Boolean(queryCode && resultCode && queryCode === resultCode);

    return {
      title,
      query: normalizeText(item && item.query) || query,
      queryCode,
      resultCode,
      titleMatched,
      fileSize,
      detailUrl: item && item.detailUrl || '',
      source: item && item.source || '',
      magnet: item && item.magnet || '',
    };
  }

  async function searchByLocalHelper(query) {
    const payload = await requestJson(buildHelperUrl(query));
    const rawItems = payload.results || payload.items || payload.data || [];
    if (!Array.isArray(rawItems) || rawItems.length === 0) throw new Error('抓取服务没有返回 results');

    const seen = new Set();
    return rawItems
      .map((item) => normalizeResultItem(item, query))
      .filter((item) => {
        const key = item.magnet.toLowerCase();
        if (!item.magnet || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_RESULTS);
  }

  function request115Json(url, options) {
    const method = (options && options.method) || 'GET';
    const headers = Object.assign({
      Accept: 'application/json,text/plain,*/*',
      Origin: 'https://115.com',
      Referer: 'https://115.com/?cid=0&offset=0&mode=wangpan',
      'X-Requested-With': 'XMLHttpRequest',
    }, options && options.headers);

    if (method !== 'GET' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        data: options && options.data,
        timeout: (options && options.timeout) || 30000,
        responseType: 'json',
        withCredentials: true,
        headers,
        onload(response) {
          let payload = response.response;
          if (!payload && response.responseText) {
            try {
              payload = JSON.parse(response.responseText);
            } catch (_error) {
              payload = null;
            }
          }

          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`115 服务 HTTP ${response.status}`));
            return;
          }

          if (!payload || typeof payload !== 'object') {
            const preview = normalizeText(response.responseText).slice(0, 80);
            const message = /<html|<!doctype/i.test(preview) ? '115 返回登录页面，请先登录 115.com。' : '115 返回格式无效';
            reject(new Error(message));
            return;
          }

          resolve(payload);
        },
        ontimeout() {
          reject(new Error('115 请求超时，请稍后重试。'));
        },
        onerror() {
          reject(new Error('无法连接 115，请确认已登录 115.com。'));
        },
      });
    });
  }

  function buildFormData(data) {
    const params = new URLSearchParams();
    Object.entries(data).forEach(([key, value]) => {
      if (value === undefined) return;
      params.set(key, String(value == null ? '' : value));
    });
    return params.toString();
  }

  function get115ResultError(result, fallback) {
    if (!result || typeof result !== 'object') return fallback;
    if (String(result.errcode) === '911') return '账号使用异常，请先在 115.com 手动验证。';
    return compactErrorMessage(result.error_msg || result.error || result.message || fallback);
  }

  async function checkOffline115Login() {
    const result = await request115Json('https://my.115.com/?ct=guide&ac=status');
    return result.state === true;
  }

  async function getOffline115Uid() {
    const result = await request115Json('https://my.115.com/?ct=ajax&ac=get_user_aq');
    const uid = result && result.data && result.data.uid;
    if (!uid) throw new Error(get115ResultError(result, '获取 115 UID 失败，请确认 115 已登录。'));
    return uid;
  }

  async function getOffline115SignAndTime() {
    const result = await request115Json(`https://115.com/?ct=offline&ac=space&_=${Date.now()}`);
    if (result.state === true && result.sign && result.time) {
      return { sign: result.sign, time: result.time };
    }
    throw new Error(get115ResultError(result, '获取 115 离线 token 失败，请确认 115 已登录。'));
  }

  async function addOffline115Task(magnet) {
    const loggedIn = await checkOffline115Login();
    if (!loggedIn) throw new Error('未登录 115 网盘，请先在 115.com 登录。');

    const uid = await getOffline115Uid();
    const token = await getOffline115SignAndTime();
    const cid = getOffline115SavePathCid();
    const pathId = cid === DEFAULT_OFFLINE115_SAVE_PATH_CID ? undefined : cid;
    const result = await request115Json('https://115.com/web/lixian/?ct=lixian&ac=add_task_url', {
      method: 'POST',
      data: buildFormData({
        url: magnet,
        savepath: '',
        wp_path_id: pathId,
        uid,
        sign: token.sign,
        time: token.time,
      }),
    });

    if (result.state !== true) throw new Error(get115ResultError(result, '添加 115 离线任务失败。'));
    return result;
  }

  async function getOffline115Tasks() {
    const result = await request115Json(`https://115.com/web/lixian/?ct=lixian&ac=task_lists&_=${Date.now()}`);
    if (result.state !== true) throw new Error(get115ResultError(result, '获取 115 离线任务列表失败。'));
    return Array.isArray(result.tasks) ? result.tasks : [];
  }

  async function getOffline115FileList(cid) {
    const url = `https://webapi.115.com/files?aid=1&cid=${encodeURIComponent(cid || '0')}&o=user_ptime&asc=0&offset=0&show_dir=1&limit=500&snap=0&natsort=1`;
    const result = await request115Json(url);
    return Array.isArray(result.data) ? result.data : [];
  }

  async function renameOffline115FileOrFolder(fileId, newName) {
    if (!fileId || !newName) return { state: false, error: '缺少文件 ID 或新名称' };
    return request115Json('https://webapi.115.com/files/edit', {
      method: 'POST',
      data: buildFormData({
        fid: fileId,
        name: newName,
      }),
    });
  }

  async function deleteOffline115Files(fileIds) {
    const ids = Array.isArray(fileIds) ? fileIds.filter(Boolean) : [fileIds].filter(Boolean);
    if (ids.length === 0) return { state: true };

    const params = new URLSearchParams();
    ids.forEach((id, index) => params.append(`fid[${index}]`, id));
    params.append('ignore_warn', '1');
    return request115Json('https://webapi.115.com/rb/delete', {
      method: 'POST',
      data: params.toString(),
    });
  }

  async function resolveOffline115TaskFolderCid(saveCid, taskName, taskFileCid) {
    if (taskFileCid) return { cid: String(taskFileCid), found: true, label: '任务文件夹', folderId: String(taskFileCid) };
    if (!taskName || saveCid === DEFAULT_OFFLINE115_SAVE_PATH_CID) {
      return { cid: saveCid, found: false, label: '保存路径', folderId: '' };
    }

    const list = await getOffline115FileList(saveCid);
    const folders = list.filter(is115Folder);
    const targetName = String(taskName || '').trim().toLowerCase();
    const exact = folders.find((item) => get115ItemName(item).toLowerCase() === targetName);
    if (exact) return { cid: get115ItemId(exact), found: true, label: '任务文件夹', folderId: get115ItemId(exact) };

    const fuzzy = folders.find((item) => get115ItemName(item).toLowerCase().includes(targetName));
    if (fuzzy) return { cid: get115ItemId(fuzzy), found: true, label: '任务文件夹', folderId: get115ItemId(fuzzy) };

    return { cid: saveCid, found: false, label: '保存路径', folderId: '' };
  }

  async function collectOffline115Files(cid, options) {
    const maxDepth = options && typeof options.maxDepth === 'number' ? options.maxDepth : OFFLINE115_SCAN_MAX_DEPTH;
    const files = [];

    async function scan(folderCid, depth) {
      if (!folderCid || depth > maxDepth) return;
      const list = await getOffline115FileList(folderCid);
      for (const item of list) {
        if (is115Folder(item)) {
          const childCid = get115ItemId(item);
          if (childCid && childCid !== folderCid) await scan(childCid, depth + 1);
          continue;
        }
        files.push(item);
      }
    }

    await scan(cid, 0);
    return files;
  }

  async function cleanOffline115SmallFiles(cid, thresholdMb) {
    const thresholdBytes = thresholdMb * 1024 * 1024;
    const files = await collectOffline115Files(cid, { maxDepth: OFFLINE115_SCAN_MAX_DEPTH });
    const smallFiles = files.filter((item) => {
      const size = Number(item && (item.size || item.s || 0));
      return size > 0 && size < thresholdBytes;
    });

    if (smallFiles.length === 0) return { deleted: 0, files: [] };

    const result = await deleteOffline115Files(smallFiles.map((item) => item.fid));
    if (result.state !== true) throw new Error(get115ResultError(result, '删除 115 小文件失败。'));
    return {
      deleted: smallFiles.length,
      files: smallFiles.map(get115ItemName),
    };
  }

  async function renameOffline115Videos(cid, targetCode) {
    const safeCode = normalizeText(targetCode).toUpperCase();
    if (!safeCode) return { renamed: 0, files: [] };

    const files = (await collectOffline115Files(cid, { maxDepth: OFFLINE115_SCAN_MAX_DEPTH })).filter(is115VideoFile);
    const renamedFiles = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const oldName = get115ItemName(file);
      const ext = getFileNameExtension(oldName);
      const suffix = files.length > 1 ? `-${index + 1}` : '';
      const newName = `${safeCode}${suffix}${ext}`;
      if (!file.fid || !newName || oldName === newName) continue;

      const result = await renameOffline115FileOrFolder(file.fid, newName);
      if (result.state === true) renamedFiles.push(`${oldName} -> ${newName}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return { renamed: renamedFiles.length, files: renamedFiles };
  }

  function getOffline115TargetCode(item, taskName) {
    return normalizeText(
      item && (item.resultCode || item.queryCode) ||
      extractCodeFromText(taskName || '') ||
      extractCodeFromText(item && item.title || '')
    ).toUpperCase();
  }

  function taskMatchesOffline115(task, meta) {
    const taskHash = String(task && task.info_hash || '').toLowerCase();
    const metaHash = String(meta && meta.hash || '').toLowerCase();
    if (taskHash && metaHash && taskHash === metaHash) return true;

    const taskName = normalizeText(task && task.name);
    const metaName = normalizeText(meta && meta.name);
    if (taskName && metaName && taskName === metaName) return true;

    const code = normalizeText(meta && meta.code).toUpperCase();
    return Boolean(code && taskName && taskName.toUpperCase().includes(code));
  }

  async function processOffline115Files(context) {
    const saveCid = getOffline115SavePathCid();
    const targetInfo = await resolveOffline115TaskFolderCid(saveCid, context.taskName, context.taskFileCid);
    if (!targetInfo.found) {
      setStatus('未找到本次任务文件夹，已跳过自动重命名/清理，避免扫描整个目录。', 'warn');
      return;
    }

    const messages = [];
    const targetCode = getOffline115TargetCode(context.item, context.taskName);

    if (getOffline115AutoRename() && targetCode) {
      const folderName = normalizeText(context.taskName);
      const folderId = context.taskFileCid || targetInfo.folderId || targetInfo.cid;
      if (folderId && folderName && normalize115Name(folderName) !== normalize115Name(targetCode)) {
        const result = await renameOffline115FileOrFolder(folderId, targetCode);
        if (result.state === true) messages.push('重命名任务文件夹');
      }

      const result = await renameOffline115Videos(targetInfo.cid, targetCode);
      if (result.renamed > 0) messages.push(`重命名 ${result.renamed} 个视频文件`);
    }

    if (getOffline115AutoDeleteSmall()) {
      const threshold = getOffline115DeleteSizeThreshold();
      const result = await cleanOffline115SmallFiles(targetInfo.cid, threshold);
      if (result.deleted > 0) messages.push(`删除 ${result.deleted} 个小文件`);
    }

    setStatus(messages.length ? `115 后处理完成：${messages.join('，')}。` : '115 后处理完成，没有需要修改的文件。', 'success');
  }

  function monitorOffline115Task(taskMeta, item) {
    let attempts = 0;
    let taskName = taskMeta.name || '';
    let taskFileCid = taskMeta.fileCid || '';
    let completed = false;

    const checkTask = async () => {
      attempts += 1;
      if (attempts > OFFLINE115_MONITOR_MAX_ATTEMPTS) {
        setStatus('115 离线任务监控超时，请到 115 网盘手动检查。', 'error');
        return;
      }

      try {
        const tasks = await getOffline115Tasks();
        const task = tasks.find((candidate) => taskMatchesOffline115(candidate, taskMeta));
        if (task) {
          taskName = taskName || normalizeText(task.name);
          taskFileCid = taskFileCid || String(task.file_id || task.fileId || task.dir_id || task.dirId || task.wppath_id || '');

          if (Number(task.status) === -1) {
            setStatus('115 离线任务失败，请到 115 网盘查看原因。', 'error');
            return;
          }

          if (Number(task.status) === 2 || Number(task.percentDone) >= 100) completed = true;
        } else if (attempts > 1) {
          completed = true;
        }

        if (completed) {
          setStatus('115 离线任务完成，正在执行自动重命名/清理...', 'loading');
          setTimeout(() => {
            processOffline115Files({ item, taskName: taskName || taskMeta.name, taskFileCid }).catch((error) => {
              setStatus(error && error.message ? error.message : '115 后处理失败', 'error');
            });
          }, OFFLINE115_PROCESS_DELAY_MS);
          return;
        }

        setStatus(`115 离线任务监控中...第 ${attempts} 次检查。`, 'loading');
        setTimeout(checkTask, OFFLINE115_MONITOR_INTERVAL_MS);
      } catch (error) {
        setStatus(`115 任务监控失败，稍后重试：${error && error.message ? error.message : '未知错误'}`, 'warn');
        setTimeout(checkTask, OFFLINE115_MONITOR_INTERVAL_MS);
      }
    };

    setStatus('115 离线已添加，正在监控完成状态，请保持页面打开。', 'loading');
    setTimeout(checkTask, OFFLINE115_MONITOR_INTERVAL_MS);
  }

  function copyText(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      return Promise.resolve();
    }
    return navigator.clipboard.writeText(text);
  }

  function resultsAsMagnetText() {
    return state.results.map((item) => item.magnet).join('\n');
  }

  function resultsAsCompareText() {
    return state.results.map((item, index) => [
      `${index + 1}. ${item.titleMatched ? '匹配' : '不匹配'}`,
      `原始搜索：${item.query || state.query}`,
      `搜索结果标题：${item.title}`,
      `结果番号：${item.resultCode || '未识别'}`,
      `原始番号：${item.queryCode || '未识别'}`,
      `文件大小：${item.fileSize || '未知'}`,
      item.magnet,
    ].join('\n')).join('\n\n');
  }

  function setStatus(message, tone) {
    ui.status.textContent = message;
    ui.status.dataset.tone = tone || 'neutral';
  }

  function setBusy(isBusy) {
    state.busy = isBusy;
    ui.searchButton.disabled = isBusy;
    ui.copyMagnetButton.disabled = isBusy || state.results.length === 0;
    ui.copyCompareButton.disabled = isBusy || state.results.length === 0;
    ui.exportButton.disabled = isBusy || state.results.length === 0;
  }

  function renderResults() {
    ui.list.textContent = '';

    if (state.results.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'jlht-empty';
      empty.textContent = '暂无结果。先确认抓取服务已启动，再点击“检索磁力”。';
      ui.list.appendChild(empty);
      return;
    }

    state.results.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = `jlht-result ${item.titleMatched ? 'is-match' : 'is-mismatch'}`;

      const head = document.createElement('div');
      head.className = 'jlht-result-head';

      const badge = document.createElement('span');
      badge.className = 'jlht-badge';
      badge.textContent = String(index + 1);

      const match = document.createElement('span');
      match.className = 'jlht-match';
      match.textContent = item.titleMatched ? '匹配' : '不匹配';

      const resultActions = document.createElement('div');
      resultActions.className = 'jlht-result-actions';

      const offline115Button = document.createElement('button');
      offline115Button.type = 'button';
      offline115Button.className = 'jlht-result-action jlht-offline-115';
      offline115Button.textContent = '115离线';
      offline115Button.title = `推送第 ${index + 1} 条 magnet 到 115 离线下载`;
      offline115Button.addEventListener('click', () => handleOffline115Result(item, index));

      const copyOneButton = document.createElement('button');
      copyOneButton.type = 'button';
      copyOneButton.className = 'jlht-result-action jlht-copy-one';
      copyOneButton.textContent = '复制';
      copyOneButton.title = `复制第 ${index + 1} 条 magnet`;
      copyOneButton.addEventListener('click', () => handleCopyResult(item, index));
      resultActions.append(offline115Button, copyOneButton);

      const title = document.createElement('div');
      title.className = 'jlht-title';
      title.textContent = item.title;

      const code = document.createElement('div');
      code.className = 'jlht-code';
      code.textContent = `原始：${item.queryCode || '未识别'} / 结果：${item.resultCode || '未识别'}`;

      const fileSize = document.createElement('span');
      fileSize.className = `jlht-size ${item.fileSize ? '' : 'is-unknown'}`.trim();
      fileSize.textContent = `大小：${item.fileSize || '未知'}`;

      const meta = document.createElement('div');
      meta.className = 'jlht-meta';
      meta.append(code, fileSize);

      const magnet = document.createElement('div');
      magnet.className = 'jlht-magnet';
      magnet.textContent = item.magnet;

      head.append(badge, match, resultActions);
      row.append(head, title, meta, magnet);
      ui.list.appendChild(row);
    });
  }

  async function handleSearch() {
    const query = normalizeText(ui.queryInput.value);
    if (!query) {
      setStatus('没有识别到番号，请手动输入，例如 JUR-070 UC。', 'error');
      return;
    }

    state.query = query;
    setBusy(true);
    setStatus(`正在调用${isUsingLocalHelper() ? '本机' : '服务器'}抓取服务：${query}`, 'loading');

    try {
      state.results = await searchByLocalHelper(query);
      saveLastResults();
      renderResults();
      const mismatchCount = state.results.filter((item) => !item.titleMatched).length;
      setStatus(`抓取服务返回 ${state.results.length} 条，${mismatchCount} 条不匹配。`, mismatchCount ? 'warn' : 'success');
    } catch (error) {
      setStatus(error && error.message ? error.message : '抓取服务检索失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyMagnets() {
    const text = resultsAsMagnetText();
    if (!text) return;
    await copyText(text);
    setStatus('已复制 magnet 列表。', 'success');
  }

  async function handleCopyResult(item, index) {
    if (!item || !item.magnet) return;

    try {
      await copyText(item.magnet);
      setStatus(`已复制第 ${index + 1} 条 magnet。`, 'success');
    } catch (error) {
      setStatus(error && error.message ? error.message : '复制失败', 'error');
    }
  }

  function appendModalInfo(parent, label, value, className) {
    const row = document.createElement('div');
    row.className = `jlht-modal-info ${className || ''}`.trim();
    const strong = document.createElement('strong');
    strong.textContent = label;
    const text = document.createElement('span');
    text.textContent = value;
    row.append(strong, text);
    parent.appendChild(row);
    return row;
  }

  function handleOffline115Result(item, index) {
    if (!item || !item.magnet) return;

    const existing = document.getElementById('jlht-115-modal-overlay');
    if (existing) existing.click();

    const overlay = document.createElement('div');
    overlay.id = 'jlht-115-modal-overlay';
    overlay.className = 'jlht-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'jlht-modal';

    const header = document.createElement('div');
    header.className = 'jlht-modal-header';
    const title = document.createElement('h3');
    title.className = 'jlht-modal-title';
    title.textContent = '推送到 115 网盘离线下载';
    header.appendChild(title);

    const body = document.createElement('div');
    body.className = 'jlht-modal-body';
    appendModalInfo(body, '序号：', String(index + 1));
    appendModalInfo(body, '标题：', item.title);
    appendModalInfo(body, '番号：', item.resultCode || item.queryCode || '未识别');
    appendModalInfo(body, '大小：', item.fileSize || '未知');
    appendModalInfo(body, '保存路径：', getOffline115DisplayPath());
    if (getOffline115AutoRename()) appendModalInfo(body, '自动重命名：', getOffline115TargetCode(item, item.title) || '未识别番号，完成后跳过');
    if (getOffline115AutoDeleteSmall()) appendModalInfo(body, '自动清理：', `删除小于 ${getOffline115DeleteSizeThreshold()} MB 的文件`);
    appendModalInfo(body, 'Magnet：', item.magnet, 'jlht-modal-link');

    const note = document.createElement('div');
    note.className = 'jlht-modal-note';
    note.textContent = hasOffline115PostProcessing()
      ? '后处理需要保持此页面打开直到离线任务完成；脚本只处理本次任务文件夹。'
      : '本阶段只使用当前浏览器的 115 登录态，不保存 115 Cookie。';
    body.appendChild(note);

    const footer = document.createElement('div');
    footer.className = 'jlht-modal-footer';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'jlht-btn';
    cancelButton.textContent = '取消';
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'jlht-btn jlht-btn-primary';
    confirmButton.textContent = '确定推送';
    footer.append(cancelButton, confirmButton);

    const cleanup = () => {
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
    };

    const escHandler = (event) => {
      if (event.key === 'Escape') cleanup();
    };

    cancelButton.addEventListener('click', cleanup);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) cleanup();
    });
    document.addEventListener('keydown', escHandler);

    confirmButton.addEventListener('click', async () => {
      confirmButton.disabled = true;
      cancelButton.disabled = true;
      confirmButton.textContent = '推送中...';
      setStatus(`正在推送第 ${index + 1} 条到 115 离线下载...`, 'loading');

      try {
        const result = await addOffline115Task(item.magnet);
        cleanup();
        const taskMeta = {
          hash: result.info_hash || result.hash || extractMagnetHash(item.magnet),
          name: result.name || item.title || item.resultCode || '',
          code: getOffline115TargetCode(item, result.name || item.title),
          fileCid: result.file_id || result.fileId || result.dir_id || result.dirId || result.wppath_id || '',
        };
        if (hasOffline115PostProcessing()) {
          monitorOffline115Task(taskMeta, item);
        } else {
          setStatus(`115 离线已添加：${result.name || item.resultCode || item.title}`, 'success');
        }
      } catch (error) {
        confirmButton.disabled = false;
        cancelButton.disabled = false;
        confirmButton.textContent = '确定推送';
        setStatus(error && error.message ? error.message : '115 离线推送失败', 'error');
      }
    });

    modal.append(header, body, footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  async function handleCopyCompare() {
    const text = resultsAsCompareText();
    if (!text) return;
    await copyText(text);
    setStatus('已复制带匹配状态的结果。', 'success');
  }

  function handleExportCompare() {
    const text = resultsAsCompareText();
    if (!text) return;

    const blob = new Blob([text, '\n'], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    const filenameBase = normalizeText(state.query || 'skrbtso-helper').replace(/[\\/:*?"<>|]+/g, '_');
    link.href = URL.createObjectURL(blob);
    link.download = `${filenameBase}_compare.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setStatus('已导出对比 TXT。', 'success');
  }

  function toggleSettings() {
    if (!ui.settings) return;
    const isHidden = ui.settings.hidden;
    ui.settings.hidden = !isHidden;
    if (isHidden) {
      ui.localHelperCheckbox.checked = isUsingLocalHelper();
      ui.helperUrlInput.value = getServerHelperUrl();
      ui.helperTokenInput.value = getHelperToken();
      ui.offline115SavePathInput.value = getOffline115SavePath();
      ui.offline115SavePathCidInput.value = getOffline115SavePathCid();
      ui.offline115AutoRenameCheckbox.checked = getOffline115AutoRename();
      ui.offline115AutoDeleteCheckbox.checked = getOffline115AutoDeleteSmall();
      ui.offline115DeleteThresholdInput.value = String(getOffline115DeleteSizeThreshold());
      syncSettingsModeUi();
    }
  }

  function saveHelperToken(token) {
    if (token) {
      GM_setValue(HELPER_TOKEN_KEY, token);
    } else if (typeof GM_deleteValue === 'function') {
      GM_deleteValue(HELPER_TOKEN_KEY);
    }
  }

  function syncSettingsModeUi() {
    if (!ui.localHelperCheckbox) return;
    const useLocal = ui.localHelperCheckbox.checked;
    const serverUrl = normalizeText(ui.helperUrlInput && ui.helperUrlInput.value);
    const selectedUrl = useLocal ? DEFAULT_HELPER_URL : serverUrl || getServerHelperUrl() || '未填写服务器地址';
    if (ui.helperUrlInput) ui.helperUrlInput.disabled = useLocal;
    if (ui.helperTokenInput) ui.helperTokenInput.disabled = useLocal;
    if (ui.helperUrlField) ui.helperUrlField.classList.toggle('is-disabled', useLocal);
    if (ui.helperTokenField) ui.helperTokenField.classList.toggle('is-disabled', useLocal);
    if (ui.selectedHelperUrlText) ui.selectedHelperUrlText.textContent = `${useLocal ? '本机' : '服务器'} ${selectedUrl}`;
    syncOffline115ProcessingUi();
  }

  function syncOffline115ProcessingUi() {
    if (!ui.offline115AutoDeleteCheckbox || !ui.offline115DeleteThresholdInput) return;
    const enabled = ui.offline115AutoDeleteCheckbox.checked;
    ui.offline115DeleteThresholdInput.disabled = !enabled;
    if (ui.offline115DeleteThresholdField) ui.offline115DeleteThresholdField.classList.toggle('is-disabled', !enabled);
  }

  function persistSettings(silent) {
    if (typeof GM_setValue !== 'function') {
      if (!silent) setStatus('当前脚本管理器不支持保存设置。', 'error');
      return false;
    }

    const useLocal = Boolean(ui.localHelperCheckbox && ui.localHelperCheckbox.checked);
    const helperUrlText = normalizeText(ui.helperUrlInput && ui.helperUrlInput.value);
    const token = normalizeText(ui.helperTokenInput && ui.helperTokenInput.value);
    const offline115SavePath = normalizeText(ui.offline115SavePathInput && ui.offline115SavePathInput.value) || DEFAULT_OFFLINE115_SAVE_PATH;
    const offline115SavePathCid = normalizeText(ui.offline115SavePathCidInput && ui.offline115SavePathCidInput.value) || DEFAULT_OFFLINE115_SAVE_PATH_CID;
    const autoRename = Boolean(ui.offline115AutoRenameCheckbox && ui.offline115AutoRenameCheckbox.checked);
    const autoDeleteSmall = Boolean(ui.offline115AutoDeleteCheckbox && ui.offline115AutoDeleteCheckbox.checked);
    const deleteThreshold = Number(normalizeText(ui.offline115DeleteThresholdInput && ui.offline115DeleteThresholdInput.value) || DEFAULT_OFFLINE115_DELETE_SIZE_THRESHOLD);

    if (!/^\d+$/.test(offline115SavePathCid)) {
      if (!silent) setStatus('115 保存路径 CID 只能填写数字；0 表示使用 115 默认离线目录。', 'error');
      return false;
    }

    if (!Number.isFinite(deleteThreshold) || deleteThreshold <= 0) {
      if (!silent) setStatus('小文件清理阈值必须大于 0 MB。', 'error');
      return false;
    }

    GM_setValue(OFFLINE115_SAVE_PATH_KEY, offline115SavePath);
    GM_setValue(OFFLINE115_SAVE_PATH_CID_KEY, offline115SavePathCid);
    GM_setValue(OFFLINE115_AUTO_RENAME_KEY, autoRename ? '1' : '0');
    GM_setValue(OFFLINE115_AUTO_DELETE_SMALL_KEY, autoDeleteSmall ? '1' : '0');
    GM_setValue(OFFLINE115_DELETE_SIZE_THRESHOLD_KEY, String(Math.max(1, Math.floor(deleteThreshold))));

    if (useLocal) {
      GM_setValue(HELPER_MODE_KEY, HELPER_MODE_LOCAL);
      if (helperUrlText) {
        const serverUrl = validateHelperUrl(helperUrlText);
        if (serverUrl && !isLocalHelperUrl(serverUrl)) GM_setValue(HELPER_URL_KEY, serverUrl);
      }
      saveHelperToken(token);
      if (!silent) setStatus(`已选择本机服务：${DEFAULT_HELPER_URL}；115 路径：${offline115SavePath}（CID: ${offline115SavePathCid}）`, 'success');
      syncSettingsModeUi();
      updateHelperAddressUi();
      return true;
    }

    const helperUrl = validateHelperUrl(helperUrlText);
    if (!helperUrl || isLocalHelperUrl(helperUrl)) {
      if (!silent) setStatus('服务器地址无效，请填写服务器 http 或 https 地址。', 'error');
      return false;
    }

    GM_setValue(HELPER_MODE_KEY, HELPER_MODE_SERVER);
    GM_setValue(HELPER_URL_KEY, helperUrl);
    saveHelperToken(token);
    if (!silent) setStatus(`已选择服务器服务：${helperUrl}；115 路径：${offline115SavePath}（CID: ${offline115SavePathCid}）`, 'success');
    syncSettingsModeUi();
    updateHelperAddressUi();
    return true;
  }

  function queueSettingsAutoSave() {
    clearTimeout(state.settingsSaveTimer);
    state.settingsSaveTimer = setTimeout(() => {
      state.settingsSaveTimer = 0;
      persistSettings(true);
    }, 400);
  }

  function handleSaveSettings() {
    persistSettings(false);
  }

  function handleResetSettings() {
    if (typeof GM_setValue !== 'function') {
      setStatus('当前脚本管理器不支持保存设置。', 'error');
      return;
    }

    GM_setValue(HELPER_MODE_KEY, HELPER_MODE_LOCAL);
    if (ui.localHelperCheckbox) ui.localHelperCheckbox.checked = true;
    syncSettingsModeUi();
    updateHelperAddressUi();
    setStatus(`已切回本机服务：${DEFAULT_HELPER_URL}`, 'success');
  }

  function isPanelCollapsed() {
    return getStoredBoolean(PANEL_COLLAPSED_KEY, false);
  }

  function setPanelCollapsed(collapsed) {
    if (typeof GM_setValue === 'function') GM_setValue(PANEL_COLLAPSED_KEY, collapsed ? '1' : '0');
  }

  function applyPanelCollapsed(collapsed) {
    if (!ui.panel) return;
    ui.panel.classList.toggle('is-collapsed', Boolean(collapsed));
    if (ui.collapseButton) {
      ui.collapseButton.textContent = collapsed ? '展开' : '收起';
      ui.collapseButton.title = collapsed ? '展开磁力检索助手' : '收起磁力检索助手';
      ui.collapseButton.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
  }

  function togglePanelCollapsed() {
    const collapsed = !(ui.panel && ui.panel.classList.contains('is-collapsed'));
    setPanelCollapsed(collapsed);
    applyPanelCollapsed(collapsed);
  }

  function addStyles() {
    const css = `
      #jlht-panel {
        position: fixed;
        right: 12px;
        bottom: 12px;
        z-index: 2147483647;
        width: min(380px, calc(100vw - 24px));
        border: 1px solid rgba(30, 41, 59, .16);
        border-radius: 8px;
        background: rgba(255, 255, 255, .97);
        box-shadow: 0 14px 36px rgba(15, 23, 42, .18);
        color: #0f172a;
        font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow: hidden;
      }
      #jlht-panel.is-collapsed {
        width: auto;
        min-width: 168px;
      }
      #jlht-panel * { box-sizing: border-box; }
      .jlht-head { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
      .is-collapsed .jlht-head { border-bottom: 0; }
      .jlht-title-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 6px;
      }
      .is-collapsed .jlht-title-row { margin: 0; }
      .jlht-title-main {
        flex: 1;
        min-width: 0;
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        font-weight: 800;
      }
      .jlht-collapse-toggle {
        flex: 0 0 auto;
        height: 24px;
        padding: 0 8px;
        border: 1px solid #cbd5e1;
        border-radius: 7px;
        background: #f8fafc;
        color: #334155;
        font-size: 12px;
        font-weight: 800;
        cursor: pointer;
      }
      .jlht-collapse-toggle:hover { background: #eef2f7; }
      .jlht-query { display: flex; gap: 6px; }
      .is-collapsed .jlht-query,
      .is-collapsed .jlht-body { display: none; }
      .jlht-query input {
        flex: 1;
        min-width: 0;
        height: 30px;
        padding: 0 8px;
        border: 1px solid #cbd5e1;
        border-radius: 7px;
        color: #0f172a;
        background: #fff;
        font-size: 12px;
      }
      .jlht-body { padding: 8px 10px 10px; }
      .jlht-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 7px; }
      .jlht-helper-address {
        margin: 0 0 8px;
        padding: 6px 8px;
        border: 1px solid #e2e8f0;
        border-radius: 7px;
        background: #f8fafc;
        color: #475569;
        font-size: 11px;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        overflow-wrap: anywhere;
      }
      .jlht-helper-note {
        padding: 6px 8px;
        border: 1px dashed #cbd5e1;
        border-radius: 7px;
        background: #fff;
        color: #475569;
        font-size: 11px;
        overflow-wrap: anywhere;
      }
      .jlht-helper-note strong { color: #0f172a; }
      .jlht-settings {
        display: grid;
        gap: 6px;
        margin: 0 0 8px;
        padding: 8px;
        border: 1px solid #e2e8f0;
        border-radius: 7px;
        background: #f8fafc;
      }
      .jlht-settings[hidden] { display: none; }
      .jlht-field { display: grid; gap: 3px; }
      .jlht-field.is-disabled { opacity: .58; }
      .jlht-label { font-size: 11px; font-weight: 800; color: #475569; }
      .jlht-field input {
        width: 100%;
        min-width: 0;
        height: 28px;
        padding: 0 8px;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        color: #0f172a;
        background: #fff;
        font-size: 12px;
      }
      .jlht-check-field {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        font-weight: 800;
        color: #0f172a;
      }
      .jlht-check-field input {
        width: 16px;
        height: 16px;
        margin: 0;
      }
      .jlht-settings-actions { display: flex; flex-wrap: wrap; gap: 6px; }
      .jlht-btn {
        height: 28px;
        padding: 0 9px;
        border: 0;
        border-radius: 7px;
        background: #e2e8f0;
        color: #0f172a;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }
      .jlht-btn-primary { background: #1677ff; color: #fff; }
      .jlht-btn:disabled { cursor: not-allowed; opacity: .48; }
      .jlht-status { min-height: 16px; margin-bottom: 7px; font-size: 11px; color: #64748b; }
      .jlht-status[data-tone="success"] { color: #047857; }
      .jlht-status[data-tone="warn"] { color: #b45309; }
      .jlht-status[data-tone="error"] { color: #dc2626; }
      .jlht-status[data-tone="loading"] { color: #2563eb; }
      .jlht-list { max-height: 230px; overflow: auto; }
      .jlht-empty { padding: 9px; border-radius: 7px; background: #f8fafc; color: #64748b; }
      .jlht-result { padding: 8px; border: 1px solid #e2e8f0; border-radius: 7px; background: #fff; }
      .jlht-result + .jlht-result { margin-top: 6px; }
      .jlht-result.is-mismatch { border-color: #f59e0b; background: #fffbeb; }
      .jlht-result-head { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
      .jlht-result-actions {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 5px;
        flex: 0 0 auto;
      }
      .jlht-result-action {
        height: 22px;
        padding: 0 7px;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        background: #f8fafc;
        color: #0f172a;
        font-size: 11px;
        font-weight: 800;
        cursor: pointer;
      }
      .jlht-result-action:hover { background: #eef2f7; }
      .jlht-result-action:disabled { cursor: not-allowed; opacity: .58; }
      .jlht-offline-115 {
        border-color: #86efac;
        background: #ecfdf5;
        color: #047857;
      }
      .jlht-offline-115:hover { background: #dcfce7; }
      .jlht-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 2px;
        min-width: 0;
      }
      .jlht-size {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        min-width: 96px;
        height: 20px;
        padding: 0 6px;
        border-radius: 6px;
        background: #ecfdf5;
        color: #047857;
        font-size: 11px;
        font-weight: 900;
      }
      .jlht-size.is-unknown {
        background: #f1f5f9;
        color: #64748b;
      }
      .jlht-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 6px;
        background: #dbeafe;
        color: #1d4ed8;
        font-weight: 900;
        font-size: 11px;
      }
      .jlht-match { font-weight: 800; color: #047857; }
      .is-mismatch .jlht-match { color: #b45309; }
      .jlht-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 800; }
      .jlht-code {
        min-width: 0;
        color: #475569;
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .jlht-magnet {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-top: 4px;
        color: #64748b;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 10px;
      }
      .jlht-modal-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 18px;
        background: rgba(15, 23, 42, .48);
      }
      .jlht-modal {
        width: min(430px, calc(100vw - 36px));
        max-height: calc(100vh - 36px);
        overflow: auto;
        border-radius: 10px;
        background: #fff;
        box-shadow: 0 24px 64px rgba(15, 23, 42, .32);
        color: #0f172a;
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .jlht-modal-header {
        padding: 13px 14px;
        border-bottom: 1px solid #e2e8f0;
      }
      .jlht-modal-title {
        margin: 0;
        font-size: 14px;
        font-weight: 900;
      }
      .jlht-modal-body {
        display: grid;
        gap: 8px;
        padding: 13px 14px;
      }
      .jlht-modal-info {
        display: grid;
        grid-template-columns: 76px minmax(0, 1fr);
        gap: 8px;
        color: #475569;
      }
      .jlht-modal-info strong { color: #0f172a; }
      .jlht-modal-info span { min-width: 0; overflow-wrap: anywhere; }
      .jlht-modal-link span {
        max-height: 72px;
        overflow: auto;
        padding: 7px;
        border-radius: 7px;
        background: #f8fafc;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 11px;
      }
      .jlht-modal-note {
        padding: 8px 9px;
        border-radius: 7px;
        background: #f8fafc;
        color: #64748b;
        font-size: 12px;
      }
      .jlht-modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 14px;
        border-top: 1px solid #e2e8f0;
      }
    `;

    if (typeof GM_addStyle === 'function') {
      GM_addStyle(css);
      return;
    }

    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function createButton(label, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `jlht-btn ${className || ''}`.trim();
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  function createPanel() {
    addStyles();

    const panel = document.createElement('section');
    panel.id = 'jlht-panel';
    ui.panel = panel;

    const head = document.createElement('div');
    head.className = 'jlht-head';

    const titleRow = document.createElement('div');
    titleRow.className = 'jlht-title-row';

    const title = document.createElement('h3');
    title.className = 'jlht-title-main';
    title.textContent = '番号磁力检索助手';

    ui.collapseButton = document.createElement('button');
    ui.collapseButton.type = 'button';
    ui.collapseButton.className = 'jlht-collapse-toggle';
    ui.collapseButton.addEventListener('click', togglePanelCollapsed);
    titleRow.append(title, ui.collapseButton);

    const queryRow = document.createElement('div');
    queryRow.className = 'jlht-query';

    ui.queryInput = document.createElement('input');
    ui.queryInput.type = 'text';
    ui.queryInput.value = buildDefaultQuery();
    state.lastAutoQuery = ui.queryInput.value;
    ui.queryInput.placeholder = '例如 JUR-070 UC';
    ui.queryInput.addEventListener('input', () => {
      state.queryTouched = true;
    });

    queryRow.appendChild(ui.queryInput);
    head.append(titleRow, queryRow);

    const body = document.createElement('div');
    body.className = 'jlht-body';

    const actions = document.createElement('div');
    actions.className = 'jlht-actions';

    ui.searchButton = createButton('检索磁力', 'jlht-btn-primary', handleSearch);
    ui.copyMagnetButton = createButton('复制 magnet', '', handleCopyMagnets);
    ui.copyCompareButton = createButton('复制对比结果', '', handleCopyCompare);
    ui.exportButton = createButton('导出对比 TXT', '', handleExportCompare);
    ui.settingsButton = createButton('抓取设置', '', toggleSettings);
    actions.append(ui.searchButton, ui.copyMagnetButton, ui.copyCompareButton, ui.exportButton, ui.settingsButton);

    ui.helperAddressText = document.createElement('div');
    ui.helperAddressText.className = 'jlht-helper-address';

    ui.settings = document.createElement('div');
    ui.settings.className = 'jlht-settings';
    ui.settings.hidden = true;

    const helperAddressNote = document.createElement('div');
    helperAddressNote.className = 'jlht-helper-note';
    const savedLabel = document.createElement('strong');
    savedLabel.textContent = '已保存地址：';
    ui.savedHelperUrlText = document.createElement('span');
    const localBreak = document.createElement('br');
    const localLabel = document.createElement('strong');
    localLabel.textContent = '本机地址：';
    ui.localHelperUrlText = document.createElement('span');
    const selectedBreak = document.createElement('br');
    const selectedLabel = document.createElement('strong');
    selectedLabel.textContent = '当前勾选预览：';
    ui.selectedHelperUrlText = document.createElement('span');
    helperAddressNote.append(savedLabel, ui.savedHelperUrlText, localBreak, localLabel, ui.localHelperUrlText, selectedBreak, selectedLabel, ui.selectedHelperUrlText);

    const helperModeField = document.createElement('label');
    helperModeField.className = 'jlht-check-field';
    ui.localHelperCheckbox = document.createElement('input');
    ui.localHelperCheckbox.type = 'checkbox';
    ui.localHelperCheckbox.checked = isUsingLocalHelper();
    ui.localHelperCheckbox.addEventListener('change', () => {
      syncSettingsModeUi();
      queueSettingsAutoSave();
    });
    const helperModeLabel = document.createElement('span');
    helperModeLabel.textContent = '使用本机服务';
    helperModeField.append(ui.localHelperCheckbox, helperModeLabel);

    const helperUrlField = document.createElement('label');
    helperUrlField.className = 'jlht-field';
    ui.helperUrlField = helperUrlField;
    const helperUrlLabel = document.createElement('span');
    helperUrlLabel.className = 'jlht-label';
    helperUrlLabel.textContent = '服务器服务地址';
    ui.helperUrlInput = document.createElement('input');
    ui.helperUrlInput.type = 'url';
    ui.helperUrlInput.value = getServerHelperUrl();
    ui.helperUrlInput.placeholder = 'https://你的域名/skrbtso/search';
    ui.helperUrlInput.addEventListener('input', () => {
      syncSettingsModeUi();
      queueSettingsAutoSave();
    });
    helperUrlField.append(helperUrlLabel, ui.helperUrlInput);

    const helperTokenField = document.createElement('label');
    helperTokenField.className = 'jlht-field';
    ui.helperTokenField = helperTokenField;
    const helperTokenLabel = document.createElement('span');
    helperTokenLabel.className = 'jlht-label';
    helperTokenLabel.textContent = '服务器 Bearer token';
    ui.helperTokenInput = document.createElement('input');
    ui.helperTokenInput.type = 'password';
    ui.helperTokenInput.value = getHelperToken();
    ui.helperTokenInput.placeholder = '服务器 .env 中的 SKRBTSO_HELPER_TOKEN';
    ui.helperTokenInput.addEventListener('input', queueSettingsAutoSave);
    helperTokenField.append(helperTokenLabel, ui.helperTokenInput);

    const offline115PathField = document.createElement('label');
    offline115PathField.className = 'jlht-field';
    const offline115PathLabel = document.createElement('span');
    offline115PathLabel.className = 'jlht-label';
    offline115PathLabel.textContent = '115 保存路径名称';
    ui.offline115SavePathInput = document.createElement('input');
    ui.offline115SavePathInput.type = 'text';
    ui.offline115SavePathInput.value = getOffline115SavePath();
    ui.offline115SavePathInput.placeholder = '例如：离线下载';
    ui.offline115SavePathInput.addEventListener('input', queueSettingsAutoSave);
    offline115PathField.append(offline115PathLabel, ui.offline115SavePathInput);

    const offline115CidField = document.createElement('label');
    offline115CidField.className = 'jlht-field';
    const offline115CidLabel = document.createElement('span');
    offline115CidLabel.className = 'jlht-label';
    offline115CidLabel.textContent = '115 保存路径 CID（0=默认）';
    ui.offline115SavePathCidInput = document.createElement('input');
    ui.offline115SavePathCidInput.type = 'text';
    ui.offline115SavePathCidInput.inputMode = 'numeric';
    ui.offline115SavePathCidInput.value = getOffline115SavePathCid();
    ui.offline115SavePathCidInput.placeholder = '0 表示使用 115 默认离线目录，指定目录填 URL 里的 cid';
    ui.offline115SavePathCidInput.addEventListener('input', queueSettingsAutoSave);
    offline115CidField.append(offline115CidLabel, ui.offline115SavePathCidInput);

    const offline115RenameField = document.createElement('label');
    offline115RenameField.className = 'jlht-check-field';
    ui.offline115AutoRenameCheckbox = document.createElement('input');
    ui.offline115AutoRenameCheckbox.type = 'checkbox';
    ui.offline115AutoRenameCheckbox.checked = getOffline115AutoRename();
    ui.offline115AutoRenameCheckbox.addEventListener('change', queueSettingsAutoSave);
    const offline115RenameLabel = document.createElement('span');
    offline115RenameLabel.textContent = '离线完成后自动重命名为番号';
    offline115RenameField.append(ui.offline115AutoRenameCheckbox, offline115RenameLabel);

    const offline115DeleteField = document.createElement('label');
    offline115DeleteField.className = 'jlht-check-field';
    ui.offline115AutoDeleteCheckbox = document.createElement('input');
    ui.offline115AutoDeleteCheckbox.type = 'checkbox';
    ui.offline115AutoDeleteCheckbox.checked = getOffline115AutoDeleteSmall();
    ui.offline115AutoDeleteCheckbox.addEventListener('change', () => {
      syncOffline115ProcessingUi();
      queueSettingsAutoSave();
    });
    const offline115DeleteLabel = document.createElement('span');
    offline115DeleteLabel.textContent = '离线完成后自动删除小文件';
    offline115DeleteField.append(ui.offline115AutoDeleteCheckbox, offline115DeleteLabel);

    const offline115DeleteThresholdField = document.createElement('label');
    offline115DeleteThresholdField.className = 'jlht-field';
    ui.offline115DeleteThresholdField = offline115DeleteThresholdField;
    const offline115DeleteThresholdLabel = document.createElement('span');
    offline115DeleteThresholdLabel.className = 'jlht-label';
    offline115DeleteThresholdLabel.textContent = '删除小于多少 MB';
    ui.offline115DeleteThresholdInput = document.createElement('input');
    ui.offline115DeleteThresholdInput.type = 'number';
    ui.offline115DeleteThresholdInput.min = '1';
    ui.offline115DeleteThresholdInput.step = '1';
    ui.offline115DeleteThresholdInput.value = String(getOffline115DeleteSizeThreshold());
    ui.offline115DeleteThresholdInput.addEventListener('input', queueSettingsAutoSave);
    offline115DeleteThresholdField.append(offline115DeleteThresholdLabel, ui.offline115DeleteThresholdInput);

    const settingsActions = document.createElement('div');
    settingsActions.className = 'jlht-settings-actions';
    settingsActions.append(
      createButton('保存设置', 'jlht-btn-primary', handleSaveSettings),
      createButton('切回本机', '', handleResetSettings)
    );

    ui.settings.append(
      helperAddressNote,
      helperModeField,
      helperUrlField,
      helperTokenField,
      offline115PathField,
      offline115CidField,
      offline115RenameField,
      offline115DeleteField,
      offline115DeleteThresholdField,
      settingsActions
    );
    syncSettingsModeUi();
    updateHelperAddressUi();

    ui.status = document.createElement('div');
    ui.status.className = 'jlht-status';

    ui.list = document.createElement('div');
    ui.list.className = 'jlht-list';

    body.append(actions, ui.helperAddressText, ui.settings, ui.status, ui.list);
    panel.append(head, body);
    document.body.appendChild(panel);
    applyPanelCollapsed(isPanelCollapsed());

    const restored = restoreLastResults();
    renderResults();
    setBusy(false);
    updateHelperAddressUi();
    if (restored) {
      setStatus(`已恢复上次结果：${state.query || '未识别搜索词'}，共 ${state.results.length} 条。`, 'success');
    } else {
      setStatus(`抓取服务：${getHelperDisplayUrl()}`, 'neutral');
      if (state.lastAutoQuery) setStatus(`已识别：${state.lastAutoQuery}`, 'success');
    }
    scheduleDefaultQueryRefresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createPanel, { once: true });
  } else {
    createPanel();
  }
})();
