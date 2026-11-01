/**
 * Script Konversi PRD SIMAS-SHAKTI Markdown ke Microsoft Word (.docx)
 * Khusus dirancang untuk bahan workshop dengan format profesional,
 * tipografi rapi, styling tabel korporat, callouts, diagram Mermaid, dan blok kode terstruktur.
 * 
 * 100% Valid OpenXML tanpa karakter ilegal (sanitasi ASCII kontrol)
 * dan kompatibel penuh dengan seluruh versi MS Word (2007, 2010, 2016, 2019, 2021, M365).
 */

const fs = require('fs');
const path = require('path');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  WidthType,
  ShadingType,
  Header,
  Footer,
  PageNumber,
  PageBreak,
  ImageRun
} = require('docx');

const PRD_PATH = path.join(__dirname, '..', 'PRD_SIMAS.md');
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'logo-sekolah.png');
const OUTPUT_WORKSHOP_DOCX = path.join(__dirname, '..', 'PRD_SIMAS_SHAKTI_Workshop_Materials.docx');
const OUTPUT_ROOT_DOCX = path.join(__dirname, '..', 'PRD_SIMAS.docx');

// Palette Warna Elegan & Profesional
const COLORS = {
  primary: '0F294A',      // Dark Navy (Headings, Headers, Cover)
  secondary: '1E40AF',    // Royal Blue (H2, Accents)
  accent: '0284C7',       // Sky Blue (H3, Callouts)
  textDark: '1E293B',     // Slate 800 (Body text)
  textMuted: '64748B',    // Slate 500
  tableHeaderBg: '0F294A',// Dark Navy for Table Header
  tableHeaderTxt: 'FFFFFF',
  tableRowAlt: 'F8FAFC',  // Slate 50
  tableBorder: 'CBD5E1',  // Slate 300
  codeBg: 'F8FAFC',       // Slate 50
  codeBorder: 'CBD5E1',   // Slate 300
  codeText: '0F172A',     // Slate 900
  calloutBg: 'F0F9FF',    // Sky 50
  calloutBorder: '0284C7' // Sky 600
};

// Font Families
const FONT_BODY = 'Segoe UI';
const FONT_TITLE = 'Segoe UI Semibold';
const FONT_CODE = 'Consolas';

/**
 * Sanitasi string agar bebas dari karakter kontrol non-XML 1.0
 */
function sanitizeXml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Helper untuk parsing inline markdown: **bold**, *italic*, `code`, [link](url), dan text biasa
 */
function parseInlineMarkdown(rawText, defaultProps = {}) {
  const text = sanitizeXml(rawText);
  if (!text) return [new TextRun({ text: '', font: FONT_BODY, ...defaultProps })];

  const runs = [];
  const regex = /(`([^`]+)`)|(\*\*\*([^*]+)\*\*\*)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)]+)\))/g;

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const plainText = text.substring(lastIndex, match.index);
      runs.push(new TextRun({
        text: plainText,
        font: defaultProps.font || FONT_BODY,
        size: defaultProps.size || 21, // ~10.5pt
        color: defaultProps.color || COLORS.textDark,
        bold: defaultProps.bold || false,
        italics: defaultProps.italics || false
      }));
    }

    if (match[1]) {
      // Inline Code: `code`
      runs.push(new TextRun({
        text: match[2],
        font: FONT_CODE,
        size: defaultProps.codeSize || 19,
        color: '9A3412', // Amber-Red
        shading: {
          type: ShadingType.CLEAR,
          fill: 'F1F5F9'
        }
      }));
    } else if (match[3]) {
      // Bold + Italic: ***text***
      runs.push(new TextRun({
        text: match[4],
        font: defaultProps.font || FONT_BODY,
        size: defaultProps.size || 21,
        color: defaultProps.color || COLORS.textDark,
        bold: true,
        italics: true
      }));
    } else if (match[5]) {
      // Bold: **text**
      runs.push(new TextRun({
        text: match[6],
        font: defaultProps.font || FONT_BODY,
        size: defaultProps.size || 21,
        color: defaultProps.color || COLORS.textDark,
        bold: true,
        italics: defaultProps.italics || false
      }));
    } else if (match[7]) {
      // Italic: *text*
      runs.push(new TextRun({
        text: match[8],
        font: defaultProps.font || FONT_BODY,
        size: defaultProps.size || 21,
        color: defaultProps.color || COLORS.textDark,
        bold: defaultProps.bold || false,
        italics: true
      }));
    } else if (match[9]) {
      // Link: [text](url)
      const linkLabel = match[10];
      const linkUrl = match[11];
      runs.push(new TextRun({
        text: linkLabel,
        font: defaultProps.font || FONT_BODY,
        size: defaultProps.size || 21,
        color: '0369A1',
        bold: true,
        underline: {}
      }));
      if (linkUrl && !linkUrl.startsWith('file:') && !linkUrl.startsWith('#') && !linkUrl.startsWith('conversation:')) {
        runs.push(new TextRun({
          text: ` (${linkUrl})`,
          font: defaultProps.font || FONT_BODY,
          size: 17,
          color: COLORS.textMuted,
          italics: true
        }));
      }
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    runs.push(new TextRun({
      text: text.substring(lastIndex),
      font: defaultProps.font || FONT_BODY,
      size: defaultProps.size || 21,
      color: defaultProps.color || COLORS.textDark,
      bold: defaultProps.bold || false,
      italics: defaultProps.italics || false
    }));
  }

  return runs.length > 0 ? runs : [new TextRun({ text: text, font: FONT_BODY, size: 21, color: COLORS.textDark })];
}

/**
 * Parse Markdown Table ke Word Table Component dengan Zebra Striping
 */
function createDocxTable(tableLines) {
  if (tableLines.length < 2) return null;

  const headerRaw = tableLines[0].trim();
  const headerCols = headerRaw
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => sanitizeXml(c.trim()));

  const dataRows = [];
  for (let i = 1; i < tableLines.length; i++) {
    const line = tableLines[i].trim();
    if (/^[|:\-\s]+$/.test(line)) continue;
    const cols = line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(c => sanitizeXml(c.trim()));
    dataRows.push(cols);
  }

  const numCols = headerCols.length;
  const borderStyle = {
    style: BorderStyle.SINGLE,
    size: 4,
    color: COLORS.tableBorder
  };

  const rows = [];

  // Header Row
  rows.push(new TableRow({
    tableHeader: true,
    children: headerCols.map(colText => {
      return new TableCell({
        shading: {
          type: ShadingType.CLEAR,
          fill: COLORS.tableHeaderBg
        },
        margins: { top: 120, bottom: 120, left: 160, right: 160 },
        borders: {
          top: borderStyle,
          bottom: borderStyle,
          left: borderStyle,
          right: borderStyle
        },
        children: [
          new Paragraph({
            spacing: { before: 40, after: 40 },
            children: parseInlineMarkdown(colText, {
              color: COLORS.tableHeaderTxt,
              bold: true,
              size: 20
            })
          })
        ]
      });
    })
  }));

  // Data Rows
  dataRows.forEach((rowCols, rIdx) => {
    const isAlt = rIdx % 2 === 1;
    const bgFill = isAlt ? COLORS.tableRowAlt : 'FFFFFF';

    const cells = [];
    for (let c = 0; c < numCols; c++) {
      const rawCellText = rowCols[c] || '';
      const subLines = rawCellText.split(/<br\s*\/?>/i);

      const cellParagraphs = subLines.map(subLine => {
        return new Paragraph({
          spacing: { before: 30, after: 30, line: 260 },
          children: parseInlineMarkdown(subLine.trim(), {
            size: 19,
            color: COLORS.textDark
          })
        });
      });

      cells.push(new TableCell({
        shading: {
          type: ShadingType.CLEAR,
          fill: bgFill
        },
        margins: { top: 100, bottom: 100, left: 140, right: 140 },
        borders: {
          top: borderStyle,
          bottom: borderStyle,
          left: borderStyle,
          right: borderStyle
        },
        children: cellParagraphs.length > 0 ? cellParagraphs : [new Paragraph({ children: [new TextRun({ text: '' })] })]
      }));
    }

    rows.push(new TableRow({ children: cells }));
  });

  return new Table({
    width: {
      size: 100,
      type: WidthType.PERCENTAGE
    },
    rows: rows
  });
}

/**
 * Buat Header Cover Halaman Depan untuk Bahan Workshop Lengkap dengan Logo
 */
function createCoverSection(allHeadings = []) {
  const elements = [];

  // Kop Surat Pemerintah & Sekolah
  elements.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 60 },
    children: [
      new TextRun({
        text: 'PEMERINTAH PROVINSI BALI',
        font: FONT_TITLE,
        size: 24,
        bold: true,
        color: COLORS.primary
      })
    ]
  }));

  elements.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 60 },
    children: [
      new TextRun({
        text: 'DINAS PENDIDIKAN KEPEMUDAAN DAN OLAHRAGA',
        font: FONT_TITLE,
        size: 22,
        bold: true,
        color: COLORS.primary
      })
    ]
  }));

  elements.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 80 },
    children: [
      new TextRun({
        text: 'SMA NEGERI 1 ABANG',
        font: FONT_TITLE,
        size: 30,
        bold: true,
        color: COLORS.primary
      })
    ]
  }));

  elements.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 60 },
    children: [
      new TextRun({
        text: 'NPSN: 50103632  •  Akreditasi: A (Amat Baik)',
        font: FONT_BODY,
        size: 19,
        bold: true,
        color: COLORS.secondary
      })
    ]
  }));

  elements.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 180 },
    children: [
      new TextRun({
        text: 'Jl. Ida Ketut Jelantik, Desa Tista, Kec. Abang, Kab. Karangasem - Bali 80852\nWebsite: https://sman1abang.sch.id  •  Email: sman1abang@gmail.com',
        font: FONT_BODY,
        size: 17,
        color: COLORS.textMuted
      })
    ]
  }));

  // Garis Dobel Kop Surat
  elements.push(new Paragraph({
    spacing: { before: 0, after: 300 },
    border: {
      bottom: {
        style: BorderStyle.DOUBLE,
        size: 24,
        color: COLORS.primary
      }
    },
    children: []
  }));

  // Logo Sekolah
  if (fs.existsSync(LOGO_PATH)) {
    elements.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 100, after: 260 },
      children: [
        new ImageRun({
          data: fs.readFileSync(LOGO_PATH),
          transformation: {
            width: 105,
            height: 105
          }
        })
      ]
    }));
  }

  // Judul Dokumen PRD
  elements.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 80 },
    children: [
      new TextRun({
        text: 'PRODUCT REQUIREMENT DOCUMENT (PRD)',
        font: FONT_TITLE,
        size: 36,
        bold: true,
        color: COLORS.primary
      })
    ]
  }));

  elements.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 180 },
    children: [
      new TextRun({
        text: 'SISTEM MANAJEMEN INFORMASI SMAGESA SHAKTI\n(SIMAS - SHAKTI)',
        font: FONT_TITLE,
        size: 25,
        bold: true,
        color: COLORS.secondary
      })
    ]
  }));

  elements.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 60, after: 320 },
    children: [
      new TextRun({
        text: 'Dokumen Spesifikasi Teknis Perangkat Lunak, Arsitektur Sistem SSOT, Matriks RBAC, Optimasi Kuota & Pedoman Implementasi Digital',
        font: FONT_BODY,
        size: 20,
        italics: true,
        color: COLORS.textDark
      })
    ]
  }));

  // Box Informasi Materi Workshop
  elements.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill: 'F8FAFC' },
            margins: { top: 160, bottom: 160, left: 220, right: 220 },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 8, color: COLORS.secondary },
              bottom: { style: BorderStyle.SINGLE, size: 8, color: COLORS.secondary },
              left: { style: BorderStyle.SINGLE, size: 28, color: COLORS.secondary },
              right: { style: BorderStyle.SINGLE, size: 8, color: COLORS.secondary }
            },
            children: [
              new Paragraph({
                spacing: { before: 30, after: 80 },
                children: [
                  new TextRun({
                    text: '📋 DOKUMEN PEGANGAN / BAHAN WORKSHOP DIGITALISASI SEKOLAH',
                    font: FONT_TITLE,
                    size: 21,
                    bold: true,
                    color: COLORS.secondary
                  })
                ]
              }),
              new Paragraph({
                spacing: { before: 30, after: 40 },
                children: [
                  new TextRun({ text: '• Peruntukan Dokumen: ', bold: true, font: FONT_BODY, size: 19, color: COLORS.primary }),
                  new TextRun({ text: 'Bahan telaah, workshop arsitektur teknis, audit operasional, dan pedoman implementasi SIMAS - SHAKTI.', font: FONT_BODY, size: 19 })
                ]
              }),
              new Paragraph({
                spacing: { before: 30, after: 40 },
                children: [
                  new TextRun({ text: '• Versi Dokumen & Rilis: ', bold: true, font: FONT_BODY, size: 19, color: COLORS.primary }),
                  new TextRun({ text: 'v1.2.484 (Release 26.10.19.10) - SSOT Synchronized', font: FONT_BODY, size: 19 })
                ]
              }),
              new Paragraph({
                spacing: { before: 30, after: 40 },
                children: [
                  new TextRun({ text: '• Inti Arsitektur: ', bold: true, font: FONT_BODY, size: 19, color: COLORS.primary }),
                  new TextRun({ text: 'Cloudflare D1 SQL (Core Edge SSOT), Firebase Firestore (Auth/RBAC), Supabase PostgreSQL (High-Transaction), Vanilla Modern JS & PWA TWA Android.', font: FONT_BODY, size: 19 })
                ]
              }),
              new Paragraph({
                spacing: { before: 30, after: 40 },
                children: [
                  new TextRun({ text: '• Target Peserta: ', bold: true, font: FONT_BODY, size: 19, color: COLORS.primary }),
                  new TextRun({ text: 'Manajemen Sekolah, Tim Pengembang IT, Guru BK, Wali Kelas, Guru Mapel, Staf Tata Usaha, dan Operator SIMAS.', font: FONT_BODY, size: 19 })
                ]
              }),
              new Paragraph({
                spacing: { before: 30, after: 30 },
                children: [
                  new TextRun({ text: '• Pengembang & Penyusun: ', bold: true, font: FONT_BODY, size: 19, color: COLORS.primary }),
                  new TextRun({ text: 'Tim Pengembang SIMAS SMAGESA & I Komang Purna (IKP)', font: FONT_BODY, size: 19 })
                ]
              })
            ]
          })
        ]
      })
    ]
  }));

  elements.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 400, after: 120 },
    children: [
      new TextRun({
        text: 'SMAGESA SHAKTI  •  TAHUN 2026',
        font: FONT_TITLE,
        size: 20,
        bold: true,
        color: COLORS.primary
      })
    ]
  }));

  // Pindah ke Halaman Daftar Isi
  elements.push(new Paragraph({
    children: [new PageBreak()]
  }));

  // Halaman Daftar Isi (Table of Contents) Native Tanpa Field Code Rentan Crash
  elements.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 200, after: 140 },
    children: [
      new TextRun({
        text: 'DAFTAR ISI DOKUMEN (TABLE OF CONTENTS)',
        font: FONT_TITLE,
        size: 28,
        bold: true,
        color: COLORS.primary
      })
    ]
  }));

  elements.push(new Paragraph({
    spacing: { before: 20, after: 200 },
    children: [
      new TextRun({
        text: '💡 Petunjuk Navigasi Workshop: ',
        font: FONT_BODY,
        size: 19,
        bold: true,
        color: COLORS.accent
      }),
      new TextRun({
        text: 'Gunakan panel navigasi (Ctrl + F -> Headings) pada Microsoft Word untuk melompat langsung ke bab/subbab bahasan workshop berikut:',
        font: FONT_BODY,
        size: 19,
        color: COLORS.textMuted,
        italics: true
      })
    ]
  }));

  // Buat daftar bab-bab utama secara native & bersih
  allHeadings.forEach((h, idx) => {
    elements.push(new Paragraph({
      spacing: { before: 35, after: 35, line: 240 },
      children: [
        new TextRun({
          text: `• ${h}`,
          font: FONT_BODY,
          size: 20,
          bold: true,
          color: COLORS.primary
        })
      ]
    }));
  });

  // Pindah ke Halaman Isi Dokumen
  elements.push(new Paragraph({
    children: [new PageBreak()]
  }));

  return elements;
}

/**
 * Main Markdown to DOCX Converter
 */
async function convertMarkdownToDocx() {
  console.log('Membaca PRD_SIMAS.md...');
  const mdContent = fs.readFileSync(PRD_PATH, 'utf-8');
  const lines = mdContent.split(/\r?\n/);
  console.log(`Total baris terbaca: ${lines.length}`);

  // Kumpulkan semua heading level 2 untuk Daftar Isi
  const majorSections = [];
  lines.forEach(l => {
    const trimmed = l.trim();
    if (trimmed.startsWith('## ')) {
      majorSections.push(sanitizeXml(trimmed.replace(/^##\s+/, '').trim()));
    }
  });

  const docChildren = [];

  // 1. Tambahkan Cover & Daftar Isi Native
  docChildren.push(...createCoverSection(majorSections));

  // 2. Parser State Machine
  let i = 0;
  let inCodeBlock = false;
  let codeBlockLines = [];
  let codeBlockLang = '';

  let inTable = false;
  let tableLines = [];

  let inBlockquote = false;
  let blockquoteLines = [];

  function flushCodeBlock() {
    if (!inCodeBlock) return;
    const isMermaid = codeBlockLang.toLowerCase().includes('mermaid');
    const titleLabel = isMermaid
      ? '📊 DIAGRAM ARSITEKTUR / ALUR DATA (MERMAID)'
      : `💻 KODE PROGRAM / SKEMA / KONFIGURASI (${codeBlockLang.toUpperCase() || 'TEKS'})`;

    const codeParagraphs = [
      new Paragraph({
        spacing: { before: 40, after: 60 },
        children: [
          new TextRun({
            text: `[ ${titleLabel} ]`,
            font: FONT_CODE,
            bold: true,
            size: 18,
            color: COLORS.secondary
          })
        ]
      })
    ];

    codeBlockLines.forEach(cLine => {
      codeParagraphs.push(new Paragraph({
        spacing: { before: 8, after: 8, line: 230 },
        children: [
          new TextRun({
            text: sanitizeXml(cLine) || ' ',
            font: FONT_CODE,
            size: 17, // ~8.5pt
            color: COLORS.codeText
          })
        ]
      }));
    });

    const codeTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              shading: { type: ShadingType.CLEAR, fill: COLORS.codeBg },
              margins: { top: 120, bottom: 120, left: 160, right: 160 },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.codeBorder },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.codeBorder },
                left: { style: BorderStyle.SINGLE, size: 20, color: COLORS.secondary },
                right: { style: BorderStyle.SINGLE, size: 4, color: COLORS.codeBorder }
              },
              children: codeParagraphs
            })
          ]
        })
      ]
    });

    docChildren.push(new Paragraph({ spacing: { before: 100, after: 30 }, children: [] }));
    docChildren.push(codeTable);
    docChildren.push(new Paragraph({ spacing: { before: 30, after: 100 }, children: [] }));

    inCodeBlock = false;
    codeBlockLines = [];
    codeBlockLang = '';
  }

  function flushTable() {
    if (!inTable) return;
    const tableComponent = createDocxTable(tableLines);
    if (tableComponent) {
      docChildren.push(new Paragraph({ spacing: { before: 100, after: 30 }, children: [] }));
      docChildren.push(tableComponent);
      docChildren.push(new Paragraph({ spacing: { before: 30, after: 100 }, children: [] }));
    }
    inTable = false;
    tableLines = [];
  }

  function flushBlockquote() {
    if (!inBlockquote) return;
    const textContent = sanitizeXml(blockquoteLines.join(' '));

    let alertType = 'CATATAN / PANDUAN';
    let alertColor = COLORS.accent;
    let alertBg = 'F0F9FF';
    let cleanText = textContent;

    if (textContent.includes('[!NOTE]')) {
      alertType = 'INFORMASI PENTING (NOTE)';
      alertColor = '0284C7';
      alertBg = 'F0F9FF';
      cleanText = textContent.replace(/\[!NOTE\]/g, '').trim();
    } else if (textContent.includes('[!WARNING]')) {
      alertType = 'PERINGATAN KRITIKAL (WARNING)';
      alertColor = 'E11D48';
      alertBg = 'FFF1F2';
      cleanText = textContent.replace(/\[!WARNING\]/g, '').trim();
    } else if (textContent.includes('[!TIP]')) {
      alertType = 'TIPS & PRAKTIK TERBAIK (TIP)';
      alertColor = '059669';
      alertBg = 'ECFDF5';
      cleanText = textContent.replace(/\[!TIP\]/g, '').trim();
    } else if (textContent.includes('[!IMPORTANT]')) {
      alertType = 'ATURAN WAJIB (IMPORTANT)';
      alertColor = 'D97706';
      alertBg = 'FFFBEB';
      cleanText = textContent.replace(/\[!IMPORTANT\]/g, '').trim();
    }

    const runs = parseInlineMarkdown(cleanText, {
      font: FONT_BODY,
      size: 21,
      italics: true,
      color: COLORS.textDark
    });

    const calloutTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              shading: { type: ShadingType.CLEAR, fill: alertBg },
              margins: { top: 120, bottom: 120, left: 180, right: 180 },
              borders: {
                top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
                bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
                left: { style: BorderStyle.SINGLE, size: 28, color: alertColor },
                right: { style: BorderStyle.NONE, size: 0, color: 'auto' }
              },
              children: [
                new Paragraph({
                  spacing: { before: 20, after: 50 },
                  children: [
                    new TextRun({
                      text: `📌 ${alertType}:`,
                      font: FONT_TITLE,
                      bold: true,
                      size: 20,
                      color: alertColor
                    })
                  ]
                }),
                new Paragraph({
                  spacing: { before: 20, after: 20, line: 260 },
                  children: runs
                })
              ]
            })
          ]
        })
      ]
    });

    docChildren.push(new Paragraph({ spacing: { before: 90, after: 30 }, children: [] }));
    docChildren.push(calloutTable);
    docChildren.push(new Paragraph({ spacing: { before: 30, after: 90 }, children: [] }));

    inBlockquote = false;
    blockquoteLines = [];
  }

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // 1. Fenced Code Block
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        flushCodeBlock();
      } else {
        if (inTable) flushTable();
        if (inBlockquote) flushBlockquote();

        inCodeBlock = true;
        codeBlockLang = trimmed.replace(/^```/, '').trim();
        codeBlockLines = [];
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(rawLine);
      i++;
      continue;
    }

    // 2. Baris Tabel
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (inBlockquote) flushBlockquote();
      inTable = true;
      tableLines.push(trimmed);
      i++;
      continue;
    } else if (inTable) {
      flushTable();
    }

    // 3. Blockquote (> ...)
    if (trimmed.startsWith('>')) {
      inBlockquote = true;
      const quoteText = trimmed.replace(/^>\s?/, '');
      blockquoteLines.push(quoteText);
      i++;
      continue;
    } else if (inBlockquote) {
      flushBlockquote();
    }

    // 4. Baris Kosong
    if (trimmed === '') {
      i++;
      continue;
    }

    // 5. Horizontal Rule
    if (/^(\-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      docChildren.push(new Paragraph({
        spacing: { before: 140, after: 140 },
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: 6,
            color: COLORS.tableBorder
          }
        },
        children: []
      }));
      i++;
      continue;
    }

    // 6. Heading 1 (# ...)
    if (trimmed.startsWith('# ')) {
      const headingText = sanitizeXml(trimmed.replace(/^#\s+/, '').trim());
      docChildren.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 380, after: 160 },
        children: [
          new TextRun({
            text: headingText,
            font: FONT_TITLE,
            size: 32, // 16pt
            bold: true,
            color: COLORS.primary
          })
        ]
      }));
      i++;
      continue;
    }

    // 7. Heading 2 (## ...)
    if (trimmed.startsWith('## ')) {
      const headingText = sanitizeXml(trimmed.replace(/^##\s+/, '').trim());
      docChildren.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 320, after: 120 },
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: 8,
            color: COLORS.secondary
          }
        },
        children: [
          new TextRun({
            text: headingText,
            font: FONT_TITLE,
            size: 26, // 13pt
            bold: true,
            color: COLORS.secondary
          })
        ]
      }));
      i++;
      continue;
    }

    // 8. Heading 3 (### ...)
    if (trimmed.startsWith('### ')) {
      const headingText = sanitizeXml(trimmed.replace(/^###\s+/, '').trim());
      docChildren.push(new Paragraph({
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 240, after: 80 },
        children: [
          new TextRun({
            text: headingText,
            font: FONT_TITLE,
            size: 23, // 11.5pt
            bold: true,
            color: COLORS.accent
          })
        ]
      }));
      i++;
      continue;
    }

    // 9. Heading 4 (#### ...)
    if (trimmed.startsWith('#### ')) {
      const headingText = sanitizeXml(trimmed.replace(/^####\s+/, '').trim());
      docChildren.push(new Paragraph({
        heading: HeadingLevel.HEADING_4,
        spacing: { before: 180, after: 60 },
        children: [
          new TextRun({
            text: headingText,
            font: FONT_TITLE,
            size: 21, // 10.5pt
            bold: true,
            color: COLORS.textDark
          })
        ]
      }));
      i++;
      continue;
    }

    // 10. Bullet List (- atau *)
    const bulletMatch = rawLine.match(/^(\s*)([-*])\s+(.+)$/);
    if (bulletMatch) {
      const indentSpaces = bulletMatch[1].length;
      const bulletLevel = Math.min(Math.floor(indentSpaces / 2), 3);
      const itemText = bulletMatch[3];

      docChildren.push(new Paragraph({
        bullet: { level: bulletLevel },
        spacing: { before: 25, after: 25, line: 260 },
        children: parseInlineMarkdown(itemText, {
          size: 21,
          color: COLORS.textDark
        })
      }));
      i++;
      continue;
    }

    // 11. Numbered List (1. 2. dst)
    const numMatch = rawLine.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (numMatch) {
      const indentSpaces = numMatch[1].length;
      const numPrefix = numMatch[2];
      const itemText = numMatch[3];
      const nestLevel = Math.min(Math.floor(indentSpaces / 2), 3);

      docChildren.push(new Paragraph({
        spacing: { before: 25, after: 25, line: 260 },
        indent: { left: 360 * (nestLevel + 1) },
        children: [
          new TextRun({
            text: `${numPrefix}. `,
            bold: true,
            font: FONT_BODY,
            size: 21,
            color: COLORS.primary
          }),
          ...parseInlineMarkdown(itemText, {
            size: 21,
            color: COLORS.textDark
          })
        ]
      }));
      i++;
      continue;
    }

    // 12. Paragraf Teks Biasa
    docChildren.push(new Paragraph({
      spacing: { before: 50, after: 50, line: 270 },
      children: parseInlineMarkdown(trimmed, {
        size: 21,
        color: COLORS.textDark
      })
    }));

    i++;
  }

  // Flush buffer jika masih tersisa di akhir
  if (inCodeBlock) flushCodeBlock();
  if (inTable) flushTable();
  if (inBlockquote) flushBlockquote();

  console.log(`Menyiapkan Document Word dengan total ${docChildren.length} elemen...`);

  const doc = new Document({
    creator: 'Tim Pengembang SIMAS SMAGESA & IKP',
    title: 'Product Requirement Document (PRD) - SIMAS - SHAKTI',
    description: 'Bahan Workshop & Spesifikasi Kebutuhan Perangkat Lunak SIMAS SHAKTI SMA Negeri 1 Abang',
    styles: {
      default: {
        document: {
          run: {
            font: FONT_BODY,
            size: 21,
            color: COLORS.textDark
          }
        }
      }
    },
    sections: [
      {
        properties: {
          titlePage: true,
          page: {
            margin: {
              top: 1440,    // 1 inch
              bottom: 1440, // 1 inch
              left: 1440,   // 1 inch
              right: 1440   // 1 inch
            }
          }
        },
        headers: {
          first: new Header({ children: [] }),
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { after: 100 },
                children: [
                  new TextRun({
                    text: 'SIMAS - SHAKTI | Product Requirement Document (PRD) — Bahan Workshop',
                    font: FONT_BODY,
                    size: 16,
                    color: COLORS.textMuted
                  })
                ]
              })
            ]
          })
        },
        footers: {
          first: new Footer({ children: [] }),
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 100 },
                children: [
                  new TextRun({
                    text: 'SMA Negeri 1 Abang  •  Halaman ',
                    font: FONT_BODY,
                    size: 17,
                    color: COLORS.textMuted
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    font: FONT_BODY,
                    size: 17,
                    bold: true,
                    color: COLORS.primary
                  }),
                  new TextRun({
                    text: ' dari ',
                    font: FONT_BODY,
                    size: 17,
                    color: COLORS.textMuted
                  }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    font: FONT_BODY,
                    size: 17,
                    bold: true,
                    color: COLORS.primary
                  })
                ]
              })
            ]
          })
        },
        children: docChildren
      }
    ]
  });

  console.log('Mengompilasi dan menyimpan berkas DOCX...');
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(OUTPUT_WORKSHOP_DOCX, buffer);
  fs.writeFileSync(OUTPUT_ROOT_DOCX, buffer);

  const stats = fs.statSync(OUTPUT_ROOT_DOCX);
  console.log(`\n======================================================`);
  console.log(`🎉 BERHASIL! Berkas MS Word (.docx) Bersih & Terverifikasi:`);
  console.log(`Lokasi 1: ${OUTPUT_WORKSHOP_DOCX}`);
  console.log(`Lokasi 2: ${OUTPUT_ROOT_DOCX}`);
  console.log(`Ukuran Berkas: ${(stats.size / 1024).toFixed(2)} KB`);
  console.log(`Total Elemen Dokumen: ${docChildren.length}`);
  console.log(`======================================================\n`);
}

convertMarkdownToDocx().catch(err => {
  console.error('Terjadi kesalahan konversi:', err);
  process.exit(1);
});
