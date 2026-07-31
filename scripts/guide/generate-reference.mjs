/**
 * Generates the reference documents that must never drift from the code:
 * the capability matrix, the screenshot inventory, and the environment-variable appendix.
 *
 * All three are derived — from `SITE_INVENTORY.json` (extracted from source) and
 * `GUIDE_VERIFICATION_MAP.json` (recorded from the running product). Hand-maintaining them
 * would guarantee that the manual eventually describes a permission or a route that no longer
 * exists, which is the specific failure this whole package is meant to avoid.
 *
 * Narrative chapters stay hand-written; only the factual tables are generated.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCS = join(ROOT, 'docs', 'user-guides');

const inventory = JSON.parse(readFileSync(join(DOCS, 'SITE_INVENTORY.json'), 'utf8'));
let capture = { steps: [] };
try {
  capture = JSON.parse(readFileSync(join(DOCS, 'GUIDE_VERIFICATION_MAP.json'), 'utf8'));
} catch {
  console.warn('no capture map yet — run npm run guide:capture first');
}

const esc = (s) => String(s).replace(/\|/g, '\\|');

/**
 * Editorial annotation per module: which manual chapter owns it, and the decision or gate a
 * reader has to know about. Kept beside the generator rather than inside the manual so the
 * matrix and the chapters cannot disagree about which chapter covers what.
 */
const MODULE_META = {
  identity: { fa: 'هویت، ورود و حساب کاربری', chapter: '5', note: '' },
  admin: { fa: 'مدیریت، نقش‌ها، ممیزی و پیکربندی', chapter: '19', note: 'تخصیص نقش فقط از طریق API محافظت‌شده؛ رابط کاربری ندارد.' },
  content: { fa: 'محتوا و اخبار', chapter: '7', note: '' },
  games: { fa: 'کاتالوگ بازی‌ها', chapter: '7', note: '' },
  teams: { fa: 'تیم‌ها و عضویت', chapter: '6', note: '' },
  social: { fa: 'جامعه کاربری', chapter: '14', note: 'مسدودسازی و بی‌صداکردن تا OD-017 غیرفعال است.' },
  tournaments: { fa: 'تورنمنت‌ها', chapter: '8', note: 'ثبت‌نام پولی تا OD-007 غیرفعال است.' },
  registrations: { fa: 'ثبت‌نام و تأیید', chapter: '9', note: '' },
  competitions: { fa: 'رقابت، جدول و نتایج', chapter: '9', note: '' },
  education: { fa: 'آکادمی و دوره‌ها', chapter: '10 و 11', note: 'دوره پولی تا OD-015 غیرفعال است. چرخه: draft ← review ← published.' },
  streams: { fa: 'پخش زنده', chapter: '12', note: 'ارائه‌دهنده «stub» است. OD-013 اتصال ارائه‌دهنده و OD-014 آرشیو و حقوق پخش را مسدود کرده است.' },
  chat: { fa: 'گفت‌وگوی زنده و تعدیل آن', chapter: '13', note: '' },
  store: { fa: 'فروشگاه و سفارش‌ها', chapter: '15', note: 'ارسال کالای فیزیکی تا OD-019 و ابطال حق دیجیتال تا OD-020 غیرفعال است.' },
  checkout: { fa: 'پرداخت و تسویه سبد', chapter: '16', note: 'ارائه‌دهنده پرداخت در این نسخه شبیه‌سازی‌شده است.' },
  payments: { fa: 'درگاه پرداخت', chapter: '16', note: 'فقط ارائه‌دهنده آزمایشی؛ پرداخت واقعی پیکربندی نشده است.' },
  ledger: { fa: 'دفتر کل مالی', chapter: '17', note: '' },
  holds: { fa: 'نگه‌داشت وجه', chapter: '17', note: '' },
  economy: { fa: 'دراگون‌کوین، انتقال و پاداش', chapter: '17', note: 'برداشت نقدی وجود ندارد.' },
  prizes: { fa: 'جوایز و تسویه', chapter: '17', note: '' },
  moderation: { fa: 'تعدیل، پشتیبانی و بازیابی حساب', chapter: '18 و 19', note: 'اعتراض به تصمیم تعدیل تا OD-024 غیرفعال است.' },
  notifications: { fa: 'اعلان‌ها', chapter: '20', note: 'پیامک و ایمیل تا OD-008 و OD-003 غیرفعال است؛ اعلان فوری تا OD-027.' },
  operations: { fa: 'عملیات، سلامت و سنجه‌ها', chapter: '19 و 22', note: '' },
  media: { fa: 'رسانه و بارگذاری', chapter: '21', note: '' },
  seo: { fa: 'نمایه‌سازی و نقشه سایت', chapter: '22', note: '' },
  core: { fa: 'سلامت سرویس و مسیرهای پایه', chapter: '22', note: '' }
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

// --- Capability matrix -----------------------------------------------------

function capabilityMatrix() {
  const byModule = new Map();
  for (const r of inventory.apiRoutes) {
    if (!byModule.has(r.module)) byModule.set(r.module, []);
    byModule.get(r.module).push(r);
  }

  const webByPrefix = (prefix) => inventory.webRoutes.filter((w) => w.path.includes(prefix));
  const areaFor = (module) => inventory.adminAreas.find((a) => a.path.includes(module));
  const screenshotsFor = (chapter) =>
    capture.steps.filter((s) => String(s.chapter) === String(chapter)).map((s) => s.screenshot);

  const lines = [];
  lines.push('# DRAGON — ماتریس قابلیت‌ها');
  lines.push('');
  lines.push('> این سند به‌صورت خودکار از کد تولید می‌شود: `npm run guide:build`.');
  lines.push('> منبع واقعیت‌ها `SITE_INVENTORY.json` (استخراج‌شده از سورس) و');
  lines.push('> `GUIDE_VERIFICATION_MAP.json` (ثبت‌شده از محصول در حال اجرا) است. دستی ویرایش نکنید.');
  lines.push('');
  lines.push('## خلاصه شمارشی');
  lines.push('');
  lines.push('| مورد | تعداد |');
  lines.push('|---|---|');
  lines.push(`| مسیرهای API (نقطه پایانی مشخص) | ${inventory.apiRoutes.length} |`);
  lines.push(`| مسیرهای عمومی بدون نشست | ${inventory.totals.publicApiRoutes} |`);
  lines.push(`| مسیرهای نیازمند نشست | ${inventory.totals.sessionApiRoutes} |`);
  lines.push(`| مسیرهای نیازمند مجوز مشخص | ${inventory.totals.permissionApiRoutes} |`);
  lines.push(`| مسیرهای رابط کاربری | ${inventory.webRoutes.length} |`);
  lines.push(`| ناحیه‌های مدیریتی | ${inventory.adminAreas.length} |`);
  lines.push(`| نقش‌ها | ${Object.keys(inventory.roles).length} |`);
  lines.push(`| مجوزها | ${Object.keys(inventory.permissions).length} |`);
  lines.push(`| Feature Gateها | ${inventory.featureGates.length} |`);
  lines.push(`| متغیرهای محیطی خوانده‌شده | ${inventory.environment.variables.length} |`);
  lines.push(`| تصویرهای ثبت‌شده | ${capture.steps.length} |`);
  lines.push('');

  lines.push('## نقش‌ها و مجوزها');
  lines.push('');
  lines.push('| نقش | کد | مجوزها |');
  lines.push('|---|---|---|');
  for (const [code, perms] of Object.entries(inventory.roles)) {
    const list = perms.includes('*') ? 'همه مجوزها (نقش کنترل‌شده اضطراری)' : perms.join('، ');
    lines.push(`| ${ROLE_FA[code] ?? code} | \`${code}\` | ${esc(list)} |`);
  }
  lines.push('');
  lines.push('> نقش‌هایی که در این جدول نیستند (بازدیدکننده، کاربر عادی، نقش‌های درون‌تیمی)');
  lines.push('> هیچ مجوز مدیریتی ندارند. مدل مجوزدهی «رد به‌صورت پیش‌فرض» است.');
  lines.push('');

  lines.push('## مجوز ← نقش‌های دارنده');
  lines.push('');
  lines.push('| مجوز | نقش‌های دارنده |');
  lines.push('|---|---|');
  for (const [perm, holders] of Object.entries(inventory.permissionHolders)) {
    lines.push(`| \`${perm}\` | ${holders.map((h) => `\`${h}\``).join('، ')} |`);
  }
  lines.push('');

  lines.push('## ناحیه‌های مدیریتی و مجوز نمایش هر کارت');
  lines.push('');
  lines.push('| ناحیه | مسیر | مجوز لازم |');
  lines.push('|---|---|---|');
  for (const a of inventory.adminAreas) {
    lines.push(`| \`${a.testid}\` | \`${a.path}\` | \`${a.permission ?? '—'}\` |`);
  }
  lines.push('');
  lines.push('> پنهان‌بودن یک کارت مرز امنیتی نیست. سرور همان مجوز را روی هر مسیر و هر');
  lines.push('> فراخوانی API مستقل از رابط کاربری بررسی می‌کند.');
  lines.push('');

  lines.push('## Feature Gateها');
  lines.push('');
  lines.push('| تصمیم باز | متغیر محیطی | وضعیت پیش‌فرض |');
  lines.push('|---|---|---|');
  for (const g of inventory.featureGates) {
    lines.push(`| ${g.decision} | \`${g.env}\` | بسته (fail-closed) |`);
  }
  lines.push('');
  lines.push(`> ارائه‌دهنده پخش زنده در کد به \`${inventory.streaming.forcedProvider}\` تثبیت شده است و`);
  lines.push(`> مقدار \`${inventory.streaming.rejectedProviders.join('، ')}\` عمداً رد می‌شود.`);
  lines.push('');

  lines.push('## قابلیت‌ها به تفکیک ماژول');
  lines.push('');
  for (const [module, routes] of [...byModule.entries()].sort()) {
    const meta = MODULE_META[module] ?? { fa: module, chapter: '—', note: '' };
    const area = areaFor(module);
    const perms = [...new Set(routes.map((r) => r.permission).filter(Boolean))];
    const shots = screenshotsFor(meta.chapter);
    lines.push(`### ${meta.fa} (\`${module}\`)`);
    lines.push('');
    lines.push(`- فصل راهنما: ${meta.chapter}`);
    lines.push(`- تعداد نقطه پایانی: ${routes.length}`);
    lines.push(`- مجوزهای مورد استفاده: ${perms.length === 0 ? 'ندارد (عمومی یا فقط نشست)' : perms.map((p) => `\`${p}\``).join('، ')}`);
    lines.push(`- ناحیه مدیریتی: ${area ? `\`${area.path}\`` : 'ندارد'}`);
    lines.push(`- مسیرهای رابط کاربری مرتبط: ${webByPrefix(`/${module === 'education' ? 'academy' : module}`).length}`);
    if (meta.note !== '') lines.push(`- محدودیت مهم: ${meta.note}`);
    if (shots.length > 0) lines.push(`- تصویرها: ${shots.slice(0, 6).map((s) => `\`${s}\``).join('، ')}${shots.length > 6 ? ' …' : ''}`);
    lines.push('');
    lines.push('| متد | مسیر | نوع دسترسی | مجوز |');
    lines.push('|---|---|---|---|');
    for (const r of routes.sort((a, b) => a.path.localeCompare(b.path))) {
      const access = r.auth === 'public' ? 'عمومی' : r.auth === 'session' ? 'نیازمند ورود' : 'نیازمند مجوز';
      lines.push(`| ${r.method} | \`${r.path}\` | ${access} | ${r.permission ? `\`${r.permission}\`` : '—'} |`);
    }
    lines.push('');
  }

  lines.push('## مسیرهای رابط کاربری');
  lines.push('');
  lines.push('| مسیر | نما | پوسته | نمایه‌پذیر |');
  lines.push('|---|---|---|---|');
  for (const w of inventory.webRoutes) {
    lines.push(`| \`${esc(w.path)}\` | \`${w.view}\` | ${w.shell ?? '—'} | ${w.indexable ? 'بله' : 'خیر'} |`);
  }
  lines.push('');
  return lines.join('\n');
}

// --- Screenshot inventory --------------------------------------------------

function screenshotInventory() {
  const lines = [];
  lines.push('# فهرست تصویرها — Screenshot inventory');
  lines.push('');
  lines.push('> تولید خودکار از `GUIDE_VERIFICATION_MAP.json`. هر ردیف وضعیتی است که واقعاً');
  lines.push('> در محصول در حال اجرا مشاهده شده است، نه وضعیتی که انتظار می‌رفت.');
  lines.push('');
  lines.push(`تعداد کل: **${capture.steps.length}** تصویر.`);
  lines.push('');
  const byAvailability = {};
  for (const s of capture.steps) byAvailability[s.availability] = (byAvailability[s.availability] ?? 0) + 1;
  lines.push('| وضعیت مشاهده‌شده | تعداد |');
  lines.push('|---|---|');
  const AV_FA = {
    available: 'در دسترس',
    'permission-required': 'نیازمند مجوز',
    'feature-gated': 'بسته با Feature Gate',
    'provider-unavailable': 'ارائه‌دهنده در دسترس نیست',
    'decision-blocked': 'مسدود با تصمیم باز',
    'not-implemented': 'پیاده‌سازی نشده'
  };
  for (const [k, v] of Object.entries(byAvailability)) lines.push(`| ${AV_FA[k] ?? k} | ${v} |`);
  lines.push('');
  lines.push('| فایل | فصل | مسیر | زبان | نمایش | وضعیت | شرح |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const s of capture.steps) {
    lines.push(
      `| \`${s.screenshot}\` | ${s.chapter} | \`${s.route}\` | ${s.locale} | ${s.viewport} | ${AV_FA[s.availability] ?? s.availability} | ${esc(s.captionFa)} |`
    );
  }
  lines.push('');
  lines.push('## بازبینی داده حساس');
  lines.push('');
  lines.push('پیش از ذخیره هر تصویر، متن صفحه در برابر الگوهای زیر بررسی می‌شود و در صورت');
  lines.push('تطابق، ثبت تصویر با خطا متوقف می‌شود: توکن Bearer، کوکی نشست، بلوک کلید خصوصی،');
  lines.push('کلید دسترسی، امضای URL، عبارت‌های secret، و کلید پخش. همچنین شماره موبایل و');
  lines.push('شناسه‌های بلند پیش از عکس‌برداری پوشانده می‌شوند.');
  lines.push('');
  return lines.join('\n');
}

// --- Environment appendix --------------------------------------------------

function environmentAppendix() {
  const gateByEnv = new Map(inventory.featureGates.map((g) => [g.env, g]));
  const SECRETISH = /SECRET|TOKEN|KEY|PASSWORD|URI/;
  const lines = [];
  lines.push('# ضمیمه متغیرهای محیطی');
  lines.push('');
  lines.push('> تولید خودکار از پیکربندی برنامه. هیچ مقدار واقعی از فایل‌های محلی خوانده یا چاپ نمی‌شود.');
  lines.push('');
  lines.push('| متغیر | نوع | Feature Gate | حاضر در `.env.example` |');
  lines.push('|---|---|---|---|');
  for (const v of inventory.environment.variables) {
    const gate = gateByEnv.get(v);
    lines.push(
      `| \`${v}\` | ${SECRETISH.test(v) ? 'محرمانه' : 'غیرمحرمانه'} | ${gate ? gate.decision : '—'} | ${inventory.environment.example.includes(v) ? 'بله' : '**خیر**'} |`
    );
  }
  lines.push('');
  if (inventory.environment.inCodeNotInExample.length > 0) {
    lines.push('## متغیرهایی که کد می‌خواند اما در `.env.example` نیستند');
    lines.push('');
    for (const v of inventory.environment.inCodeNotInExample) lines.push(`- \`${v}\``);
    lines.push('');
    lines.push('این یک شکاف مستندسازی است و در `TRAINING_AND_UX_FINDINGS.md` ثبت شده است.');
    lines.push('');
  }
  if (inventory.environment.inExampleNotInCode.length > 0) {
    lines.push('## متغیرهای `.env.example` که پیکربندی سرور نمی‌خواند');
    lines.push('');
    for (const v of inventory.environment.inExampleNotInCode) lines.push(`- \`${v}\``);
    lines.push('');
    lines.push('این‌ها را ابزارهای دیگر (پیش‌نمایش وب و پایگاه‌داده آزمون) مصرف می‌کنند.');
    lines.push('');
  }
  return lines.join('\n');
}

writeFileSync(join(DOCS, 'DRAGON_CAPABILITY_MATRIX.md'), `${capabilityMatrix()}\n`, 'utf8');
writeFileSync(join(DOCS, 'SCREENSHOT_INVENTORY.md'), `${screenshotInventory()}\n`, 'utf8');
writeFileSync(join(DOCS, 'ENVIRONMENT_REFERENCE_FA.md'), `${environmentAppendix()}\n`, 'utf8');

console.log('reference documents generated:');
console.log(`  DRAGON_CAPABILITY_MATRIX.md   (${inventory.apiRoutes.length} endpoints, ${Object.keys(inventory.roles).length} roles)`);
console.log(`  SCREENSHOT_INVENTORY.md       (${capture.steps.length} figures)`);
console.log(`  ENVIRONMENT_REFERENCE_FA.md   (${inventory.environment.variables.length} variables)`);
