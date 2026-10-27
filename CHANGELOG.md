# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-28

First public release. Changes since 0.2.0:

### Security

- The internal event bus now uses a private `EventTarget` instead of the page's `window`, so scripts on the site can no longer observe or forge the extension's events.
- The CORS header rules now apply only to requests made from the Kemono / Pawchive sites (`initiatorDomains`), instead of to every site that requests their files.
- The download folder used by "skip files that already exist" is now picked in the extension's own window and owned by the extension. Previously its handle and read access belonged to the website, so the site's scripts could have listed that folder. The old handle is deleted from the site's storage automatically; pick the folder again once.

### Added

- Crawling can be paused and resumed; while paused, a Stop button appears. The crawl controls are on both the Home and Crawl pages.
- The floating ⚙ button can be turned off in the settings (the panel still opens with Alt+X or the toolbar icon).
- The settings show whether the chosen download folder is authorized.
- The Home and Crawl pages show live crawl progress: status, elapsed time, posts checked, posts and files added, and how many posts were excluded by each filter or failed. An empty result now explains why in a toast.

### Fixed

- `n1.kemono.cr` had two conflicting Referer rules; all `n1`–`n4.kemono.cr` file servers now send `https://kemono.cr/`.
- When every file was already downloaded, the progress showed 0/N and a "download started" toast covered the pre-check summary. It now ends at N/N without starting threads.
- Toasts shown at the same time no longer overlap.

### Removed

- Switching preview images with the arrow keys (it also triggered the site's own paging). Use the mouse wheel.
- The separate dedup strategy (loose / strict) setting; the loose behaviour is always used.

### Changed

- The extension name and description are localized (English, 简体中文, 繁體中文, 日本語).
- Requires Chrome / Edge 101 or later.
- The settings panel is split into one module per page.
- "Skip by download record" and "skip files already in the folder" are merged into one "Skip already downloaded" option: none / download record / folder / both. Existing settings are migrated.
- The Pause download button only appears once a download has started.
- In the preview, the mouse wheel switches images only while the mouse is still; scrolling while moving the mouse scrolls the page. While the preview is shown and the mouse is still, the page never scrolls, including while images are still loading and when the cursor is over something covering the card.
- Crawling no longer skips posts that are already in the download history; skipping happens only when downloading. Re-crawling a fully downloaded creator used to give an empty result.
- Kemono support is marked best-effort: its original-file servers were unreachable when tested.
- Added an English README, a privacy policy, and CI that type-checks, lints, tests and builds every push; tagged releases attach a ready-to-load zip.

## [0.2.0]

Not publicly released. First feature-complete version: hover preview, batch crawl with filters, crawl cache, download control (pause / resume / restart, stall detection, retry with backoff, large-file direct download), duplicate and local-file checks, naming rules, download history, CSV export, configurable hotkeys, in-panel log, and four UI languages.
