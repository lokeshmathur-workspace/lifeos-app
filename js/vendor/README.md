# Vendored libraries

Loaded only when someone taps **📤 Share** in the Navya tab (see `js/navya/share.js`), so the
rest of the app never downloads them. Kept here rather than loaded from a CDN so sharing works
without any third-party host.

| File | Library | Version | License |
| --- | --- | --- | --- |
| `html2canvas.min.js` | [html2canvas](https://html2canvas.hertzen.com) | 1.4.1 | MIT |
| `jspdf.umd.min.js` | [jsPDF](https://github.com/parallax/jsPDF) | 2.5.2 | MIT |

Both files are the packages' own `dist/` builds, unmodified (license headers intact).
