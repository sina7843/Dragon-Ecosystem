/**
 * Builds the Persian manual in every delivered format from one Markdown source.
 *
 * Pipeline: Markdown source -> expand generated tables -> parse -> emit resolved Markdown,
 * HTML, and DOCX -> convert DOCX to PDF with the locally installed Word.
 *
 * The conversion is deliberately local. An external document service would mean uploading a
 * document that describes a private platform's authorization model to a third party, which is
 * not a trade worth making for a file format.
 *
 * Usage: node scripts/guide/build-guide.mjs [--skip-pdf]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDocx } from './lib/docx.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCS = join(ROOT, 'docs', 'user-guides');
const SHOTS = join(DOCS, 'assets', 'screenshots');

const inventory = JSON.parse(readFileSync(join(DOCS, 'SITE_INVENTORY.json'), 'utf8'));
let capture = { steps: [] };
try {
  capture = JSON.parse(readFileSync(join(DOCS, 'GUIDE_VERIFICATION_MAP.json'), 'utf8'));
} catch {
  /* capture is optional for a text-only build */
}

const git = (args, fallback) => {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
};

const ROLE_FA = {
  super_administrator: 'مدیر ارشد سامانه',
  platform_administrator: 'مدیر پلتفرم',
  finance_operator: 'اپراتور مالی',
  financial_approver: 'تأییدکننده مالی',
  content_author: 'نویسنده محتوا',
  content_editor: 'ویراستار محتوا',
  content_publisher: 'منتشرکننده محتوا',
  streaming_operator: 'اپراتور پخش زنده',
  tournament_administrator: 'مدیر تورنمنت',
  tournament_organizer: 'برگزارکننده تورنمنت',
  education_manager: 'مدیر آموزش',
  live_chat_moderator: 'ناظر گفت‌وگوی زنده',
  community_moderator: 'ناظر جامعه',
  shop_operator: 'اپراتور فروشگاه',
  support_operator: 'اپراتور پشتیبانی',
  security_auditor: 'ممیز امنیتی'
};

/**
 * A cell value may itself contain a pipe — route patterns such as `/:locale(fa|en)/help` do —
 * and an unescaped one splits the row, producing a table whose rows are wider than its header.
 * Word rejects such a table outright ("the file appears to be corrupted"), so escaping happens
 * at the single point where every cell is rendered.
 */
const cell = (v) => String(v).replace(/\|/g, '\\|');

const md = {
  table(header, rows) {
    return [
      `| ${header.map(cell).join(' | ')} |`,
      `|${header.map(() => '---').join('|')}|`,
      ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)
    ].join('\n');
  }
};

/** Generated tables, keyed by the marker that requests them. */
const INCLUDES = {
  totals: () =>
    md.table(
      ['مورد', 'تعداد'],
      [
        ['نقطه پایانی API', inventory.apiRoutes.length],
        ['مسیر عمومی (بدون ورود)', inventory.totals.publicApiRoutes],
        ['مسیر نیازمند ورود', inventory.totals.sessionApiRoutes],
        ['مسیر نیازمند مجوز', inventory.totals.permissionApiRoutes],
        ['مسیر رابط کاربری', inventory.webRoutes.length],
        ['ناحیه مدیریتی', inventory.adminAreas.length],
        ['نقش', Object.keys(inventory.roles).length],
        ['مجوز', Object.keys(inventory.permissions).length],
        ['Feature Gate', inventory.featureGates.length],
        ['متغیر محیطی', inventory.environment.variables.length],
        ['تصویر ثبت‌شده', capture.steps.length]
      ]
    ),

  'public-routes': () =>
    md.table(
      ['مسیر', 'نما'],
      inventory.webRoutes.filter((w) => w.shell === 'public' && !w.path.includes('/admin')).map((w) => [`\`${w.path}\``, `\`${w.view}\``])
    ),

  'account-routes': () =>
    md.table(
      ['مسیر', 'نما'],
      inventory.webRoutes.filter((w) => w.shell === 'account').map((w) => [`\`${w.path}\``, `\`${w.view}\``])
    ),

  'admin-routes': () =>
    md.table(
      ['مسیر', 'نما'],
      inventory.webRoutes.filter((w) => w.shell === 'admin').map((w) => [`\`${w.path}\``, `\`${w.view}\``])
    ),

  'role-matrix': () =>
    md.table(
      ['نقش', 'کد', 'مجوزها'],
      Object.entries(inventory.roles).map(([code, perms]) => [
        ROLE_FA[code] ?? code,
        `\`${code}\``,
        perms.includes('*') ? '**همه مجوزها** (نقش کنترل‌شده اضطراری)' : perms.map((p) => `\`${p}\``).join('، ')
      ])
    ),

  'role-quickref': () =>
    md.table(
      ['هدف عملیاتی', 'نقش', 'مجوز'],
      [
        ['ساخت و انتشار دوره', '`education_manager`', '`education.manage`'],
        ['عملیات پخش زنده', '`streaming_operator`', '`stream.manage`'],
        ['تعدیل گفت‌وگوی زنده', '`live_chat_moderator`', '`chat.moderate`'],
        ['مدیریت تورنمنت', '`tournament_administrator`', '`tournament.manage`'],
        ['فروشگاه و سفارش', '`shop_operator`', '`store.manage`'],
        ['پشتیبانی و عملیات', '`support_operator`', '`support.manage`'],
        ['مالی (آغازکننده)', '`finance_operator`', '`finance.manage`'],
        ['مالی (تأییدکننده)', '`financial_approver`', '`finance.approve`']
      ]
    ),

  'admin-areas': () =>
    md.table(
      ['ناحیه', 'مسیر', 'مجوز لازم'],
      inventory.adminAreas.map((a) => [`\`${a.testid}\``, `\`${a.path}\``, `\`${a.permission ?? '—'}\``])
    ),

  'feature-gates': () =>
    md.table(
      ['تصمیم باز', 'متغیر محیطی', 'وضعیت پیش‌فرض'],
      inventory.featureGates.map((g) => [g.decision, `\`${g.env}\``, 'بسته (fail-closed)'])
    ),

  'permission-holders': () =>
    md.table(
      ['مجوز', 'نقش‌های دارنده'],
      Object.entries(inventory.permissionHolders).map(([perm, holders]) => [`\`${perm}\``, holders.map((h) => `\`${h}\``).join('، ')])
    ),

  'web-routes': () =>
    md.table(
      ['مسیر', 'نما', 'پوسته'],
      inventory.webRoutes.map((w) => [`\`${w.path}\``, `\`${w.view}\``, w.shell ?? '—'])
    ),

  environment: () =>
    md.table(
      ['متغیر', 'نوع', 'Feature Gate'],
      inventory.environment.variables.map((v) => {
        const gate = inventory.featureGates.find((g) => g.env === v);
        return [`\`${v}\``, /SECRET|TOKEN|KEY|PASSWORD|URI/.test(v) ? 'محرمانه' : 'غیرمحرمانه', gate ? gate.decision : '—'];
      })
    )
};

function expand(source) {
  const missing = [];
  // Multi-line comments are authoring notes and are dropped first. They have to go before
  // marker expansion, because the note at the top of each source explains the marker syntax
  // by writing an example of it — which the expander would otherwise try to resolve.
  const withoutNotes = source.replace(/<!--[\s\S]*?-->/g, (block) => (block.includes('\n') ? '' : block));
  const out = withoutNotes.replace(/<!--INCLUDE:([a-z-]+)-->/g, (_, name) => {
    const fn = INCLUDES[name];
    if (fn === undefined) {
      missing.push(name);
      return `> جدول «${name}» تولید نشد.`;
    }
    return fn();
  });
  if (missing.length > 0) throw new Error(`unknown include marker(s): ${missing.join(', ')}`);
  return out;
}

// --- Markdown parsing ------------------------------------------------------

/**
 * Parses the subset the manual uses. Not a general Markdown implementation: a narrower
 * parser that fails loudly on something it does not recognise is safer for a document whose
 * correctness matters than a permissive one that silently drops a table.
 */
function parse(source) {
  const blocks = [];
  const lines = source.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (line.startsWith('<!--')) {
      while (i < lines.length && !lines[i].includes('-->')) i += 1;
      continue;
    }
    if (line.trim() === '') continue;

    if (line.startsWith('```')) {
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'code', lines: code });
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h !== null) {
      blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() });
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push({ type: 'rule' });
      continue;
    }

    const img = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(line);
    if (img !== null) {
      blocks.push({ type: 'image', alt: img[1], src: img[2] });
      continue;
    }

    if (line.startsWith('> ')) {
      const quote = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quote.push(lines[i].slice(2).trim());
        i += 1;
      }
      i -= 1;
      const text = quote.join(' ');
      // The callout kind follows the wording the manual already uses for its labels.
      const kind = /حساس|امنیت|هرگز|ممنوع/.test(text)
        ? 'security'
        : /هشدار|بسته|مسدود|در دسترس نیست|رد می‌شود|وجود ندارد/.test(text)
          ? 'warning'
          : 'note';
      blocks.push({ type: 'callout', text, kind });
      continue;
    }

    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        // Split on pipes that are not escaped, so a cell may legitimately contain one —
        // route patterns like `/:locale(fa|en)/help` do. A lookbehind is used rather than
        // swapping in a sentinel character, which worked but left an unreadable control
        // character in the source.
        const cells = lines[i]
          .split(/(?<!\\)\|/)
          .slice(1, -1)
          .map((c) => c.trim().replace(/\\\|/g, '|'));
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i += 1;
      }
      i -= 1;
      if (rows.length > 0) blocks.push({ type: 'table', rows });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, '').trim());
        i += 1;
      }
      i -= 1;
      blocks.push({ type: 'list', items });
      continue;
    }

    if (line.startsWith('شکل —') || line.startsWith('شکل ')) {
      blocks.push({ type: 'caption', text: line.replace(/^شکل\s*—?\s*/, '').trim() });
      continue;
    }

    /**
     * A paragraph runs to the next blank line, as Markdown defines it.
     *
     * Emitting one block per source line was wrong twice over: the manual's prose is hard
     * wrapped, so every paragraph was split into several, and any `**bold**` span that
     * crossed a wrap printed its asterisks literally because the opening and closing markers
     * landed in different blocks.
     */
    const paragraphLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('|') &&
      !lines[i].startsWith('> ') &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('![') &&
      !lines[i].startsWith('شکل') &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^---+$/.test(lines[i].trim())
    ) {
      paragraphLines.push(lines[i].trim());
      i += 1;
    }
    i -= 1;
    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
  }
  return blocks;
}

// --- HTML ------------------------------------------------------------------

const escHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inlineHtml(text) {
  return escHtml(text)
    .replace(/`([^`]+)`/g, '<code dir="ltr">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function toHtml(blocks, meta) {
  let figure = 0;
  const parts = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        parts.push(`<h${b.level} id="h${parts.length}">${inlineHtml(b.text)}</h${b.level}>`);
        break;
      case 'paragraph':
        parts.push(`<p>${inlineHtml(b.text)}</p>`);
        break;
      case 'callout':
        parts.push(`<aside class="callout ${b.kind}">${inlineHtml(b.text)}</aside>`);
        break;
      case 'list':
        parts.push(`<ul>${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join('')}</ul>`);
        break;
      case 'table':
        parts.push(
          `<div class="scroll"><table><thead><tr>${b.rows[0].map((c) => `<th>${inlineHtml(c)}</th>`).join('')}</tr></thead>` +
            `<tbody>${b.rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
        );
        break;
      case 'code':
        parts.push(`<pre dir="ltr"><code>${escHtml(b.lines.join('\n'))}</code></pre>`);
        break;
      case 'rule':
        parts.push('<hr>');
        break;
      case 'image':
        figure += 1;
        parts.push(`<figure><img src="${escHtml(b.src)}" alt="${escHtml(b.alt)}" loading="lazy"></figure>`);
        break;
      case 'caption':
        parts.push(`<p class="caption">شکل ${figure} — ${inlineHtml(b.text)}</p>`);
        break;
      default:
        break;
    }
  }
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(meta.title)}</title>
<style>
:root { color-scheme: light dark; --ink:#1f2a44; --muted:#5a6379; --line:#c7cbd8; --bg:#fff; }
@media (prefers-color-scheme: dark){ :root{ --ink:#e8ebf2; --muted:#a5adc0; --line:#3a4156; --bg:#141824; } }
html,body{ background:var(--bg); color:var(--ink); }
body { font-family: Tahoma, "Segoe UI", sans-serif; line-height: 1.9; margin: 0 auto; padding: 2rem 1rem 4rem; max-width: 60rem; }
h1 { font-size: 1.9rem; border-block-end: 2px solid var(--line); padding-block-end: .4rem; margin-block-start: 2.5rem; }
h2 { font-size: 1.45rem; margin-block-start: 2rem; }
h3 { font-size: 1.2rem; }
code { font-family: Consolas, monospace; background: rgba(127,127,127,.14); padding: .1em .35em; border-radius: 3px; }
pre { direction: ltr; text-align: left; background: rgba(127,127,127,.12); padding: .9rem; border-radius: 6px; overflow-x: auto; }
pre code { background: none; padding: 0; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; inline-size: 100%; margin-block: .8rem; font-size: .93rem; }
th, td { border: 1px solid var(--line); padding: .45rem .6rem; text-align: start; vertical-align: top; }
th { background: rgba(127,127,127,.14); }
figure { margin: 1.2rem 0 .3rem; }
img { max-inline-size: 100%; block-size: auto; border: 1px solid var(--line); border-radius: 6px; display: block; margin-inline: auto; }
.caption { text-align: center; color: var(--muted); font-size: .88rem; margin-block-start: .2rem; }
.callout { border-inline-start: 4px solid var(--line); padding: .7rem 1rem; margin-block: 1rem; background: rgba(127,127,127,.09); border-radius: 4px; }
.callout.security { border-inline-start-color: #b4423c; }
.callout.warning { border-inline-start-color: #c9862b; }
hr { border: 0; border-block-start: 1px solid var(--line); margin-block: 2rem; }
@media print { body { max-width: none; } h1 { break-before: page; } figure, table { break-inside: avoid; } }
</style>
</head>
<body>
${parts.join('\n')}
</body>
</html>
`;
}

// --- PDF via the locally installed Word ------------------------------------

function toPdf(docxPath, pdfPath) {
  // wdExportFormatPDF = 17, wdExportOptimizeForPrint = 0, wdExportDocumentWithMarkup = 7.
  const ps = `
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
# Force Latin digits (wdNumeralArabic = 0). Word shapes ASCII digits according to this
# application option at export time, so on a machine set to "Context" or "Hindi" the manual
# printed OD-014 as OD-٠١٤ and the commit hash 28bb4f0 as ٢٨bb٤f٠ — identifiers a reader has
# to retype exactly. Neither run direction nor run language overrides it. The previous value
# is restored below so this build does not silently change the operator's Word settings.
$previousNumeral = $word.Options.ArabicNumeral
$word.Options.ArabicNumeral = 0
try {
  $doc = $word.Documents.Open('${docxPath.replace(/'/g, "''")}', $false, $true)
  # Refresh the table of contents so page numbers match this build.
  foreach ($toc in $doc.TablesOfContents) { $toc.Update() }
  $doc.ExportAsFixedFormat('${pdfPath.replace(/'/g, "''")}', 17, $false, 0, 0, 0, 0, 7, $true, $true, 1, $true, $true, $false)
  $doc.Close($false)
} finally {
  $word.Options.ArabicNumeral = $previousNumeral
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
`;
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'pipe', encoding: 'utf8' });
}

// --- Build -----------------------------------------------------------------

const meta = {
  version: '۱٫۰',
  generatedAt: new Date().toISOString().slice(0, 10),
  commit: git(['rev-parse', '--short', 'HEAD'], 'unknown'),
  branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown'),
  disclaimer:
    'این راهنما بر اساس قابلیت‌های واقعی نسخه ثبت‌شده تهیه شده است. قابلیت‌های وابسته به تصمیم‌های باز، مجوزهای خاص یا ارائه‌دهندگان خارجی به‌صورت محدود، غیرفعال، آزمایشی یا مسدود مشخص شده‌اند.'
};

const DOCUMENTS = [
  {
    source: 'dragon-complete-guide-fa.md',
    stem: 'dragon-complete-guide-fa',
    title: 'راهنمای جامع استفاده، مدیریت و پیکربندی اکوسیستم Dragon',
    subtitle: 'راهنمای کاربران، برگزارکنندگان، مدرسان، اپراتورها و مدیران فنی'
  },
  {
    source: 'dragon-quick-start-fa.md',
    stem: 'dragon-quick-start-fa',
    title: 'راهنمای شروع سریع اکوسیستم Dragon',
    subtitle: 'مرجع عملیاتی کوتاه برای اپراتورها و مدیران'
  }
];

const skipPdf = process.argv.includes('--skip-pdf');
mkdirSync(join(DOCS, 'assets', 'diagrams'), { recursive: true });

for (const doc of DOCUMENTS) {
  const source = readFileSync(join(DOCS, doc.source), 'utf8');
  const resolved = expand(source);
  const blocks = parse(resolved);
  const docMeta = { ...meta, title: doc.title, subtitle: doc.subtitle };

  // The resolved Markdown is a delivered artefact: it is what the DOCX and HTML were built
  // from, so a reader can diff it rather than reverse-engineer the binary.
  writeFileSync(join(DOCS, `${doc.stem}.resolved.md`), resolved, 'utf8');
  writeFileSync(join(DOCS, `${doc.stem}.html`), toHtml(blocks, docMeta), 'utf8');

  const { buffer, figures } = buildDocx(blocks, docMeta, SHOTS);
  const docxPath = join(DOCS, `${doc.stem}.docx`);
  writeFileSync(docxPath, buffer);

  let pdf = 'skipped';
  if (!skipPdf) {
    const pdfPath = join(DOCS, `${doc.stem}.pdf`);
    toPdf(docxPath, pdfPath);
    pdf = existsSync(pdfPath) ? `${String(Math.round(readFileSync(pdfPath).length / 1024))} kB` : 'FAILED';
  }
  console.log(`${doc.stem}: ${String(blocks.length)} blocks, ${String(figures)} figures, pdf ${pdf}`);
}
