`html-to-image.js` is the browser UMD distribution of **html-to-image 1.11.13**, loaded locally on demand by `student-card-export.js`.

- Upstream: https://github.com/bubkoo/html-to-image
- Distribution: https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/dist/html-to-image.js
- License: MIT, included in `html-to-image.LICENSE`.

Local patch: removed the upstream clone-style branch that rounds every pixel font size down and subtracts 0.1px. Card export must retain the exact computed font sizes of the preview; that workaround changes text wrapping and appearance. Preserve this patch when upgrading.

Card design stays in `student-card-renderer.js` and `css/card-print.css`. The library embeds DOM styles, images, and fonts and rasterizes the browser's SVG representation. Download and physical printing both use this adapter; do not introduce a separate canvas layout for either output.

`jspdf.umd.min.js` is the unmodified browser UMD distribution of **jsPDF 4.2.1**, loaded locally on demand by `jurnal-admin-export.mjs`.

- Upstream: https://github.com/parallax/jsPDF
- Distribution: https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js
- License: MIT, included in the distribution header.

Journal reports draw native PDF text and process at most three compressed evidence images at a time. Do not replace this with a full-school HTML/canvas screenshot.

`jszip.min.js` is the unmodified browser distribution of **JSZip 3.10.2**, copied from the installed `jszip` package. It is loaded on demand by `lms-quiz-documents.mjs` to read the document, numbering, and styles XML inside `.docx` files. Document HTML, macros, and embedded media are not executed. License: MIT, included in `jszip.LICENSE`.

Ordinary PDF text imports load **PDF.js 6.4.299** and its matching worker on demand from the pinned jsDelivr distribution (`pdfjs-dist@6.4.299/legacy/build`). Upstream: https://github.com/mozilla/pdf.js, license Apache-2.0. `lms-pdf-compat.mjs` supplies `Promise.withResolvers` when absent; `lms-quiz-pdf-worker.mjs` applies the same compatibility step inside the worker. Ordinary import reads text without rendering or uploading the source file; scan/image-only pages require prior OCR. The separate, explicitly selected AI import sends a PDF directly to Gemini with the signed-in teacher's saved API key, including for scans. Do not switch the library/worker independently or replace the pinned version with an unversioned CDN URL.
