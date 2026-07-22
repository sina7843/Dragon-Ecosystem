import sanitizeHtml from 'sanitize-html';

/**
 * Rich-content sanitisation (CONTENT-005, SEC-003).
 *
 * Editorial bodies are sanitised on write to a strict allowlist, so stored and
 * rendered content can never execute a script or an unsafe attribute. Sanitising
 * at the trust boundary (write) means the public read path serves already-safe
 * HTML. A vetted library is used deliberately — hand-rolled HTML sanitisation is
 * a classic source of XSS bypasses.
 */

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 's',
  'h2', 'h3', 'h4',
  'ul', 'ol', 'li',
  'blockquote', 'code', 'pre',
  'a', 'img',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'figure', 'figcaption'
];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ['href', 'title', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    '*': ['dir', 'lang'] // bidi and language markers for mixed fa/en content (section 17.5)
  },
  // http(s) and relative links/images only — blocks javascript:, data:, vbscript:.
  allowedSchemes: ['http', 'https'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  // External links open safely.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow' })
  },
  disallowedTagsMode: 'discard'
};

export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/** Plain-text extraction for search indexing and summaries (no markup). */
export function toPlainText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}
