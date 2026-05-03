// ==UserScript==
// @name         001-005 常见番号磁力检索助手
// @namespace    local://115emby/jav-local-skrbtso-helper-test
// @version      0.2.0
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
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const SEARCH_ORIGIN = 'https://skrbtso.top';
  const DEFAULT_HELPER_URL = 'http://127.0.0.1:8787/skrbtso/search';
  const HELPER_URL_KEY = 'jlht_skrbtso_helper_url';
  const HELPER_TOKEN_KEY = 'jlht_skrbtso_helper_token';
  const QUERY_SUFFIX = 'UC';
  const MAX_RESULTS = 3;
  const HELPER_TIMEOUT_MS = 180000;
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

  function getHelperUrl() {
    return normalizeText(getStoredValue(HELPER_URL_KEY, DEFAULT_HELPER_URL)) || DEFAULT_HELPER_URL;
  }

  function getHelperToken() {
    return normalizeText(getStoredValue(HELPER_TOKEN_KEY, ''));
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

  function getHelperDisplayUrl() {
    return getHelperUrl().replace(/[?&](?:token|authorization)=[^&]*/ig, '');
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

  function buildDefaultQuery() {
    const code = getPageCode();
    return code ? `${code} ${QUERY_SUFFIX}` : '';
  }

  function refreshDefaultQueryFromPage() {
    if (!ui.queryInput || state.busy || state.queryTouched) return false;

    const query = buildDefaultQuery();
    if (!query || query === state.lastAutoQuery) return false;

    ui.queryInput.value = query;
    state.lastAutoQuery = query;
    setStatus(`已识别：${query}`, 'success');
    return true;
  }

  function scheduleDefaultQueryRefresh() {
    let tries = 0;
    const interval = setInterval(() => {
      tries += 1;
      refreshDefaultQueryFromPage();
      if (tries >= 30 || state.queryTouched) clearInterval(interval);
    }, 1000);

    if (typeof MutationObserver === 'function') {
      const observer = new MutationObserver(() => {
        if (refreshDefaultQueryFromPage() || state.queryTouched) observer.disconnect();
      });
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 30000);
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
            reject(new Error(message || `抓取服务 HTTP ${response.status}`));
            return;
          }

          if (!payload || typeof payload !== 'object') {
            reject(new Error('抓取服务返回格式无效'));
            return;
          }

          if (payload.ok === false) {
            reject(new Error(payload.error || payload.message || '抓取服务返回失败'));
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
    const helperMatched = item && typeof item.titleMatched === 'boolean' ? item.titleMatched : null;
    const titleMatched = helperMatched !== null ? helperMatched : Boolean(queryCode && resultCode && queryCode === resultCode);

    return {
      title,
      query: normalizeText(item && item.query) || query,
      queryCode,
      resultCode,
      titleMatched,
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

      const copyOneButton = document.createElement('button');
      copyOneButton.type = 'button';
      copyOneButton.className = 'jlht-copy-one';
      copyOneButton.textContent = '复制';
      copyOneButton.title = `复制第 ${index + 1} 条 magnet`;
      copyOneButton.addEventListener('click', () => handleCopyResult(item, index));

      const title = document.createElement('div');
      title.className = 'jlht-title';
      title.textContent = item.title;

      const code = document.createElement('div');
      code.className = 'jlht-code';
      code.textContent = `原始：${item.queryCode || '未识别'} / 结果：${item.resultCode || '未识别'}`;

      const magnet = document.createElement('div');
      magnet.className = 'jlht-magnet';
      magnet.textContent = item.magnet;

      head.append(badge, match, copyOneButton);
      row.append(head, title, code, magnet);
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
    state.results = [];
    renderResults();
    setBusy(true);
    setStatus(`正在调用抓取服务：${query}`, 'loading');

    try {
      state.results = await searchByLocalHelper(query);
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
      ui.helperUrlInput.value = getHelperUrl();
      ui.helperTokenInput.value = getHelperToken();
    }
  }

  function handleSaveSettings() {
    if (typeof GM_setValue !== 'function') {
      setStatus('当前脚本管理器不支持保存设置。', 'error');
      return;
    }

    const helperUrl = validateHelperUrl(normalizeText(ui.helperUrlInput && ui.helperUrlInput.value));
    if (!helperUrl) {
      setStatus('抓取服务地址无效，请填写 http 或 https 地址。', 'error');
      return;
    }

    const token = normalizeText(ui.helperTokenInput && ui.helperTokenInput.value);
    GM_setValue(HELPER_URL_KEY, helperUrl);
    if (token) {
      GM_setValue(HELPER_TOKEN_KEY, token);
    } else if (typeof GM_deleteValue === 'function') {
      GM_deleteValue(HELPER_TOKEN_KEY);
    }

    setStatus(`抓取服务已保存：${helperUrl}`, 'success');
  }

  function handleResetSettings() {
    if (typeof GM_deleteValue === 'function') {
      GM_deleteValue(HELPER_URL_KEY);
      GM_deleteValue(HELPER_TOKEN_KEY);
    }

    if (ui.helperUrlInput) ui.helperUrlInput.value = DEFAULT_HELPER_URL;
    if (ui.helperTokenInput) ui.helperTokenInput.value = '';
    setStatus(`已恢复本机默认服务：${DEFAULT_HELPER_URL}`, 'success');
  }

  function addStyles() {
    const css = `
      #jlht-panel {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        width: min(430px, calc(100vw - 36px));
        border: 1px solid rgba(30, 41, 59, .16);
        border-radius: 10px;
        background: rgba(255, 255, 255, .97);
        box-shadow: 0 18px 48px rgba(15, 23, 42, .2);
        color: #0f172a;
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow: hidden;
      }
      #jlht-panel * { box-sizing: border-box; }
      .jlht-head { padding: 12px 14px; border-bottom: 1px solid #e2e8f0; }
      .jlht-title-main { margin: 0 0 8px; font-size: 14px; font-weight: 800; }
      .jlht-query { display: flex; gap: 8px; }
      .jlht-query input {
        flex: 1;
        min-width: 0;
        height: 34px;
        padding: 0 10px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        color: #0f172a;
        background: #fff;
      }
      .jlht-body { padding: 12px 14px 14px; }
      .jlht-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
      .jlht-settings {
        display: grid;
        gap: 8px;
        margin: 0 0 10px;
        padding: 10px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #f8fafc;
      }
      .jlht-settings[hidden] { display: none; }
      .jlht-field { display: grid; gap: 4px; }
      .jlht-label { font-size: 12px; font-weight: 800; color: #475569; }
      .jlht-field input {
        width: 100%;
        min-width: 0;
        height: 32px;
        padding: 0 9px;
        border: 1px solid #cbd5e1;
        border-radius: 7px;
        color: #0f172a;
        background: #fff;
      }
      .jlht-settings-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      .jlht-btn {
        height: 32px;
        padding: 0 11px;
        border: 0;
        border-radius: 8px;
        background: #e2e8f0;
        color: #0f172a;
        font-weight: 700;
        cursor: pointer;
      }
      .jlht-btn-primary { background: #1677ff; color: #fff; }
      .jlht-btn:disabled { cursor: not-allowed; opacity: .48; }
      .jlht-status { min-height: 18px; margin-bottom: 9px; font-size: 12px; color: #64748b; }
      .jlht-status[data-tone="success"] { color: #047857; }
      .jlht-status[data-tone="warn"] { color: #b45309; }
      .jlht-status[data-tone="error"] { color: #dc2626; }
      .jlht-status[data-tone="loading"] { color: #2563eb; }
      .jlht-list { max-height: 280px; overflow: auto; }
      .jlht-empty { padding: 12px; border-radius: 8px; background: #f8fafc; color: #64748b; }
      .jlht-result { padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; }
      .jlht-result + .jlht-result { margin-top: 8px; }
      .jlht-result.is-mismatch { border-color: #f59e0b; background: #fffbeb; }
      .jlht-result-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
      .jlht-copy-one {
        margin-left: auto;
        height: 24px;
        padding: 0 9px;
        border: 1px solid #cbd5e1;
        border-radius: 7px;
        background: #f8fafc;
        color: #0f172a;
        font-size: 12px;
        font-weight: 800;
        cursor: pointer;
      }
      .jlht-copy-one:hover { background: #eef2f7; }
      .jlht-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border-radius: 7px;
        background: #dbeafe;
        color: #1d4ed8;
        font-weight: 900;
      }
      .jlht-match { font-weight: 800; color: #047857; }
      .is-mismatch .jlht-match { color: #b45309; }
      .jlht-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 800; }
      .jlht-code { margin-top: 2px; color: #475569; font-size: 12px; }
      .jlht-magnet {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-top: 5px;
        color: #64748b;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 11px;
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

    const head = document.createElement('div');
    head.className = 'jlht-head';

    const title = document.createElement('h3');
    title.className = 'jlht-title-main';
    title.textContent = '番号磁力检索助手';

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
    head.append(title, queryRow);

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

    ui.settings = document.createElement('div');
    ui.settings.className = 'jlht-settings';
    ui.settings.hidden = true;

    const helperUrlField = document.createElement('label');
    helperUrlField.className = 'jlht-field';
    const helperUrlLabel = document.createElement('span');
    helperUrlLabel.className = 'jlht-label';
    helperUrlLabel.textContent = '抓取服务地址';
    ui.helperUrlInput = document.createElement('input');
    ui.helperUrlInput.type = 'url';
    ui.helperUrlInput.value = getHelperUrl();
    ui.helperUrlInput.placeholder = 'https://你的域名/skrbtso/search';
    helperUrlField.append(helperUrlLabel, ui.helperUrlInput);

    const helperTokenField = document.createElement('label');
    helperTokenField.className = 'jlht-field';
    const helperTokenLabel = document.createElement('span');
    helperTokenLabel.className = 'jlht-label';
    helperTokenLabel.textContent = 'Bearer token';
    ui.helperTokenInput = document.createElement('input');
    ui.helperTokenInput.type = 'password';
    ui.helperTokenInput.value = getHelperToken();
    ui.helperTokenInput.placeholder = '服务器 .env 中的 SKRBTSO_HELPER_TOKEN';
    helperTokenField.append(helperTokenLabel, ui.helperTokenInput);

    const settingsActions = document.createElement('div');
    settingsActions.className = 'jlht-settings-actions';
    settingsActions.append(
      createButton('保存设置', 'jlht-btn-primary', handleSaveSettings),
      createButton('恢复本机', '', handleResetSettings)
    );

    ui.settings.append(helperUrlField, helperTokenField, settingsActions);

    ui.status = document.createElement('div');
    ui.status.className = 'jlht-status';

    ui.list = document.createElement('div');
    ui.list.className = 'jlht-list';

    body.append(actions, ui.settings, ui.status, ui.list);
    panel.append(head, body);
    document.body.appendChild(panel);

    renderResults();
    setBusy(false);
    setStatus(`抓取服务：${getHelperDisplayUrl()}`, 'neutral');
    if (state.lastAutoQuery) setStatus(`已识别：${state.lastAutoQuery}`, 'success');
    scheduleDefaultQueryRefresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createPanel, { once: true });
  } else {
    createPanel();
  }
})();
