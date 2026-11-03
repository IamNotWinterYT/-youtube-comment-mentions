// Isolated-world content script:
// - Keeps the '@' when typing inline (only replaces the search text after '@')
// - Checks the character immediately before the pasted Channel ID:
//   * If the character before the ID is already '@', it pastes just 'UC... ' (leaving '@UC... ')
//   * If there is NO '@' before the ID (e.g. opened via the tiny '@' toolbar button), it automatically adds '@' before the ID ('@UC... ')

(() => {
  const TAKEOVER = 'ytm-takeover';
  document.dispatchEvent(new CustomEvent(TAKEOVER));
  const life = new AbortController();
  const { signal } = life;
  let retired = false;

  const BOX_SCOPE = 'ytd-comment-simplebox-renderer, ytd-comment-thread-renderer, ytd-comment-replies-renderer';
  const POST_DIALOG = 'ytd-backstage-post-dialog-renderer';
  const PICKER_W = 360;
  const PICKER_H = 420;
  const SEARCH_DEBOUNCE_MS = 220;

  const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23888'%3E%3Ccircle cx='12' cy='8' r='4'/%3E%3Cpath d='M12 14c-6.1 0-8 4-8 4v2h16v-2s-1.9-4-8-4z'/%3E%3C/svg%3E";

  const YT_CONTEXT = {
    client: {
      clientName: 'WEB',
      clientVersion: '2.20260401.00.00',
      hl: 'en',
      gl: 'US'
    }
  };

  const PICKER_CSS = `
    :host { all: initial; position: fixed; z-index: 2147483647; }
    .panel {
      --bg: #fff; --fg: #0f0f0f; --muted: #606060; --line: rgba(0,0,0,.12);
      --field: rgba(0,0,0,.06); --hover: rgba(0,0,0,.06); --active: rgba(6,95,212,.12);
      --accent: #065fd4; --badge-bg: rgba(6,95,212,.1);
      box-sizing: border-box; display: flex; flex-direction: column;
      width: ${PICKER_W}px; height: ${PICKER_H}px;
      background: var(--bg); color: var(--fg);
      border: 1px solid var(--line); border-radius: 12px; overflow: hidden;
      box-shadow: 0 8px 28px rgba(0,0,0,.35);
      font: 13px/1.4 Roboto, Arial, sans-serif;
    }
    .panel[data-dark] {
      --bg: #212121; --fg: #f1f1f1; --muted: #aaa; --line: rgba(255,255,255,.14);
      --field: rgba(255,255,255,.08); --hover: rgba(255,255,255,.08); --active: rgba(62,166,255,.18);
      --accent: #3ea6ff; --badge-bg: rgba(62,166,255,.15);
    }
    .search-bar {
      flex: none; display: flex; align-items: center; gap: 8px;
      padding: 10px; border-bottom: 1px solid var(--line);
    }
    .search-icon {
      flex: none; width: 18px; height: 18px; color: var(--accent);
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 16px; user-select: none;
    }
    input {
      box-sizing: border-box; flex: 1; min-width: 0; height: 34px; padding: 0 12px;
      border: 1px solid transparent; border-radius: 17px; outline: none;
      background: var(--field); color: var(--fg); font: inherit;
    }
    input:focus { border-color: var(--accent); }
    input::placeholder { color: var(--muted); }
    .section-label {
      flex: none; padding: 6px 12px 4px; font-size: 11px; font-weight: 600;
      color: var(--muted); text-transform: uppercase; letter-spacing: 0.4px;
    }
    .status {
      flex: none; padding: 12px; text-align: center; color: var(--muted); font-size: 12px;
    }
    .status:empty { display: none; }
    .list {
      flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto;
      padding: 4px 0; display: flex; flex-direction: column;
    }
    .item {
      display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 8px 12px; border: 0; background: transparent;
      color: inherit; font: inherit; text-align: left; cursor: pointer;
      box-sizing: border-box;
    }
    .item:hover, .item[data-selected="true"] { background: var(--hover); }
    .item[data-selected="true"] { background: var(--active); }
    .avatar {
      flex: none; width: 34px; height: 34px; border-radius: 50%;
      object-fit: cover; background: var(--field);
    }
    .meta {
      flex: 1; min-width: 0; display: flex; flex-direction: column;
    }
    .name-row { display: flex; align-items: center; gap: 6px; }
    .name {
      font-weight: 500; color: var(--fg);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .badge {
      flex: none; font-size: 10px; font-weight: 500; padding: 1px 6px;
      border-radius: 8px; background: var(--badge-bg); color: var(--accent);
    }
    .subline {
      font-size: 11px; color: var(--muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      font-family: Roboto Mono, monospace, sans-serif;
    }
    .footer-tip {
      flex: none; padding: 6px 12px; border-top: 1px solid var(--line);
      font-size: 11px; color: var(--muted); display: flex; justify-content: space-between;
    }
  `;

  async function directPageSearch(query) {
    const res = await fetch('/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: YT_CONTEXT,
        query,
        params: 'EgIQAg=='
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
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
        if (subText.startsWith('@')) handle = subText.trim();
        else if (canonical.startsWith('/@')) handle = decodeURIComponent(canonical.slice(1).trim());
        else handle = `@${name.replace(/\s+/g, '')}`;

        const subs = subText.startsWith('@') ? videoCountText : subText;
        const thumbs = c.thumbnail?.thumbnails || [];
        let avatar = thumbs.length ? thumbs[thumbs.length - 1].url : '';
        if (avatar.startsWith('//')) avatar = `https:${avatar}`;

        if (seen.has(channelId)) continue;
        seen.add(channelId);

        results.push({ id: channelId, name, handle, subs: subs || '', avatar });
        if (results.length >= 25) break;
      }
    }
    return results;
  }

  async function directPageResolveId(handleOrUrl) {
    if (/^UC[\w-]{22}$/.test(handleOrUrl)) return handleOrUrl;
    const fullUrl = handleOrUrl.startsWith('http')
      ? handleOrUrl
      : `https://www.youtube.com/${handleOrUrl.startsWith('/') ? handleOrUrl.slice(1) : handleOrUrl}`;

    const res = await fetch('/youtubei/v1/navigation/resolve_url?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: YT_CONTEXT,
        url: fullUrl
      })
    });
    if (res.ok) {
      const data = await res.json();
      const browseId = data?.endpoint?.browseEndpoint?.browseId || '';
      if (browseId.startsWith('UC')) return browseId;
    }
    return '';
  }

  function getPagePeople() {
    const people = new Map();

    const ownerLink = document.querySelector('#upload-info #channel-name a, ytd-video-owner-renderer #channel-name a');
    const ownerAvatar = document.querySelector('#upload-info #avatar img, ytd-video-owner-renderer #avatar img');
    if (ownerLink) {
      const name = ownerLink.textContent.trim();
      const href = ownerLink.getAttribute('href') || '';
      const handle = extractHandle(href, name);
      if (name && handle) {
        people.set(handle.toLowerCase(), {
          id: extractChannelId(href),
          href,
          name,
          handle,
          subs: 'Video Creator',
          avatar: ownerAvatar?.src || DEFAULT_AVATAR,
          badge: 'Creator'
        });
      }
    }

    const commentNodes = document.querySelectorAll('ytd-comment-view-model, ytd-comment-renderer, ytd-comment-thread-renderer');
    for (const node of commentNodes) {
      const authorLink = node.querySelector('#author-text, a#name, #header-author a');
      const avatarImg = node.querySelector('#author-thumbnail img, yt-img-shadow#author-thumbnail img');
      if (!authorLink) continue;

      const rawText = authorLink.textContent.trim();
      if (!rawText) continue;
      const href = authorLink.getAttribute('href') || '';
      const handle = extractHandle(href, rawText);
      const name = rawText.startsWith('@') ? rawText.slice(1) : rawText;

      const key = handle.toLowerCase();
      if (!people.has(key)) {
        people.set(key, {
          id: extractChannelId(href),
          href,
          name,
          handle,
          subs: 'Commented on video',
          avatar: avatarImg?.src || DEFAULT_AVATAR,
          badge: 'Commenter'
        });
      }
    }

    return Array.from(people.values());
  }

  function extractHandle(href, fallbackName) {
    if (href.includes('/@')) {
      return '@' + decodeURIComponent(href.split('/@')[1].split(/[/?#]/)[0]);
    }
    if (fallbackName.startsWith('@')) {
      return fallbackName.split(/\s+/)[0];
    }
    return '@' + fallbackName.replace(/\s+/g, '');
  }

  function extractChannelId(href) {
    const match = href.match(/\/channel\/(UC[\w-]{22})/);
    return match ? match[1] : '';
  }

  function addButton(box) {
    if (box.querySelector('.ytm-btn')) return;
    if (!box.closest(BOX_SCOPE) || box.closest(POST_DIALOG)) return;
    const footer = box.querySelector('#footer');
    if (!footer) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ytm-btn';
    btn.title = 'Mention someone (@)';
    btn.setAttribute('aria-label', 'Mention someone (@)');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const editor = box.querySelector('#contenteditable-root');
      if (picker.open && picker.box === box) closePicker();
      else if (editor) openFromButton(btn, box, editor);
    });

    const emoji = footer.querySelector('#emoji-button');
    if (emoji && emoji.parentElement === footer) emoji.after(btn);
    else footer.prepend(btn);
  }

  let scanQueued = false;
  function scan() {
    scanQueued = false;
    if (retired) return;
    for (const box of document.querySelectorAll('ytd-commentbox')) addButton(box);
  }

  const scanner = new MutationObserver(() => {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(scan);
  });
  scanner.observe(document.documentElement, { childList: true, subtree: true });

  for (const el of document.querySelectorAll('.ytm-btn, [data-ytm-picker]')) el.remove();
  scan();

  const picker = {
    open: false,
    host: null,
    anchor: null,
    box: null,
    editor: null,
    els: null,
    items: [],
    selectedIndex: 0,
    seq: 0,
    timer: 0,
    mentionRange: null,
    mode: 'inline'
  };

  function buildPicker() {
    const host = document.createElement('div');
    host.setAttribute('data-ytm-picker', '');
    host.setAttribute('popover', 'manual');

    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }

    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = PICKER_CSS;

    const panel = document.createElement('div');
    panel.className = 'panel';

    const searchBar = document.createElement('div');
    searchBar.className = 'search-bar';

    const icon = document.createElement('div');
    icon.className = 'search-icon';
    icon.textContent = '@';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search any YouTube channel…';
    input.autocomplete = 'off';
    input.spellcheck = false;

    searchBar.append(icon, input);

    const sectionLabel = document.createElement('div');
    sectionLabel.className = 'section-label';

    const status = document.createElement('div');
    status.className = 'status';

    const list = document.createElement('div');
    list.className = 'list';

    const footerTip = document.createElement('div');
    footerTip.className = 'footer-tip';
    footerTip.innerHTML = '<span>↑↓ Navigate • Enter Mention</span><span>Esc Close</span>';

    panel.append(searchBar, sectionLabel, status, list, footerTip);
    root.append(style, panel);

    input.addEventListener('input', () => {
      updateResults(input.value);
    });

    list.addEventListener('click', (e) => {
      const itemEl = e.target.closest('.item');
      if (!itemEl) return;
      const idx = Number(itemEl.dataset.index);
      if (picker.items[idx]) selectChannel(picker.items[idx]);
    });

    picker.host = host;
    picker.els = { panel, input, sectionLabel, status, list };
  }

  function placePicker() {
    if (!picker.open) return;
    let rect = null;
    if (picker.mode === 'inline' && picker.mentionRange) {
      const r = picker.mentionRange.getBoundingClientRect();
      if (r && (r.width || r.height)) rect = r;
    }
    if (!rect && picker.anchor && picker.anchor.isConnected) {
      rect = picker.anchor.getBoundingClientRect();
    }
    if (!rect && picker.editor && picker.editor.isConnected) {
      rect = picker.editor.getBoundingClientRect();
    }
    if (!rect) {
      closePicker();
      return;
    }

    const h = Math.min(PICKER_H, innerHeight - 16);
    picker.els.panel.style.height = `${h}px`;

    let top = rect.bottom + 8;
    if (top + h > innerHeight - 8) top = Math.max(8, rect.top - h - 8);
    const left = Math.min(Math.max(8, rect.left), innerWidth - PICKER_W - 8);

    picker.host.style.top = `${Math.max(8, top)}px`;
    picker.host.style.left = `${Math.max(8, left)}px`;
  }

  function openFromButton(btn, box, editor) {
    if (!picker.host) buildPicker();
    if (picker.open) closePicker();

    picker.open = true;
    picker.mode = 'button';
    picker.anchor = btn;
    picker.box = box;
    picker.editor = editor;
    picker.mentionRange = null;

    // Preserve current cursor position in editor if user was already typing in it
    const sel = window.getSelection();
    if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
      picker.mentionRange = sel.getRangeAt(0).cloneRange();
    }

    btn.setAttribute('aria-expanded', 'true');
    picker.els.panel.toggleAttribute('data-dark', document.documentElement.hasAttribute('dark'));

    box.append(picker.host);
    picker.host.showPopover();
    picker.els.input.value = '';
    placePicker();
    picker.els.input.focus();
    updateResults('');
  }

  function openFromInline(box, editor, range, query) {
    if (!picker.host) buildPicker();
    const wasOpen = picker.open;

    picker.open = true;
    picker.mode = 'inline';
    picker.box = box;
    picker.editor = editor;
    picker.anchor = box.querySelector('.ytm-btn') || editor;
    picker.mentionRange = range.cloneRange();

    picker.els.panel.toggleAttribute('data-dark', document.documentElement.hasAttribute('dark'));

    if (!wasOpen) {
      box.append(picker.host);
      picker.host.showPopover();
    }
    picker.els.input.value = query;
    placePicker();
    updateResults(query);
  }

  function closePicker() {
    if (!picker.open) return;
    picker.open = false;
    clearTimeout(picker.timer);
    picker.seq++;
    if (picker.anchor && picker.anchor.classList?.contains('ytm-btn')) {
      picker.anchor.setAttribute('aria-expanded', 'false');
    }
    picker.host.remove();
  }

  function updateResults(rawQuery) {
    const query = rawQuery.trim().replace(/^@/, '');
    const seq = ++picker.seq;
    clearTimeout(picker.timer);

    const localPeople = getPagePeople().filter((p) => {
      if (!query) return true;
      const q = query.toLowerCase();
      return p.name.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q) || (p.id && p.id.toLowerCase().includes(q));
    });

    if (!query) {
      picker.els.sectionLabel.textContent = 'Commenters on video (Type to search all of YouTube)';
      picker.els.status.textContent = localPeople.length ? '' : 'Type any name above to search all YouTube channels…';
      renderItems(localPeople);
      return;
    }

    picker.els.sectionLabel.textContent = `Searching YouTube for "${query}"…`;
    renderItems(localPeople);
    picker.els.status.textContent = localPeople.length ? '' : 'Searching global YouTube channels…';

    picker.timer = setTimeout(async () => {
      let remote = [];
      try {
        remote = await directPageSearch(query);
      } catch (e) {
        try {
          const reply = await chrome.runtime.sendMessage({ type: 'searchChannels', query });
          if (reply && reply.ok && Array.isArray(reply.channels)) remote = reply.channels;
        } catch (err) {}
      }

      if (seq !== picker.seq || !picker.open) return;

      const merged = [];
      const seenHandles = new Set();

      for (const local of localPeople) {
        const matchRemote = remote.find((r) => r.handle.toLowerCase() === local.handle.toLowerCase());
        if (matchRemote && !local.id) local.id = matchRemote.id;
        merged.push(local);
        seenHandles.add(local.handle.toLowerCase());
      }

      for (const ch of remote) {
        const key = ch.handle.toLowerCase();
        if (!seenHandles.has(key)) {
          seenHandles.add(key);
          merged.push({ ...ch, badge: 'YouTube' });
        }
      }

      picker.els.sectionLabel.textContent = merged.length
        ? `Channels (${merged.length} found)`
        : 'No channels found';
      picker.els.status.textContent = merged.length ? '' : `No channels found for "${query}".`;
      renderItems(merged);
    }, SEARCH_DEBOUNCE_MS);
  }

  function renderItems(items) {
    picker.items = items;
    picker.selectedIndex = 0;

    const nodes = items.map((item, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'item';
      btn.dataset.index = String(idx);
      if (idx === 0) btn.dataset.selected = 'true';

      const img = document.createElement('img');
      img.className = 'avatar';
      img.referrerPolicy = 'no-referrer';
      img.loading = 'lazy';
      img.src = item.avatar || DEFAULT_AVATAR;
      img.alt = item.name;
      img.onerror = () => { img.src = DEFAULT_AVATAR; };

      const meta = document.createElement('div');
      meta.className = 'meta';

      const nameRow = document.createElement('div');
      nameRow.className = 'name-row';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'name';
      nameSpan.textContent = item.name;
      nameRow.append(nameSpan);

      if (item.badge) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = item.badge;
        nameRow.append(badge);
      }

      const subline = document.createElement('div');
      subline.className = 'subline';
      subline.textContent = item.id
        ? `@${item.id} • ${item.handle}`
        : `${item.handle} • Click to resolve ID`;

      meta.append(nameRow, subline);
      btn.append(img, meta);
      return btn;
    });

    picker.els.list.replaceChildren(...nodes);
  }

  function updateHighlight(newIndex) {
    if (!picker.items.length) return;
    const count = picker.items.length;
    picker.selectedIndex = ((newIndex % count) + count) % count;
    const children = picker.els.list.querySelectorAll('.item');
    children.forEach((el, i) => {
      if (i === picker.selectedIndex) {
        el.dataset.selected = 'true';
        el.scrollIntoView({ block: 'nearest' });
      } else {
        delete el.dataset.selected;
      }
    });
  }

  // Helper: Returns the single character immediately before a DOM Range inside editor
  function getCharBeforeRange(editor, range) {
    try {
      const preRange = document.createRange();
      preRange.selectNodeContents(editor);
      preRange.setEnd(range.startContainer, range.startOffset);
      const textBefore = preRange.toString();
      return textBefore.length > 0 ? textBefore[textBefore.length - 1] : '';
    } catch (e) {
      return '';
    }
  }

  async function selectChannel(channel) {
    const editor = picker.editor;
    if (!editor || !editor.isConnected) {
      closePicker();
      return;
    }

    let channelId = channel.id;

    // Resolve UC... ID via YouTube API if this commenter only had a /@handle link in the DOM
    if (!channelId || !channelId.startsWith('UC')) {
      picker.els.status.textContent = `Resolving Channel ID for ${channel.handle}…`;
      try {
        channelId = await directPageResolveId(channel.href || channel.handle);
      } catch (e) {}

      if (!channelId || !channelId.startsWith('UC')) {
        try {
          const res = await chrome.runtime.sendMessage({
            type: 'resolveChannelId',
            handleOrUrl: channel.href || channel.handle
          });
          if (res && res.ok && res.channelId) channelId = res.channelId;
        } catch (e) {}
      }
      if (channelId) channel.id = channelId;
    }

    if (!channelId || !channelId.startsWith('UC')) {
      picker.els.status.textContent = 'Could not resolve UC ID for this channel.';
      return;
    }

    editor.focus();
    const sel = window.getSelection();

    let targetRange;
    if (picker.mentionRange) {
      targetRange = picker.mentionRange;
      sel.removeAllRanges();
      sel.addRange(targetRange);
    } else if (sel.rangeCount && editor.contains(sel.anchorNode)) {
      targetRange = sel.getRangeAt(0);
    } else {
      targetRange = document.createRange();
      targetRange.selectNodeContents(editor);
      targetRange.collapse(false);
      sel.removeAllRanges();
      sel.addRange(targetRange);
    }

    // Check the character immediately before where the ID will be pasted:
    // - If the character before is ALREADY '@', do nothing to it and paste just 'UC... '
    // - If there is NO '@' before the ID, automatically add '@' before the ID ('@UC... ')
    const charBefore = getCharBeforeRange(editor, targetRange);
    let textToPaste;
    if (charBefore === '@') {
      textToPaste = `${channelId} `;
    } else if (charBefore && !/\s/.test(charBefore)) {
      textToPaste = ` @${channelId} `;
    } else {
      textToPaste = `@${channelId} `;
    }

    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, textToPaste);
    } catch (e) {
      inserted = false;
    }

    if (!inserted) {
      const range = sel.rangeCount ? sel.getRangeAt(0) : targetRange;
      range.deleteContents();
      const textNode = document.createTextNode(textToPaste);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      sel.removeAllRanges();
      sel.addRange(range);
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: textToPaste }));
    }

    closePicker();
  }

  document.addEventListener('input', (e) => {
    if (retired) return;
    const path = e.composedPath();
    if (picker.open && path.includes(picker.host)) return;

    const editor = e.target.closest?.('#contenteditable-root');
    if (!editor) return;
    const box = editor.closest('ytd-commentbox');
    if (!box) return;

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) {
      if (picker.open && picker.mode === 'inline') closePicker();
      return;
    }

    const textBeforeCursor = node.textContent.slice(0, range.startOffset);
    const match = textBeforeCursor.match(/(?:^|\s)@([\w.\- ]{0,35})$/);

    if (match) {
      const query = match[1];
      const atPos = textBeforeCursor.lastIndexOf('@');
      // Start mentionRange at atPos + 1 so the '@' you typed is NEVER removed!
      const mentionRange = document.createRange();
      mentionRange.setStart(node, atPos + 1);
      mentionRange.setEnd(node, range.startOffset);

      openFromInline(box, editor, mentionRange, query);
    } else if (picker.open && picker.mode === 'inline') {
      closePicker();
    }
  }, { signal });

  const inPicker = (e) => picker.open && e.composedPath().includes(picker.host);

  window.addEventListener('keydown', (e) => {
    if (!picker.open) return;
    if (inPicker(e)) e.stopImmediatePropagation();

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopImmediatePropagation();
      updateHighlight(picker.selectedIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopImmediatePropagation();
      updateHighlight(picker.selectedIndex - 1);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (picker.items.length > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        selectChannel(picker.items[picker.selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      closePicker();
      if (picker.editor) picker.editor.focus();
    }
  }, { capture: true, signal });

  for (const type of ['keyup', 'keypress']) {
    window.addEventListener(type, (e) => {
      if (inPicker(e)) e.stopImmediatePropagation();
    }, { capture: true, signal });
  }

  window.addEventListener('wheel', (e) => {
    if (inPicker(e)) e.stopImmediatePropagation();
  }, { capture: true, passive: true, signal });

  window.addEventListener('pointerdown', (e) => {
    if (!picker.open) return;
    const path = e.composedPath();
    if (!path.includes(picker.host) && (!picker.anchor || !path.includes(picker.anchor))) {
      closePicker();
    }
  }, { capture: true, signal });

  let placeQueued = false;
  const queuePlace = () => {
    if (!picker.open || placeQueued) return;
    placeQueued = true;
    requestAnimationFrame(() => { placeQueued = false; placePicker(); });
  };
  window.addEventListener('scroll', queuePlace, { capture: true, passive: true, signal });
  window.addEventListener('resize', queuePlace, { passive: true, signal });
  window.addEventListener('yt-navigate-start', closePicker, { signal });

  function retire() {
    retired = true;
    life.abort();
    scanner.disconnect();
    closePicker();
  }
  document.addEventListener(TAKEOVER, retire, { signal });
})();
