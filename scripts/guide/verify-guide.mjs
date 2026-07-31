/**
 * Verifies the produced manual instead of assuming a file that exists is a file that is right.
 *
 * Three kinds of check, all local:
 *   1. Source and content — every referenced figure exists, every figure has a caption and
 *      alt text, no marker was left unresolved, and nothing that looks like a credential
 *      reached the text.
 *   2. PDF structure — A4 page geometry, page count, and embedded fonts, read from the file.
 *   3. Visual — representative and high-risk pages rendered to images through the platform's
 *      own PDF renderer, so layout problems can actually be looked at rather than inferred.
 *
 * Exits non-zero when a check fails, so `npm run guide:verify` is a real gate.
 *
 * Usage: node scripts/guide/verify-guide.mjs [--skip-render]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCS = join(ROOT, 'docs', 'user-guides');
const SHOTS = join(DOCS, 'assets', 'screenshots');
const RENDER = join(DOCS, 'assets', 'pdf-pages');

const failures = [];
const notes = [];
const fail = (m) => failures.push(m);
const note = (m) => notes.push(m);

/**
 * Text that must never appear in a distributed document.
 *
 * Deliberately narrow enough to be actionable: it looks for credential *values* and real
 * contact details, not for the words "secret" or "token", which the manual legitimately uses
 * when explaining which variables are secret and must not be committed.
 */
const FORBIDDEN = [
  { label: 'AWS-style access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'bearer token value', re: /\bBearer\s+[A-Za-z0-9._-]{20,}/ },
  { label: 'session cookie value', re: /dragon_session=[A-Za-z0-9._-]+/ },
  { label: 'real-looking mobile number', re: /\b09\d{9}\b/ },
  { label: 'email address', re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  { label: 'assigned Kavenegar key', re: /KAVENEGAR_API_KEY\s*=\s*[A-Za-z0-9]{8,}/ },
  { label: 'assigned Arvan credential', re: /ARVAN_[A-Z_]*\s*=\s*(?!<)[A-Za-z0-9]{8,}/ }
];

// --- 1. Source and content --------------------------------------------------

const DOCUMENTS = ['dragon-complete-guide-fa', 'dragon-quick-start-fa'];
const available = new Set(existsSync(SHOTS) ? readdirSync(SHOTS) : []);

let figuresChecked = 0;
for (const stem of DOCUMENTS) {
  const resolvedPath = join(DOCS, `${stem}.resolved.md`);
  if (!existsSync(resolvedPath)) {
    fail(`${stem}: resolved markdown missing — run npm run guide:build`);
    continue;
  }
  const text = readFileSync(resolvedPath, 'utf8');

  if (text.includes('<!--INCLUDE:')) fail(`${stem}: an INCLUDE marker was left unresolved`);
  if (text.includes('تولید نشد')) fail(`${stem}: a generated table failed to render`);

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const img = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(lines[i]);
    if (img === null) continue;
    figuresChecked += 1;
    const [, alt, src] = img;
    const file = src.split('/').pop();
    if (!available.has(file)) fail(`${stem}: figure references a missing screenshot: ${file}`);
    if (alt.trim() === '') fail(`${stem}: figure ${file} has no alt text`);
    // A figure without a caption is unusable in print: the reader cannot tell what they are
    // looking at or which step it belongs to.
    const next = (lines[i + 1] ?? '') + (lines[i + 2] ?? '');
    if (!next.includes('شکل')) fail(`${stem}: figure ${file} has no caption`);
  }

  for (const { label, re } of FORBIDDEN) {
    const hit = re.exec(text);
    if (hit !== null) fail(`${stem}: text contains a ${label}: ${hit[0].slice(0, 40)}`);
  }

  /**
   * The reader-facing manual must not tell an ordinary user or a non-technical administrator
   * to call the API by hand; that belongs in the restricted technical-operator appendix.
   *
   * A review found exactly one breach — a streaming troubleshooting row whose "how to check"
   * cell named a raw endpoint — so the boundary is now checked rather than trusted. The
   * development-only OTP inbox is allowed: it appears in the local-setup chapter, is labelled
   * development-only, and is how a developer reads their own sign-in code locally.
   */
  const ALLOWED_ENDPOINT_MENTION = /\/api\/v1\/dev\//;
  for (const [index, line] of lines.entries()) {
    const mention = /`?\b(?:GET|POST|PUT|PATCH|DELETE)?\s*\/api\/v1\/[^\s`|]+/.exec(line);
    if (mention === null || ALLOWED_ENDPOINT_MENTION.test(mention[0])) continue;
    fail(
      `${stem}:${String(index + 1)}: a reader-facing chapter names a raw API endpoint ` +
        `(${mention[0].trim()}); move it to THIRD_PARTY_SETUP_FA.md`
    );
  }

  const html = join(DOCS, `${stem}.html`);
  if (!existsSync(html)) fail(`${stem}: html output missing`);
  for (const ext of ['docx', 'pdf']) {
    if (!existsSync(join(DOCS, `${stem}.${ext}`))) fail(`${stem}: ${ext} output missing`);
  }
}

// --- 2. PDF structure -------------------------------------------------------

/** A4 in PDF points, within a tolerance that absorbs Word's rounding. */
const A4 = { width: 595, height: 842 };

function inspectPdf(path) {
  const buf = readFileSync(path);
  const text = buf.toString('latin1');
  const boxes = [...text.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => ({
    width: Math.round(Number(m[3]) - Number(m[1])),
    height: Math.round(Number(m[4]) - Number(m[2]))
  }));
  // Either orientation counts: a table too wide for the portrait text column is placed in its
  // own landscape section, and a rotated A4 page is still A4.
  const isA4 = (b) =>
    (Math.abs(b.width - A4.width) <= 3 && Math.abs(b.height - A4.height) <= 3) ||
    (Math.abs(b.width - A4.height) <= 3 && Math.abs(b.height - A4.width) <= 3);
  const nonA4 = boxes.filter((b) => !isA4(b));
  const landscape = boxes.filter((b) => isA4(b) && b.width > b.height).length;
  return {
    sizeKb: Math.round(buf.length / 1024),
    mediaBoxes: boxes.length,
    nonA4,
    landscapePages: landscape,
    hasFonts: /\/Type\s*\/Font/.test(text),
    hasEmbeddedFontFile: /\/FontFile[23]?\b/.test(text),
    hasLinks: /\/Subtype\s*\/Link/.test(text),
    // A PDF whose pages are single images would have text nobody can select or search.
    imageOnly: !/\/Type\s*\/Font/.test(text)
  };
}

const pdfFacts = {};
for (const stem of DOCUMENTS) {
  const path = join(DOCS, `${stem}.pdf`);
  if (!existsSync(path)) continue;
  const facts = inspectPdf(path);
  pdfFacts[stem] = facts;
  if (facts.imageOnly) fail(`${stem}.pdf: no text objects — the Persian text would not be selectable`);
  if (!facts.hasFonts) fail(`${stem}.pdf: no fonts referenced`);
  if (facts.nonA4.length > 0) fail(`${stem}.pdf: ${String(facts.nonA4.length)} page(s) are not A4`);
  if (facts.sizeKb > 40_000) fail(`${stem}.pdf: ${String(facts.sizeKb)} kB is impractical to distribute`);
  if (!facts.hasLinks) note(`${stem}.pdf: no link annotations found`);
}

// --- 3. Visual rendering ----------------------------------------------------

/**
 * Renders pages through `Windows.Data.Pdf`, the renderer already present on the platform.
 * Rendering is what makes the visual checks real: a page count proves nothing about whether
 * Persian shaping survived, whether a screenshot is clipped, or whether a heading is orphaned.
 */
function renderPages(pdfPath, outDir, pages) {
  mkdirSync(outDir, { recursive: true });
  const ps = `
$ErrorActionPreference = 'Stop'
[Windows.Data.Pdf.PdfDocument,Windows.Data.Pdf,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.InMemoryRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime] | Out-Null
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$ops = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
$asTaskOp = ($ops | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
$asTaskAction = ($ops | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
function AwaitOp($op, $t) { $m = $asTaskOp.MakeGenericMethod($t); $task = $m.Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
function AwaitAct($act) { $task = $asTaskAction.Invoke($null, @($act)); $task.Wait(-1) | Out-Null }

$file = AwaitOp ([Windows.Storage.StorageFile]::GetFileFromPathAsync('${pdfPath.replace(/'/g, "''")}')) ([Windows.Storage.StorageFile])
$pdf = AwaitOp ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
Write-Output "pages=$($pdf.PageCount)"
foreach ($n in @(${pages.join(',')})) {
  if ($n -ge $pdf.PageCount) { continue }
  $page = $pdf.GetPage($n)
  $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
  $opts.DestinationWidth = 1200
  AwaitAct ($page.RenderToStreamAsync($stream, $opts))
  $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
  AwaitOp ($reader.LoadAsync([uint32]$stream.Size)) ([uint32]) | Out-Null
  $bytes = New-Object byte[] $stream.Size
  $reader.ReadBytes($bytes)
  [System.IO.File]::WriteAllBytes((Join-Path '${outDir.replace(/'/g, "''")}' ("page-" + $n.ToString("000") + ".png")), $bytes)
  $page.Dispose()
  Write-Output "rendered=$n"
}
`;
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
}

if (!process.argv.includes('--skip-render')) {
  for (const stem of DOCUMENTS) {
    const path = join(DOCS, `${stem}.pdf`);
    if (!existsSync(path)) continue;
    const facts = pdfFacts[stem];
    const last = Math.max(0, facts.mediaBoxes - 1);
    // Cover, contents, and a spread across the document, always including its final page.
    const pages = [...new Set([0, 1, 2, 5, 10, 18, 26, 34, 42, 50, 60, 70, last])].filter((p) => p <= last);
    try {
      const out = renderPages(path, join(RENDER, stem), pages);
      const rendered = [...out.matchAll(/rendered=(\d+)/g)].length;
      note(`${stem}: rendered ${String(rendered)} page(s) for visual inspection`);
      if (rendered === 0) fail(`${stem}: the PDF renderer produced no pages`);
    } catch (error) {
      fail(`${stem}: page rendering failed — ${String(error).split('\n')[0]}`);
    }
  }
}

// --- Report -----------------------------------------------------------------

const report = {
  documents: DOCUMENTS.map((stem) => ({ document: stem, ...pdfFacts[stem] })),
  figuresChecked,
  screenshotsAvailable: available.size,
  failures,
  notes
};
writeFileSync(join(DOCS, 'GUIDE_VERIFICATION_REPORT.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

for (const stem of DOCUMENTS) {
  const f = pdfFacts[stem];
  if (f === undefined) continue;
  console.log(
    `${stem}: ${String(f.mediaBoxes)} pages, ${String(f.sizeKb)} kB, A4 ${f.nonA4.length === 0 ? 'ok' : 'MIXED'}, ` +
      `text ${f.imageOnly ? 'MISSING' : 'selectable'}, embedded fonts ${f.hasEmbeddedFontFile ? 'yes' : 'no'}, landscape ${String(f.landscapePages)}`
  );
}
console.log(`figures checked: ${String(figuresChecked)} (screenshots available: ${String(available.size)})`);
for (const n of notes) console.log(`  note: ${n}`);
for (const f of failures) console.error(`  FAIL: ${f}`);

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} verification failure(s).`);
  process.exit(1);
}
console.log('\nguide verification passed.');
