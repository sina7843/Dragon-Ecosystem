# شروع کار Dragon Ecosystem در ویندوز

این بسته کامل است. فایل‌های ZIP قبلی را با آن ترکیب نکنید.

## ترتیب اجرا

### ۱) نصب ابزارها

روی این فایل دوبار کلیک کنید:

```text
01-INSTALL-TOOLS.cmd
```

Git for Windows، Node.js LTS، Claude Code و Docker Desktop بررسی یا نصب می‌شوند. پس از نصب جدید، ترمینال‌ها را ببندید و دوباره باز کنید.

### ۲) آماده‌سازی و ساخت نقطه بازیابی

```text
02-SETUP-PROJECT.cmd
```

این مرحله فقط بررسی نمی‌کند؛ کارهای زیر را نیز انجام می‌دهد:

- Git را در صورت نیاز راه‌اندازی و شاخه اولیه را `main` می‌کند؛
- ایراد تک‌مسیره Git Bash را بدون تبدیل مسیر به حرف `C` اصلاح می‌کند؛
- تست guardrailها و بسته را اجرا می‌کند؛
- پیش از هر تغییر Claude یک **baseline commit** می‌سازد؛
- یک فایل بازیابی در `.dragon-backupsaseline.bundle` می‌سازد؛
- درباره Stop hook سطح کاربر، اشغال پورت 27017 و کمبود فضای درایو سیستم هشدار می‌دهد.

اگر این مرحله baseline commit نسازد، DRAGON-00 را اجرا نکنید.

### ۳) بررسی نهایی

```text
03-CHECK-PACKAGE.cmd
```

باید guardrailها، ابزار کپی UTF-8، sliceها، wrapperها و وجود حداقل یک Git commit را تأیید کند.

### ۴) کپی DRAGON-00

```text
04-COPY-NEXT-PROMPT.cmd
```

این ابزار متن را با UTF-8 می‌خواند؛ خط تیره‌های `–` و متن فارسی خراب نمی‌شوند. بدون آرگومان اولین مورد تیک‌نخورده در `PROJECT_STATUS.md` را کپی می‌کند.

نمونه انتخاب دستی:

```bat
04-COPY-NEXT-PROMPT.cmd 03
04-COPY-NEXT-PROMPT.cmd 09a
```

پرامپت‌های بزرگ `09`، `11`، `16`، `17` و `27` فقط از طریق sliceهای `a`، `b` و `c` اجرا می‌شوند. ابزار اجازه اجرای parent آن‌ها را نمی‌دهد.

### ۵) اجرای Claude Code

```text
05-START-CLAUDE.cmd
```

پرامپت کپی‌شده را Paste کنید و در هر نوبت فقط یک prompt یا slice اجرا کنید.

### ۶) ساخت `.env` محلی، فقط هنگام نیاز

Claude اجازه ساخت یا خواندن `.env` را ندارد. پس از اینکه DRAGON-00 فایل `.env.example` را آماده کرد، خودتان اجرا کنید:

```text
06-CREATE-LOCAL-ENV.cmd
```

## قبل از DRAGON-00

پس از موفقیت ۰۱، ۰۲ و ۰۳، این بررسی کوتاه را داخل Claude Code بفرستید:

```text
Read CLAUDE.md, IMPLEMENTATION_DECISIONS.md, Requirements.md, PROJECT_STATUS.md, and prompts/QUICK_START.md. Confirm that at least one Git commit exists and inspect whether the repository is ready for DRAGON-00. Do not implement anything yet. Report only hard blockers and must-fix-first defects.
```

اگر آماده بود، `04-COPY-NEXT-PROMPT.cmd` را اجرا و DRAGON-00 را Paste کنید.

## ترتیب اجرا

```text
00 → 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08
09a → 09b → 09c
10
11a → 11b → 11c
12 → 13 → 14 → 15
16a → 16b → 16c
17a → 17b → 17c
18 → 19 → 20 → 21 → 22 → 23 → 24 → 25 → 26
27a → 27b → 27c
```

## پایان هر مرحله

۱. `git diff` و خروجی تست‌ها را بررسی کنید.  
۲. فقط وقتی کار آماده commit است، مورد مربوط را در `PROJECT_STATUS.md` تیک بزنید.  
۳. status و پیاده‌سازی را در همان commit نهایی ثبت کنید:

```bat
git add -A
git commit -m "feat: complete DRAGON-00"
```

سپس مرحله بعد را کپی کنید.

## نکات مهم

- MongoDB در Compose از آدرس داخلی `mongo:27017` استفاده می‌کند و پورت 27017 میزبان را publish نمی‌کند؛ بنابراین وجود mongod محلی مانع نیست.
- فایل‌های منبع طراحی مانند `Requirements.md`، `prompts/`، `.claude/` و `tools/` برای Claude فقط خواندنی‌اند.
- Dockerfiles، YAML و entrypointها با LF ثبت می‌شوند تا داخل Linux container خراب نشوند.
- `.dragon-backups` در Git نادیده گرفته می‌شود و Claude اجازه بازنویسی آن را ندارد.
- baseline محلی جای remote خصوصی را کامل نمی‌گیرد؛ پس از شروع، یک remote خصوصی اضافه کنید.
