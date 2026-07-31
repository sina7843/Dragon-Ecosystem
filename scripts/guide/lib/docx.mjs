import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { zip } from './zip.mjs';

/**
 * Produces a right-to-left A4 Word document from the parsed manual.
 *
 * Written directly as WordprocessingML rather than through a library, for the same reason as
 * the ZIP writer: this is documentation tooling living inside the product repository, and it
 * should not add a dependency to do it. Writing the XML also gives exact control over the
 * things that actually matter here — paragraph-level `w:bidi`, run-level `w:rtl`, table
 * `w:bidiVisual`, and a real TOC field Word can update — none of which survive a generic
 * HTML-to-Word conversion intact.
 */

const A4_WIDTH = 11906; // twips
const A4_HEIGHT = 16838;
const MARGIN = 1134; // 2 cm
const CONTENT_WIDTH_EMU = 5_400_000; // ~14.3 cm, the usable width between margins

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A run. `rtl` is on by default because the document language is Persian. */
function run(text, { bold = false, mono = false, rtl = true, size = null, color = null } = {}) {
  // Child order follows the CT_RPr sequence exactly: rFonts, b, bCs, color, sz, szCs, rtl.
  // Word rejects the whole package as corrupt when these appear out of order.
  const props = [
    `<w:rFonts w:ascii="${mono ? 'Consolas' : 'Tahoma'}" w:hAnsi="${mono ? 'Consolas' : 'Tahoma'}" w:cs="Tahoma"/>`,
    bold ? '<w:b/><w:bCs/>' : '',
    color === null ? '' : `<w:color w:val="${color}"/>`,
    size === null ? '' : `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`,
    // A code span is Latin by nature; forcing RTL on it reverses the visual order of symbols.
    rtl && !mono ? '<w:rtl/>' : '',
    // An explicit Latin language on the run is what actually pins digit shaping. Clearing
    // `w:rtl` alone was not enough: Word still shaped `OD-014` as `OD-٠١٤` from the
    // surrounding bidi paragraph, which corrupts identifiers a reader has to retype.
    // `w:lang` follows `w:rtl` in the CT_RPr sequence.
    rtl && !mono ? '' : '<w:lang w:val="en-US" w:bidi="en-US"/>'
  ].join('');
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

/**
 * Renders the small inline subset the manual uses: `code`, **bold**, and plain text.
 * Deliberately not a full inline grammar — anything richer would be harder to proofread in
 * Persian than it is worth.
 */
/**
 * Splits plain Persian text so that any token containing Latin digits becomes its own
 * left-to-right run.
 *
 * Word shapes digits according to the run they sit in, so `OD-014` inside a right-to-left run
 * printed as `OD-٠١٤` and the commit hash `28bb4f0` printed as `٢٨bb٤f٠`. Those are
 * identifiers: a reader has to be able to type them back exactly, and a Persian-numeral
 * rendering of a hex hash is simply wrong. Persian numerals written as Persian characters in
 * the source are unaffected, because this only matches ASCII.
 */
function latinize(text) {
  const parts = [];
  const token = /[A-Za-z0-9][A-Za-z0-9._:/\\-]*/g;
  let last = 0;
  for (const m of text.matchAll(token)) {
    if (!/\d/.test(m[0])) continue;
    if (m.index > last) parts.push(run(text.slice(last, m.index)));
    parts.push(run(m[0], { rtl: false }));
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(run(text.slice(last)));
  return parts.join('');
}

function inline(text) {
  const out = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) out.push(latinize(text.slice(last, m.index)));
    if (m[1] !== undefined) out.push(run(m[1].slice(1, -1), { mono: true, rtl: false }));
    else out.push(run(m[2].slice(2, -2), { bold: true }));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(latinize(text.slice(last)));
  return out.join('');
}

/**
 * Child order follows the CT_PPr sequence: pStyle, pageBreakBefore, pBdr, shd, bidi,
 * spacing, ind, jc. Emitting `jc` before `spacing`, as an earlier revision did, makes Word
 * refuse the file outright with "the file appears to be corrupted" — the schema is ordered,
 * not a bag of properties. Indent attributes use the transitional names (`w:left`/`w:right`)
 * rather than the strict ones (`w:start`/`w:end`), which Word does not accept here.
 */
function paragraph(content, { style = null, align = null, spacingAfter = 120, indent = null, size = null } = {}) {
  // A size override is applied by rewriting the runs' sizes, so a dense table can be set
  // smaller without every caller having to thread the size through `inline()`.
  const sized =
    size === null
      ? content
      : content.replace(/<w:rPr>/g, `<w:rPr><w:szTmp/>`).replace(/<w:sz w:val="\d+"\/><w:szCs w:val="\d+"\/>/g, '').replace(/<w:szTmp\/>/g, `<w:sz w:val="${String(size)}"/><w:szCs w:val="${String(size)}"/>`);
  const props = [
    style === null ? '' : `<w:pStyle w:val="${style}"/>`,
    '<w:bidi/>',
    `<w:spacing w:after="${spacingAfter}" w:line="288" w:lineRule="auto"/>`,
    indent === null ? '' : `<w:ind w:left="${indent}"/>`,
    align === null ? '' : `<w:jc w:val="${align}"/>`
  ].join('');
  return `<w:p><w:pPr>${props}</w:pPr>${sized}</w:p>`;
}

function heading(level, text) {
  return `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/>${level === 1 ? '<w:pageBreakBefore/>' : ''}<w:bidi/><w:spacing w:before="${level === 1 ? 360 : 240}" w:after="120"/></w:pPr>${inline(text)}</w:p>`;
}

function table(input) {
  /**
   * Every row is normalised to the header's column count. A row wider than the declared
   * grid makes Word refuse the whole document, and a document that fails to open is a worse
   * outcome than a table with one padded cell — so this is a hard guarantee, not a hope
   * about the input.
   */
  const declared = Math.max(1, input[0].length);
  const padded = input.map((r) => (r.length === declared ? r : [...r.slice(0, declared), ...Array(Math.max(0, declared - r.length)).fill('')]));

  /**
   * A wide, short table is transposed so its header becomes the first column.
   *
   * The diagnosis tables carry seven fields per finding. Seven columns do not fit an A4
   * portrait page: the last column ran off the edge and was simply lost in print, which for a
   * troubleshooting table means losing the answer. Transposing keeps every field, and a
   * reader following one symptom reads down a column rather than across a cramped row.
   * Only applied when the result is itself narrow, so long generated tables are unaffected.
   */
  const shouldTranspose = declared > 5 && padded.length - 1 <= 4;
  const rows = shouldTranspose
    ? padded[0].map((headerCell, columnIndex) => [headerCell, ...padded.slice(1).map((r) => r[columnIndex])])
    : padded;
  const columns = rows[0].length;
  const width = Math.floor(9000 / columns);
  const grid = rows[0].map(() => `<w:gridCol w:w="${width}"/>`).join('');
  const body = rows
    .map((cells, rowIndex) => {
      const tr = cells
        .map(
          (cell, cellIndex) =>
            `<w:tc><w:tcPr><w:tcW w:w="${String(Math.floor(5000 / columns))}" w:type="pct"/>${(shouldTranspose ? cellIndex === 0 : rowIndex === 0) ? '<w:shd w:val="clear" w:fill="EDEFF5"/>' : ''}</w:tcPr>` +
            paragraph(inline(cell), { spacingAfter: 40, size: columns > 4 ? 16 : null }) +
            '</w:tc>'
        )
        .join('');
      return `<w:tr>${!shouldTranspose && rowIndex === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${tr}</w:tr>`;
    })
    .join('');
  const tbl =
    '<w:tbl><w:tblPr><w:bidiVisual/>' +
    '<w:tblW w:w="5000" w:type="pct"/>' +
    // Autofit, so a wide diagnosis table is compressed to the text column instead of
    // running off the page edge and losing its last column in print.
    '<w:tblLayout w:type="autofit"/>' +
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="C7CBD8"/>`)
      .join('') +
    '</w:tblBorders></w:tblPr>' +
    `<w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>` +
    paragraph('', { spacingAfter: 120 });

  if (columns <= 5) return tbl;

  /**
   * A table too wide for the portrait text column gets its own landscape section.
   *
   * Transposing solves the short diagnosis tables, but one of them has six findings, and
   * transposing that produces seven columns again. Shrinking the font far enough to fit seven
   * readable Persian columns into 14 cm is not possible either. Rotating the page is the only
   * option that keeps every field legible, and it is confined to the table: the paragraph
   * before it closes the portrait section, and the one after it closes the landscape section
   * so the following chapter returns to portrait.
   */
  const sect = (landscape) =>
    '<w:p><w:pPr><w:bidi/><w:sectPr>' +
    (landscape
      ? `<w:pgSz w:w="${A4_HEIGHT}" w:h="${A4_WIDTH}" w:orient="landscape"/>`
      : `<w:pgSz w:w="${A4_WIDTH}" w:h="${A4_HEIGHT}"/>`) +
    `<w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="708" w:footer="708" w:gutter="0"/>` +
    '<w:bidi/></w:sectPr></w:pPr></w:p>';

  return sect(false) + tbl + sect(true);
}

function image(relationId, widthEmu, heightEmu, altText, index) {
  return (
    '<w:p><w:pPr><w:bidi/><w:spacing w:before="120" w:after="60"/><w:jc w:val="center"/></w:pPr>' +
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${widthEmu}" cy="${heightEmu}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${index}" name="Figure ${index}" descr="${esc(altText)}"/>` +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:nvPicPr><pic:cNvPr id="${index}" name="Figure ${index}" descr="${esc(altText)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relationId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
  );
}

/** Reads a PNG's intrinsic size from its IHDR chunk so figures keep their aspect ratio. */
function pngSize(buffer) {
  if (buffer.length < 24 || buffer.readUInt32BE(12) !== 0x49484452) return { width: 1440, height: 900 };
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function callout(text, kind) {
  const fill = { warning: 'FDF3E7', security: 'FBEAEA', note: 'EDF2FB', unavailable: 'F1F1F4' }[kind] ?? 'EDF2FB';
  return (
    '<w:p><w:pPr>' +
    '<w:pBdr><w:left w:val="single" w:sz="18" w:space="6" w:color="8A93A8"/></w:pBdr>' +
    `<w:shd w:val="clear" w:fill="${fill}"/><w:bidi/>` +
    '<w:spacing w:before="120" w:after="120"/><w:ind w:left="140" w:right="140"/></w:pPr>' +
    `${inline(text)}</w:p>`
  );
}

function codeBlock(lines) {
  return lines
    .map((line, i) =>
      paragraph(run(line === '' ? ' ' : line, { mono: true, rtl: false, size: 17 }), {
        align: 'left',
        spacingAfter: i === lines.length - 1 ? 120 : 0,
        indent: 140
      })
    )
    .join('');
}

/**
 * Assembles the whole package.
 *
 * `blocks` is the parsed manual; `meta` carries the cover facts (commit, date, version) that
 * make a printed copy traceable back to the exact revision it describes.
 */
export function buildDocx(blocks, meta, screenshotDir) {
  const media = [];
  const rels = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
  ];
  let relSeq = 3;
  let figureSeq = 0;
  /** filename -> relationship id, so a repeated figure is stored once. */
  const mediaIds = new Map();

  const body = [];

  // --- Cover -------------------------------------------------------------
  body.push(
    paragraph('', { spacingAfter: 2400 }),
    paragraph(run(meta.title, { bold: true, size: 56 }), { align: 'center', spacingAfter: 200 }),
    paragraph(run(meta.subtitle, { size: 32 }), { align: 'center', spacingAfter: 1200 }),
    callout(meta.disclaimer, 'note'),
    paragraph('', { spacingAfter: 600 }),
    table([
      ['مورد', 'مقدار'],
      ['نسخه سند', meta.version],
      ['تاریخ تولید', meta.generatedAt],
      ['Commit مخزن', meta.commit],
      ['شاخه', meta.branch]
    ])
  );

  // --- Table of contents -------------------------------------------------
  body.push(
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:bidi/><w:pageBreakBefore/></w:pPr>${inline('فهرست مطالب')}</w:p>`,
    '<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      `${run('برای به‌روزرسانی فهرست، در Word کلید F9 را بزنید.')}` +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
  );

  // --- Content -----------------------------------------------------------
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        body.push(heading(Math.min(block.level, 4), block.text));
        break;
      case 'paragraph':
        body.push(paragraph(inline(block.text)));
        break;
      case 'callout':
        body.push(callout(block.text, block.kind));
        break;
      case 'list':
        for (const item of block.items) {
          body.push(paragraph(inline(`• ${item}`), { indent: 280, spacingAfter: 40 }));
        }
        body.push(paragraph('', { spacingAfter: 80 }));
        break;
      case 'table':
        body.push(table(block.rows));
        break;
      case 'code':
        body.push(codeBlock(block.lines));
        break;
      case 'rule':
        body.push(
          '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="C7CBD8"/></w:pBdr><w:bidi/><w:spacing w:after="200"/></w:pPr></w:p>'
        );
        break;
      case 'image': {
        let buffer;
        try {
          buffer = readFileSync(join(screenshotDir, basename(block.src)));
        } catch {
          // A missing figure is reported by the verifier; the document keeps flowing.
          body.push(callout(`تصویر یافت نشد: ${basename(block.src)}`, 'warning'));
          break;
        }
        figureSeq += 1;
        /**
         * A figure may legitimately appear in more than one chapter — the users screen is
         * referenced both where roles are explained and where administration is described.
         * Adding its bytes twice produced two ZIP entries with the same name, which Word
         * reports only as "the file appears to be corrupted". One part, one relationship,
         * reused wherever the image recurs.
         */
        const file = basename(block.src);
        let id = mediaIds.get(file);
        if (id === undefined) {
          relSeq += 1;
          id = `rId${relSeq}`;
          mediaIds.set(file, id);
          media.push({ name: `word/media/${file}`, data: buffer, store: true });
          rels.push(
            `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${file}"/>`
          );
        }
        const { width, height } = pngSize(buffer);
        const heightEmu = Math.round((CONTENT_WIDTH_EMU * height) / width);
        body.push(image(id, CONTENT_WIDTH_EMU, heightEmu, block.alt, figureSeq));
        break;
      }
      case 'caption':
        body.push(
          paragraph(inline(`شکل ${String(figureSeq)} — ${block.text}`), { align: 'center', spacingAfter: 220, size: 18 })
        );
        break;
      default:
        break;
    }
  }

  const sectPr =
    '<w:sectPr><w:footerReference w:type="default" r:id="rId3"/>' +
    `<w:pgSz w:w="${A4_WIDTH}" w:h="${A4_HEIGHT}"/>` +
    `<w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="708" w:footer="708" w:gutter="0"/>` +
    '<w:bidi/></w:sectPr>';

  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
    `<w:body>${body.join('')}${sectPr}</w:body></w:document>`;

  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:cs="Tahoma"/><w:sz w:val="21"/><w:szCs w:val="21"/>' +
    '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:bidi/></w:pPr></w:pPrDefault></w:docDefaults>' +
    [1, 2, 3, 4]
      .map(
        (level) =>
          `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/>` +
          '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
          `<w:pPr><w:outlineLvl w:val="${level - 1}"/><w:bidi/></w:pPr>` +
          `<w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:cs="Tahoma"/><w:b/><w:bCs/><w:color w:val="1F2A44"/><w:sz w:val="${[34, 28, 24, 22][level - 1]}"/><w:szCs w:val="${[34, 28, 24, 22][level - 1]}"/></w:rPr></w:style>`
      )
      .join('') +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '</w:styles>';

  const settings =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    // Word refreshes the table of contents on open, so a rebuilt document is never stale.
    '<w:updateFields w:val="true"/>' +
    '<w:themeFontLang w:val="en-US" w:bidi="fa-IR"/>' +
    '</w:settings>';

  const footer =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:p><w:pPr><w:bidi/><w:jc w:val="center"/></w:pPr>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:cs="Tahoma"/><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>';

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>';

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rIdDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rIdCore" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '</Relationships>';

  const core =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `<dc:title>${esc(meta.title)}</dc:title><dc:language>fa-IR</dc:language>` +
    `<dc:description>${esc(meta.version)} — ${esc(meta.commit)}</dc:description></cp:coreProperties>`;

  return {
    buffer: zip([
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rootRels },
      { name: 'docProps/core.xml', data: core },
      { name: 'word/document.xml', data: document },
      { name: 'word/styles.xml', data: styles },
      { name: 'word/settings.xml', data: settings },
      { name: 'word/footer1.xml', data: footer },
      {
        name: 'word/_rels/document.xml.rels',
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`
      },
      ...media
    ]),
    figures: figureSeq
  };
}
