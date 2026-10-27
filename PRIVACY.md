# Privacy Policy

PawchivePro does not collect, transmit, or sell any personal data.

## What the extension stores

Everything is stored locally in the extension's own storage (`chrome.storage.local` and the extension's IndexedDB) and never leaves your device:

- Your settings (preview options, naming rules, hotkeys, interface language).
- Download history (post IDs and file names you have downloaded), used to skip duplicates.
- Crawl cache (post lists from recent crawls, up to 20 entries).
- Optional: if you choose a download folder for the "skip files that already exist" check, a handle to that folder. You pick it in the extension's own window, and read access is granted to the extension, not to any website. The extension only lists file names and sizes in that folder to decide what to skip; it never reads file contents. Websites cannot see the handle or the folder.

You can export, import or clear the download history and crawl cache from the settings panel. Removing the extension deletes all of it.

Versions up to 0.2.0 stored the folder handle in the website's own storage. The current version deletes that old copy automatically the next time you open a Kemono / Pawchive page, and asks you to pick the folder again.

## Network requests

The extension only talks to the Kemono / Pawchive sites you are already visiting (their public API and file servers). It does not contact any other server. It has no analytics, telemetry, ads, or remote code.

## Permissions

| Permission | Why |
|---|---|
| `downloads` | Save files to your download folder. |
| `storage`, `unlimitedStorage` | Keep settings, download history and the crawl cache locally; history for large creators can exceed the default quota. |
| `declarativeNetRequestWithHostAccess` | Add CORS and Referer headers to requests to the Kemono / Pawchive file servers so images can be previewed and downloaded. These rules apply only to requests made from those sites. |
| Host access to `kemono.*` and `pawchive.pw` | Run the preview and download UI on those sites and call their API. |

## Contact

Questions or issues: open an issue on the project's repository.
