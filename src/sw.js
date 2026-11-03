// Service Worker:
// Uses YouTube's built-in internal API (/youtubei/v1/search & /youtubei/v1/navigation/resolve_url)
// Works for all users out-of-the-box with zero API keys or setup required.

const CACHE_TTL_MS = 10 * 60 * 1000;
const searchCache = new Map();
const idCache = new Map();

const YT_CONTEXT = {
  client: {
    clientName: 'WEB',
    clientVersion: '2.20260401.00.00',
    hl: 'en',
    gl: 'US'
  }
};

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install' && reason !== 'update') return;
  const tabs = await chrome.tabs.query({ url: 'https://*.youtube.com/*', discarded: false });
  await Promise.all(tabs.map(async ({ id: tabId }) => {
    const target = { tabId };
    try {
      await chrome.scripting.insertCSS({ target, files: ['src/content.css'] });
      await chrome.scripting.executeScript({ target, files: ['src/content.js'] });
    } catch (e) {}
  }));
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg) return false;

  if (msg.type === 'searchChannels' && typeof msg.query === 'string') {
    searchChannels(msg.query.trim())
      .then((channels) => sendResponse({ ok: true, channels }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err), channels: [] }));
    return true;
  }

  if (msg.type === 'resolveChannelId' && typeof msg.handleOrUrl === 'string') {
    resolveChannelId(msg.handleOrUrl.trim())
      .then((channelId) => sendResponse({ ok: true, channelId }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err), channelId: '' }));
    return true;
  }

  return false;
});

async function searchChannels(query) {
  if (!query) return [];
  const cacheKey = query.toLowerCase();
  const hit = searchCache.get(cacheKey);
  if (hit && Date.now() - hit.time < CACHE_TTL_MS) {
    return hit.channels;
  }

  const res = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: YT_CONTEXT,
      query,
      params: 'EgIQAg==' // Filter strictly to Channels
    })
  });
  if (!res.ok) throw new Error(`YouTube API returned HTTP ${res.status}`);
  const data = await res.json();
  const channels = parseInnerTubeSearch(data);

  searchCache.set(cacheKey, { time: Date.now(), channels });
  if (searchCache.size > 80) searchCache.delete(searchCache.keys().next().value);
  return channels;
}

function parseInnerTubeSearch(data) {
  const sections =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  const results = [];
  const seen = new Set();

  for (const sec of sections) {
    const items = sec?.itemSectionRenderer?.contents || [];
    for (const item of items) {
      const c = item.channelRenderer;
      if (!c) continue;

      const channelId = c.channelId || c.navigationEndpoint?.browseEndpoint?.browseId || '';
      if (!channelId.startsWith('UC')) continue;

      const name =
        c.title?.simpleText ||
        (Array.isArray(c.title?.runs) ? c.title.runs.map((r) => r.text).join('') : '');
      if (!name) continue;

      const canonical = c.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || '';
      const subText =
        c.subscriberCountText?.simpleText ||
        (Array.isArray(c.subscriberCountText?.runs) ? c.subscriberCountText.runs.map((r) => r.text).join('') : '');
      const videoCountText =
        c.videoCountText?.simpleText ||
        (Array.isArray(c.videoCountText?.runs) ? c.videoCountText.runs.map((r) => r.text).join('') : '');

      let handle = '';
      if (subText.startsWith('@')) {
        handle = subText.trim();
      } else if (canonical.startsWith('/@')) {
        handle = decodeURIComponent(canonical.slice(1).trim());
      } else {
        handle = `@${name.replace(/\s+/g, '')}`;
      }

      const subs = subText.startsWith('@') ? videoCountText : subText;
      const thumbs = c.thumbnail?.thumbnails || [];
      let avatar = thumbs.length ? thumbs[thumbs.length - 1].url : '';
      if (avatar.startsWith('//')) avatar = `https:${avatar}`;

      if (seen.has(channelId)) continue;
      seen.add(channelId);

      idCache.set(handle.toLowerCase(), channelId);

      results.push({
        id: channelId,
        name,
        handle,
        subs: subs || '',
        avatar
      });

      if (results.length >= 25) break;
    }
  }

  return results;
}

async function resolveChannelId(handleOrUrl) {
  if (/^UC[\w-]{22}$/.test(handleOrUrl)) return handleOrUrl;

  const cleanKey = handleOrUrl.toLowerCase();
  if (idCache.has(cleanKey)) return idCache.get(cleanKey);

  const fullUrl = handleOrUrl.startsWith('http')
    ? handleOrUrl
    : `https://www.youtube.com/${handleOrUrl.startsWith('/') ? handleOrUrl.slice(1) : handleOrUrl}`;

  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/navigation/resolve_url?prettyPrint=false', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: YT_CONTEXT,
        url: fullUrl
      })
    });
    if (res.ok) {
      const data = await res.json();
      const browseId = data?.endpoint?.browseEndpoint?.browseId || '';
      if (browseId.startsWith('UC')) {
        idCache.set(cleanKey, browseId);
        return browseId;
      }
    }
  } catch (e) {}

  const channels = await searchChannels(handleOrUrl);
  if (channels.length && channels[0].id.startsWith('UC')) {
    idCache.set(cleanKey, channels[0].id);
    return channels[0].id;
  }

  throw new Error('Could not resolve UC Channel ID');
  }
