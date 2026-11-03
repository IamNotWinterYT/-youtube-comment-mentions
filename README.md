# YouTube Comment Mentions

Mention any YouTube channel in comments and replies from desktop.

YouTube's web interface lets you mention channels inside video descriptions and community posts with an `@` picker, but does not offer that picker inside regular comment boxes—and typing a display name or `@handle` in a top-level comment often fails to link. However, YouTube still turns `@UC…` channel IDs into clickable mention links when a comment is posted.

YouTube Comment Mentions adds an `@` button to every comment and reply box (and opens automatically whenever you type `@`), searches channels across YouTube, and inserts the chosen channel's `@UC…` ID so YouTube turns it into a proper mention.

## Usage

1. Open any YouTube video and click into a comment or reply box.
2. Type `@` followed by a name, or click the **`@`** button next to the emoji button in the comment box footer.
3. Choose someone who commented on the video, or type in the search field to find any channel on YouTube.
4. Click a channel (or use `↑` / `↓` and press `Enter` or `Tab`) to insert its `@UC…` channel ID into the comment box.
5. Finish writing your comment and click **Comment** or **Reply** as usual. YouTube converts the `@UC…` tag into the channel's clickable `@handle` link once posted.

## Installation

### Chrome, Edge, Brave, and other Chromium browsers

1. Download the latest ZIP file from the [Releases](../../releases) page and extract it to a folder on your computer.
2. Open `chrome://extensions` in a new tab.
3. Turn on **Developer mode** in the top-right corner.
4. Click **Load unpacked** in the top-left corner and select the extracted folder.

Already-open YouTube tabs get the extension right away without needing a page refresh. Keep the extracted folder on your computer, as the browser loads the extension from it.

### Firefox

1. Download the latest ZIP file from the [Releases](../../releases) page.
2. Open `about:debugging#/runtime/this-firefox` in a new tab.
3. Click **Load Temporary Add-on…** and select `manifest.json` inside the extracted folder (or the ZIP file itself).

## How it works

* **`src/content.js` & `src/content.css` (isolated world):** Watches for `ytd-commentbox` elements on the page and adds an `@` icon button beside YouTube's emoji button. The picker is rendered inside its own Shadow DOM using the Popover API (`popover="manual"`), so it draws above reply dialogs without being clipped and adapts to YouTube's light and dark themes. When a channel is chosen, the script checks whether `@` is already present before the cursor, inserts the `@UC…` ID through the comment box's `contenteditable` editor, and leaves the rest of your text untouched.
* **`src/sw.js` (service worker / background script):** Queries YouTube's internal `/youtubei/v1/search` endpoint (filtered to channels) and `/youtubei/v1/navigation/resolve_url` endpoint to resolve `@handles` into 24-character `UC…` channel IDs. Results are cached in memory for 10 minutes. No API keys or external servers are used.

## Permissions

* **`https://*.youtube.com/*`:** Needed to place the `@` button and picker inside YouTube's comment boxes and to query YouTube's channel search and URL resolution endpoints.
* **`scripting`:** Used on install or update to inject the content script and stylesheet into YouTube tabs that are already open, so they work without refreshing the page.
* **`storage`:** Reserved for local extension state.

The extension does not collect, store, or send any data outside your browser.

## Building from source

No build step or bundler is required. The repository files load directly as an unpacked Manifest V3 extension:

```text
youtube-comment-mentions/
├── manifest.json
├── README.md
├── LICENSE
├── icons/
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   └── icon-128.png
└── src/
    ├── content.css
    ├── content.js
    └── sw.js
```

## License

[MIT](LICENSE)
