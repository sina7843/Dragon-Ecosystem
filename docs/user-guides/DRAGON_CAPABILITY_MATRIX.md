# DRAGON — ماتریس قابلیت‌ها

> این سند به‌صورت خودکار از کد تولید می‌شود: `npm run guide:build`.
> منبع واقعیت‌ها `SITE_INVENTORY.json` (استخراج‌شده از سورس) و
> `GUIDE_VERIFICATION_MAP.json` (ثبت‌شده از محصول در حال اجرا) است. دستی ویرایش نکنید.

## خلاصه شمارشی

| مورد | تعداد |
|---|---|
| مسیرهای API (نقطه پایانی مشخص) | 291 |
| مسیرهای عمومی بدون نشست | 43 |
| مسیرهای نیازمند نشست | 85 |
| مسیرهای نیازمند مجوز مشخص | 163 |
| مسیرهای رابط کاربری | 63 |
| ناحیه‌های مدیریتی | 20 |
| نقش‌ها | 16 |
| مجوزها | 22 |
| Feature Gateها | 10 |
| متغیرهای محیطی خوانده‌شده | 39 |
| تصویرهای ثبت‌شده | 153 |

## نقش‌ها و مجوزها

| نقش | کد | مجوزها |
|---|---|---|
| مدیر ارشد سامانه | `super_administrator` | همه مجوزها (نقش کنترل‌شده اضطراری) |
| مدیر پلتفرم | `platform_administrator` | admin.access، users.read، users.suspend، roles.read، roles.assign، config.read، config.propose، audit.read |
| اپراتور مالی | `finance_operator` | admin.access، finance.manage، config.propose، audit.read |
| تأییدکننده مالی | `financial_approver` | admin.access، finance.approve، config.approve، audit.read |
| نویسنده محتوا | `content_author` | admin.access، content.write |
| ویراستار محتوا | `content_editor` | admin.access، content.write |
| منتشرکننده محتوا | `content_publisher` | admin.access، content.write، content.publish، games.manage |
| اپراتور پخش زنده | `streaming_operator` | admin.access، stream.manage |
| مدیر تورنمنت | `tournament_administrator` | admin.access، tournament.manage |
| برگزارکننده تورنمنت | `tournament_organizer` | admin.access، tournament.manage |
| مدیر آموزش | `education_manager` | admin.access، education.manage |
| ناظر گفت‌وگوی زنده | `live_chat_moderator` | admin.access، chat.moderate |
| ناظر جامعه | `community_moderator` | admin.access، moderation.manage، chat.moderate |
| اپراتور فروشگاه | `shop_operator` | admin.access، store.manage |
| اپراتور پشتیبانی | `support_operator` | admin.access، support.manage، users.read |
| ممیز امنیتی | `security_auditor` | admin.access، audit.read، audit.export |

> نقش‌هایی که در این جدول نیستند (بازدیدکننده، کاربر عادی، نقش‌های درون‌تیمی)
> هیچ مجوز مدیریتی ندارند. مدل مجوزدهی «رد به‌صورت پیش‌فرض» است.

## مجوز ← نقش‌های دارنده

| مجوز | نقش‌های دارنده |
|---|---|
| `admin.access` | `super_administrator`، `platform_administrator`، `finance_operator`، `financial_approver`، `content_author`، `content_editor`، `content_publisher`، `streaming_operator`، `tournament_administrator`، `tournament_organizer`، `education_manager`، `live_chat_moderator`، `community_moderator`، `shop_operator`، `support_operator`، `security_auditor` |
| `users.read` | `super_administrator`، `platform_administrator`، `support_operator` |
| `users.suspend` | `super_administrator`، `platform_administrator` |
| `roles.read` | `super_administrator`، `platform_administrator` |
| `roles.assign` | `super_administrator`، `platform_administrator` |
| `config.read` | `super_administrator`، `platform_administrator` |
| `config.propose` | `super_administrator`، `platform_administrator`، `finance_operator` |
| `config.approve` | `super_administrator`، `financial_approver` |
| `audit.read` | `super_administrator`، `platform_administrator`، `finance_operator`، `financial_approver`، `security_auditor` |
| `audit.export` | `super_administrator`، `security_auditor` |
| `content.write` | `super_administrator`، `content_author`، `content_editor`، `content_publisher` |
| `content.publish` | `super_administrator`، `content_publisher` |
| `games.manage` | `super_administrator`، `content_publisher` |
| `stream.manage` | `super_administrator`، `streaming_operator` |
| `chat.moderate` | `super_administrator`، `live_chat_moderator`، `community_moderator` |
| `education.manage` | `super_administrator`، `education_manager` |
| `store.manage` | `super_administrator`، `shop_operator` |
| `tournament.manage` | `super_administrator`، `tournament_administrator`، `tournament_organizer` |
| `finance.manage` | `super_administrator`، `finance_operator` |
| `finance.approve` | `super_administrator`، `financial_approver` |
| `moderation.manage` | `super_administrator`، `community_moderator` |
| `support.manage` | `super_administrator`، `support_operator` |

## ناحیه‌های مدیریتی و مجوز نمایش هر کارت

| ناحیه | مسیر | مجوز لازم |
|---|---|---|
| `area-content` | `/admin/content` | `content.write` |
| `area-games` | `/admin/games` | `games.manage` |
| `area-organizer` | `/admin/organizer` | `tournament.manage` |
| `area-tournaments` | `/admin/tournaments` | `tournament.manage` |
| `area-streams` | `/admin/streams` | `stream.manage` |
| `area-chat` | `/admin/chat` | `chat.moderate` |
| `area-prizes` | `/admin/prizes` | `finance.manage` |
| `area-store` | `/admin/store` | `store.manage` |
| `area-orders` | `/admin/orders` | `store.manage` |
| `area-community` | `/admin/community` | `moderation.manage` |
| `area-courses` | `/admin/courses` | `education.manage` |
| `area-users` | `/admin/users` | `users.read` |
| `area-audit` | `/admin/audit` | `audit.read` |
| `area-moderation` | `/admin/moderation` | `moderation.manage` |
| `area-media` | `/admin/media` | `content.publish` |
| `area-configuration` | `/admin/configuration` | `config.read` |
| `area-notifications` | `/admin/notifications` | `support.manage` |
| `area-finance` | `/admin/finance` | `finance.manage` |
| `area-support` | `/admin/support` | `support.manage` |
| `area-operations` | `/admin/operations` | `support.manage` |

> پنهان‌بودن یک کارت مرز امنیتی نیست. سرور همان مجوز را روی هر مسیر و هر
> فراخوانی API مستقل از رابط کاربری بررسی می‌کند.

## Feature Gateها

| تصمیم باز | متغیر محیطی | وضعیت پیش‌فرض |
|---|---|---|
| OD-014 | `STREAM_RIGHTS_POLICY_APPROVED` | بسته (fail-closed) |
| OD-007 | `PAID_TOURNAMENTS_ENABLED` | بسته (fail-closed) |
| OD-015 | `PAID_COURSES_ENABLED` | بسته (fail-closed) |
| OD-017 | `SOCIAL_BLOCKING_ENABLED` | بسته (fail-closed) |
| OD-024 | `MODERATION_APPEALS_ENABLED` | بسته (fail-closed) |
| OD-027 | `PUSH_NOTIFICATIONS_ENABLED` | بسته (fail-closed) |
| OD-019 | `PHYSICAL_FULFILLMENT_ENABLED` | بسته (fail-closed) |
| OD-020 | `ENTITLEMENT_REVOCATION_ENABLED` | بسته (fail-closed) |
| OD-008 | `NOTIFICATIONS_SMS_ENABLED` | بسته (fail-closed) |
| OD-026 | `ANALYTICS_EXTERNAL_ENABLED` | بسته (fail-closed) |

> ارائه‌دهنده پخش زنده در کد به `stub` تثبیت شده است و
> مقدار `arvan` عمداً رد می‌شود.

## قابلیت‌ها به تفکیک ماژول

### مدیریت، نقش‌ها، ممیزی و پیکربندی (`admin`)

- فصل راهنما: 19
- تعداد نقطه پایانی: 15
- مجوزهای مورد استفاده: `admin.access`، `users.read`، `roles.read`، `roles.assign`، `config.read`، `config.propose`، `config.approve`، `audit.read`، `audit.export`، `users.suspend`
- ناحیه مدیریتی: `/admin/content`
- مسیرهای رابط کاربری مرتبط: 23
- محدودیت مهم: تخصیص نقش فقط از طریق API محافظت‌شده؛ رابط کاربری ندارد.
- تصویرها: `030-admin-overview-en-desktop.png`، `030-admin-overview-fa-desktop.png`، `030-admin-overview-fa-mobile.png`، `031-admin-users-en-desktop.png`، `031-admin-users-fa-desktop.png`، `031-admin-users-fa-mobile.png` …

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| GET | `/api/v1/admin/audit` | نیازمند مجوز | `audit.read` |
| GET | `/api/v1/admin/audit/emergency` | نیازمند مجوز | `audit.read` |
| POST | `/api/v1/admin/audit/export` | نیازمند مجوز | `audit.export` |
| GET | `/api/v1/admin/capabilities` | نیازمند مجوز | `admin.access` |
| GET | `/api/v1/admin/configuration` | نیازمند مجوز | `config.read` |
| POST | `/api/v1/admin/configuration` | نیازمند مجوز | `config.propose` |
| POST | `/api/v1/admin/configuration/:id/approve` | نیازمند مجوز | `config.approve` |
| GET | `/api/v1/admin/configuration/:key` | نیازمند مجوز | `config.read` |
| POST | `/api/v1/admin/roles/:assignmentId/revoke` | نیازمند مجوز | `roles.assign` |
| GET | `/api/v1/admin/users` | نیازمند مجوز | `users.read` |
| POST | `/api/v1/admin/users/:id/reactivate` | نیازمند مجوز | `users.suspend` |
| GET | `/api/v1/admin/users/:id/roles` | نیازمند مجوز | `roles.read` |
| POST | `/api/v1/admin/users/:id/roles` | نیازمند مجوز | `roles.assign` |
| POST | `/api/v1/admin/users/:id/suspend` | نیازمند مجوز | `users.suspend` |
| POST | `/api/v1/dev/grant-role` | عمومی | — |

### گفت‌وگوی زنده و تعدیل آن (`chat`)

- فصل راهنما: 13
- تعداد نقطه پایانی: 13
- مجوزهای مورد استفاده: `chat.moderate`
- ناحیه مدیریتی: `/admin/chat`
- مسیرهای رابط کاربری مرتبط: 1
- تصویرها: `052-admin-chat-en-desktop.png`، `052-admin-chat-fa-desktop.png`، `052-admin-chat-fa-mobile.png`

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| GET | `/api/v1/admin/chat/messages/:id` | نیازمند مجوز | `chat.moderate` |
| POST | `/api/v1/admin/chat/rooms` | نیازمند مجوز | `chat.moderate` |
| GET | `/api/v1/admin/chat/rooms` | نیازمند مجوز | `chat.moderate` |
| GET | `/api/v1/admin/chat/rooms/:id/messages` | نیازمند مجوز | `chat.moderate` |
| POST | `/api/v1/admin/chat/rooms/:id/messages/:mid/remove` | نیازمند مجوز | `chat.moderate` |
| GET | `/api/v1/admin/chat/rooms/:id/restrictions` | نیازمند مجوز | `chat.moderate` |
| POST | `/api/v1/admin/chat/rooms/:id/restrictions/:mid/lift` | نیازمند مجوز | `chat.moderate` |
| POST | `/api/v1/admin/chat/rooms/:id/state` | نیازمند مجوز | `chat.moderate` |
| POST | `/api/v1/admin/chat/users/:id/bans` | نیازمند مجوز | `chat.moderate` |
| POST | `/api/v1/admin/chat/users/:id/timeouts` | نیازمند مجوز | `chat.moderate` |
| POST | `/api/v1/chat/messages/:id/reports` | نیازمند ورود | — |
| GET | `/api/v1/streams/:id/chat/messages` | عمومی | — |
| POST | `/api/v1/streams/:id/chat/messages` | نیازمند ورود | — |

### پرداخت و تسویه سبد (`checkout`)

- فصل راهنما: 16
- تعداد نقطه پایانی: 8
- مجوزهای مورد استفاده: `finance.manage`
- ناحیه مدیریتی: ندارد
- مسیرهای رابط کاربری مرتبط: 1
- محدودیت مهم: ارائه‌دهنده پرداخت در این نسخه شبیه‌سازی‌شده است.
- تصویرها: `023-account-wallet-en-desktop.png`، `023-account-wallet-fa-desktop.png`، `023-account-wallet-fa-mobile.png`

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| POST | `/api/v1/admin/checkouts/expire` | نیازمند مجوز | `finance.manage` |
| POST | `/api/v1/checkout/mock/pay` | نیازمند ورود | — |
| POST | `/api/v1/checkout/provider/callback` | عمومی | — |
| GET | `/api/v1/checkouts` | نیازمند ورود | — |
| GET | `/api/v1/checkouts/:id` | نیازمند ورود | — |
| POST | `/api/v1/checkouts/:id/cancel` | نیازمند ورود | — |
| POST | `/api/v1/checkouts/:id/confirm` | نیازمند ورود | — |
| POST | `/api/v1/tournaments/:id/checkout` | نیازمند ورود | — |

### رقابت، جدول و نتایج (`competitions`)

- فصل راهنما: 9
- تعداد نقطه پایانی: 16
- مجوزهای مورد استفاده: `tournament.manage`
- ناحیه مدیریتی: ندارد
- مسیرهای رابط کاربری مرتبط: 0
- تصویرها: `026-account-registrations-en-desktop.png`، `026-account-registrations-fa-desktop.png`، `026-account-registrations-fa-mobile.png`، `027-account-matches-en-desktop.png`، `027-account-matches-fa-desktop.png`، `027-account-matches-fa-mobile.png`

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| POST | `/api/v1/admin/tournaments/:id/competition` | نیازمند مجوز | `tournament.manage` |
| GET | `/api/v1/admin/tournaments/:id/competition` | نیازمند مجوز | `tournament.manage` |
| POST | `/api/v1/admin/tournaments/:id/competition/lock` | نیازمند مجوز | `tournament.manage` |
| POST | `/api/v1/admin/tournaments/:id/competition/recalculate` | نیازمند مجوز | `tournament.manage` |
| POST | `/api/v1/admin/tournaments/:id/competition/regenerate` | نیازمند مجوز | `tournament.manage` |
| POST | `/api/v1/admin/tournaments/:id/competition/regenerate/preview` | نیازمند مجوز | `tournament.manage` |
| POST | `/api/v1/admin/tournaments/:id/competition/rollback` | نیازمند مجوز | `tournament.manage` |
| POST | `/api/v1/admin/tournaments/:id/competition/swiss-round` | نیازمند مجوز | `tournament.manage` |
| GET | `/api/v1/admin/tournaments/:id/competition/versions` | نیازمند مجوز | `tournament.manage` |
| POST | `/api/v1/admin/tournaments/:id/matches/:mid/correct` | نیازمند مجوز | `tournament.manage` |
| POST | `/api/v1/admin/tournaments/:id/matches/:mid/result` | نیازمند مجوز | `tournament.manage` |
| PATCH | `/api/v1/admin/tournaments/:id/matches/:mid/schedule` | نیازمند مجوز | `tournament.manage` |
| GET | `/api/v1/admin/tournaments/:id/matches/:mid/schedule` | نیازمند مجوز | `tournament.manage` |
| GET | `/api/v1/me/matches` | نیازمند ورود | — |
| GET | `/api/v1/tournaments/:id/bracket` | عمومی | — |
| GET | `/api/v1/tournaments/:id/standings` | عمومی | — |

### محتوا و اخبار (`content`)

- فصل راهنما: 7
- تعداد نقطه پایانی: 12
- مجوزهای مورد استفاده: `content.write`
- ناحیه مدیریتی: `/admin/content`
- مسیرهای رابط کاربری مرتبط: 3
- تصویرها: `003-games-en-desktop.png`، `003-games-fa-desktop.png`، `003-games-fa-mobile.png`، `004-content-en-desktop.png`، `004-content-fa-desktop.png`، `004-content-fa-mobile.png` …

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| GET | `/api/v1/admin/content` | نیازمند مجوز | `content.write` |
| POST | `/api/v1/admin/content` | نیازمند مجوز | `content.write` |
| POST | `/api/v1/admin/content-taxonomy/categories` | نیازمند مجوز | `content.write` |
| POST | `/api/v1/admin/content-taxonomy/tags` | نیازمند مجوز | `content.write` |
| GET | `/api/v1/admin/content/:id` | نیازمند مجوز | `content.write` |
| PUT | `/api/v1/admin/content/:id` | نیازمند مجوز | `content.write` |
| GET | `/api/v1/admin/content/:id/revisions` | نیازمند مجوز | `content.write` |
| POST | `/api/v1/admin/content/:id/transition` | نیازمند مجوز | `content.write` |
| GET | `/api/v1/content` | عمومی | — |
| GET | `/api/v1/content-taxonomy/categories` | عمومی | — |
| GET | `/api/v1/content-taxonomy/tags` | عمومی | — |
| GET | `/api/v1/content/:type/:slug` | عمومی | — |

### دراگون‌کوین، انتقال و پاداش (`economy`)

- فصل راهنما: 17
- تعداد نقطه پایانی: 11
- مجوزهای مورد استفاده: `finance.manage`، `finance.approve`
- ناحیه مدیریتی: ندارد
- مسیرهای رابط کاربری مرتبط: 0
- محدودیت مهم: برداشت نقدی وجود ندارد.
- تصویرها: `070-admin-finance-en-desktop.png`، `070-admin-finance-fa-desktop.png`، `070-admin-finance-fa-mobile.png`، `071-admin-prizes-en-desktop.png`، `071-admin-prizes-fa-desktop.png`، `071-admin-prizes-fa-mobile.png`

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| POST | `/api/v1/admin/coin-transfers/:id/approve` | نیازمند مجوز | `finance.approve` |
| POST | `/api/v1/admin/coin-transfers/:id/reject` | نیازمند مجوز | `finance.approve` |
| GET | `/api/v1/admin/coin-transfers/review` | نیازمند مجوز | `finance.manage` |
| GET | `/api/v1/admin/economy/reconciliation` | نیازمند مجوز | `finance.manage` |
| GET | `/api/v1/admin/reward-grants` | نیازمند مجوز | `finance.manage` |
| GET | `/api/v1/admin/reward-rules` | نیازمند مجوز | `finance.manage` |
| POST | `/api/v1/admin/reward-rules` | نیازمند مجوز | `finance.manage` |
| POST | `/api/v1/admin/reward-rules/:id/grants` | نیازمند مجوز | `finance.approve` |
| GET | `/api/v1/economy/config` | عمومی | — |
| POST | `/api/v1/me/coin-transfers` | نیازمند ورود | — |
| GET | `/api/v1/me/coin-transfers` | نیازمند ورود | — |

### آکادمی و دوره‌ها (`education`)

- فصل راهنما: 10 و 11
- تعداد نقطه پایانی: 23
- مجوزهای مورد استفاده: `education.manage`
- ناحیه مدیریتی: ندارد
- مسیرهای رابط کاربری مرتبط: 3
- محدودیت مهم: دوره پولی تا OD-015 غیرفعال است. چرخه: draft ← review ← published.

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| GET | `/api/v1/admin/coaches` | نیازمند مجوز | `education.manage` |
| POST | `/api/v1/admin/coaches` | نیازمند مجوز | `education.manage` |
| POST | `/api/v1/admin/coaches/:id/approval` | نیازمند مجوز | `education.manage` |
| GET | `/api/v1/admin/courses` | نیازمند مجوز | `education.manage` |
| POST | `/api/v1/admin/courses` | نیازمند مجوز | `education.manage` |
| GET | `/api/v1/admin/courses/:id` | نیازمند مجوز | `education.manage` |
| PUT | `/api/v1/admin/courses/:id` | نیازمند مجوز | `education.manage` |
| POST | `/api/v1/admin/courses/:id/lessons` | نیازمند مجوز | `education.manage` |
| POST | `/api/v1/admin/courses/:id/state` | نیازمند مجوز | `education.manage` |
| GET | `/api/v1/admin/courses/config` | نیازمند مجوز | `education.manage` |
| POST | `/api/v1/admin/enrollments/:id/revoke` | نیازمند مجوز | `education.manage` |
| PUT | `/api/v1/admin/lessons/:id` | نیازمند مجوز | `education.manage` |
| POST | `/api/v1/admin/reviews/:id/moderate` | نیازمند مجوز | `education.manage` |
| GET | `/api/v1/coaches/:slug` | عمومی | — |
| GET | `/api/v1/courses` | عمومی | — |
| POST | `/api/v1/courses/:id/enrollments` | نیازمند ورود | — |
| POST | `/api/v1/courses/:id/reviews` | نیازمند ورود | — |
| GET | `/api/v1/courses/:slug` | عمومی | — |
| GET | `/api/v1/me/enrollments` | نیازمند ورود | — |
| GET | `/api/v1/me/enrollments/:id` | نیازمند ورود | — |
| POST | `/api/v1/me/enrollments/:id/activate` | نیازمند ورود | — |
| POST | `/api/v1/me/enrollments/:id/cancel` | نیازمند ورود | — |
| PUT | `/api/v1/me/enrollments/:id/lessons/:lessonId/progress` | نیازمند ورود | — |

### کاتالوگ بازی‌ها (`games`)

- فصل راهنما: 7
- تعداد نقطه پایانی: 7
- مجوزهای مورد استفاده: `games.manage`
- ناحیه مدیریتی: `/admin/games`
- مسیرهای رابط کاربری مرتبط: 3
- تصویرها: `003-games-en-desktop.png`، `003-games-fa-desktop.png`، `003-games-fa-mobile.png`، `004-content-en-desktop.png`، `004-content-fa-desktop.png`، `004-content-fa-mobile.png` …

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| GET | `/api/v1/admin/games` | نیازمند مجوز | `games.manage` |
| POST | `/api/v1/admin/games` | نیازمند مجوز | `games.manage` |
| GET | `/api/v1/admin/games/:id` | نیازمند مجوز | `games.manage` |
| PUT | `/api/v1/admin/games/:id` | نیازمند مجوز | `games.manage` |
| POST | `/api/v1/admin/games/:id/status` | نیازمند مجوز | `games.manage` |
| GET | `/api/v1/games` | عمومی | — |
| GET | `/api/v1/games/:slug` | عمومی | — |

### نگه‌داشت وجه (`holds`)

- فصل راهنما: 17
- تعداد نقطه پایانی: 9
- مجوزهای مورد استفاده: `finance.manage`، `finance.approve`
- ناحیه مدیریتی: ندارد
- مسیرهای رابط کاربری مرتبط: 0
- تصویرها: `070-admin-finance-en-desktop.png`، `070-admin-finance-fa-desktop.png`، `070-admin-finance-fa-mobile.png`، `071-admin-prizes-en-desktop.png`، `071-admin-prizes-fa-desktop.png`، `071-admin-prizes-fa-mobile.png`

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| GET | `/api/v1/admin/holds` | نیازمند مجوز | `finance.manage` |
| POST | `/api/v1/admin/holds` | نیازمند مجوز | `finance.manage` |
| POST | `/api/v1/admin/holds/:id/capture` | نیازمند مجوز | `finance.manage` |
| POST | `/api/v1/admin/holds/:id/release` | نیازمند مجوز | `finance.approve` |
| POST | `/api/v1/admin/holds/expire` | نیازمند مجوز | `finance.manage` |
| POST | `/api/v1/admin/holds/reconciliation` | نیازمند مجوز | `finance.manage` |
| GET | `/api/v1/wallet/holds` | نیازمند ورود | — |
| GET | `/api/v1/wallet/holds/:id` | نیازمند ورود | — |
| GET | `/api/v1/wallet/summary` | نیازمند ورود | — |

### هویت، ورود و حساب کاربری (`identity`)

- فصل راهنما: 5
- تعداد نقطه پایانی: 12
- مجوزهای مورد استفاده: ندارد (عمومی یا فقط نشست)
- ناحیه مدیریتی: ندارد
- مسیرهای رابط کاربری مرتبط: 0
- تصویرها: `020-account-overview-en-desktop.png`، `020-account-overview-fa-desktop.png`، `020-account-overview-fa-mobile.png`، `021-account-profile-en-desktop.png`، `021-account-profile-fa-desktop.png`، `021-account-profile-fa-mobile.png` …

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| GET | `/api/v1/account/profile` | نیازمند ورود | — |
| PUT | `/api/v1/account/profile` | نیازمند ورود | — |
| GET | `/api/v1/account/security-events` | نیازمند ورود | — |
| GET | `/api/v1/account/sessions` | نیازمند ورود | — |
| POST | `/api/v1/account/sessions/revoke-others` | نیازمند ورود | — |
| POST | `/api/v1/auth/logout` | عمومی | — |
| POST | `/api/v1/auth/otp/request` | عمومی | — |
| POST | `/api/v1/auth/otp/verify` | عمومی | — |
| GET | `/api/v1/auth/session` | عمومی | — |
| GET | `/api/v1/dev/sms-inbox` | عمومی | — |
| GET | `/api/v1/players` | عمومی | — |
| GET | `/api/v1/players/:username` | عمومی | — |

### رسانه و بارگذاری (`media`)

- فصل راهنما: 21
- تعداد نقطه پایانی: 7
- مجوزهای مورد استفاده: `content.publish`
- ناحیه مدیریتی: `/admin/media`
- مسیرهای رابط کاربری مرتبط: 1
- تصویرها: `037-admin-media-en-desktop.png`، `037-admin-media-fa-desktop.png`، `037-admin-media-fa-mobile.png`

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| POST | `/api/v1/admin/media` | نیازمند مجوز | `content.publish` |
| GET | `/api/v1/admin/media` | نیازمند مجوز | `content.publish` |
| GET | `/api/v1/admin/media/:id` | نیازمند مجوز | `content.publish` |
| DELETE | `/api/v1/admin/media/:id` | نیازمند مجوز | `content.publish` |
| POST | `/api/v1/admin/media/:id/alt` | نیازمند مجوز | `content.publish` |
| POST | `/api/v1/admin/media/:id/publish` | نیازمند مجوز | `content.publish` |
| POST | `/api/v1/media` | نیازمند ورود | — |

### تعدیل، پشتیبانی و بازیابی حساب (`moderation`)

- فصل راهنما: 18 و 19
- تعداد نقطه پایانی: 17
- مجوزهای مورد استفاده: `moderation.manage`، `support.manage`
- ناحیه مدیریتی: `/admin/moderation`
- مسیرهای رابط کاربری مرتبط: 1
- محدودیت مهم: اعتراض به تصمیم تعدیل تا OD-024 غیرفعال است.

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| GET | `/api/v1/admin/moderation/cases` | نیازمند مجوز | `moderation.manage` |
| GET | `/api/v1/admin/moderation/cases/:id` | نیازمند مجوز | `moderation.manage` |
| POST | `/api/v1/admin/moderation/cases/:id/act` | نیازمند مجوز | `moderation.manage` |
| POST | `/api/v1/admin/moderation/cases/:id/assign` | نیازمند مجوز | `moderation.manage` |
| POST | `/api/v1/admin/moderation/cases/:id/emergency` | نیازمند مجوز | `moderation.manage` |
| POST | `/api/v1/admin/moderation/cases/:id/severity` | نیازمند مجوز | `moderation.manage` |
| POST | `/api/v1/admin/recovery` | نیازمند مجوز | `support.manage` |
| GET | `/api/v1/admin/recovery` | نیازمند مجوز | `support.manage` |
| POST | `/api/v1/admin/recovery/:id/review` | نیازمند مجوز | `support.manage` |
| GET | `/api/v1/admin/support/cases` | نیازمند مجوز | `support.manage` |
| POST | `/api/v1/admin/support/cases/:id/assign` | نیازمند مجوز | `support.manage` |
| POST | `/api/v1/admin/support/cases/:id/close` | نیازمند مجوز | `support.manage` |
| POST | `/api/v1/admin/support/cases/:id/resolve` | نیازمند مجوز | `support.manage` |
| POST | `/api/v1/reports` | نیازمند ورود | — |
| POST | `/api/v1/support/cases` | نیازمند ورود | — |
| GET | `/api/v1/support/cases` | نیازمند ورود | — |
| GET | `/api/v1/support/cases/:id` | نیازمند ورود | — |

### اعلان‌ها (`notifications`)

- فصل راهنما: 20
- تعداد نقطه پایانی: 12
- مجوزهای مورد استفاده: `support.manage`
- ناحیه مدیریتی: `/admin/notifications`
- مسیرهای رابط کاربری مرتبط: 2
- محدودیت مهم: پیامک و ایمیل تا OD-008 و OD-003 غیرفعال است؛ اعلان فوری تا OD-027.
- تصویرها: `024-account-notifications-en-desktop.png`، `024-account-notifications-fa-desktop.png`، `024-account-notifications-fa-mobile.png`، `083-admin-notifications-en-desktop.png`، `083-admin-notifications-fa-desktop.png`، `083-admin-notifications-fa-mobile.png`

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| GET | `/api/v1/admin/notification-deliveries` | نیازمند مجوز | `support.manage` |
| GET | `/api/v1/admin/notification-templates` | نیازمند مجوز | `support.manage` |
| POST | `/api/v1/admin/notification-templates` | نیازمند مجوز | `support.manage` |
| POST | `/api/v1/admin/notification-templates/:id/approve` | نیازمند مجوز | `support.manage` |
| POST | `/api/v1/admin/notification-templates/enable` | نیازمند مجوز | `support.manage` |
| POST | `/api/v1/admin/notifications/process` | نیازمند مجوز | `support.manage` |
| GET | `/api/v1/notifications` | نیازمند ورود | — |
| POST | `/api/v1/notifications/:id/read` | نیازمند ورود | — |
| GET | `/api/v1/notifications/preferences` | نیازمند ورود | — |
| PUT | `/api/v1/notifications/preferences` | نیازمند ورود | — |
| POST | `/api/v1/notifications/read-all` | نیازمند ورود | — |
| GET | `/api/v1/notifications/unread-count` | نیازمند ورود | — |

### عملیات، سلامت و سنجه‌ها (`operations`)

- فصل راهنما: 19 و 22
- تعداد نقطه پایانی: 8
- مجوزهای مورد استفاده: `support.manage`
- ناحیه مدیریتی: `/admin/operations`
- مسیرهای رابط کاربری مرتبط: 1

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| GET | `/api/v1/admin/ops/alerts` | نیازمند مجوز | `support.manage` |
| POST | `/api/v1/admin/ops/alerts/:id/acknowledge` | نیازمند مجوز | `support.manage` |
| POST | `/api/v1/admin/ops/health-check` | نیازمند مجوز | `support.manage` |
| GET | `/api/v1/admin/ops/jobs` | نیازمند مجوز | `support.manage` |
| GET | `/api/v1/admin/ops/metrics` | نیازمند مجوز | `support.manage` |
| POST | `/api/v1/admin/ops/run-jobs` | نیازمند مجوز | `support.manage` |
| GET | `/api/v1/admin/ops/stuck-reservations` | نیازمند مجوز | `support.manage` |
| POST | `/api/v1/analytics/events` | نیازمند ورود | — |

### درگاه پرداخت (`payments`)

- فصل راهنما: 16
- تعداد نقطه پایانی: 8
- مجوزهای مورد استفاده: `finance.approve`
- ناحیه مدیریتی: ندارد
- مسیرهای رابط کاربری مرتبط: 0
- محدودیت مهم: فقط ارائه‌دهنده آزمایشی؛ پرداخت واقعی پیکربندی نشده است.
- تصویرها: `023-account-wallet-en-desktop.png`، `023-account-wallet-fa-desktop.png`، `023-account-wallet-fa-mobile.png`

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| POST | `/api/v1/payments/admin/purchases/:id/correct` | نیازمند مجوز | `finance.approve` |
| GET | `/api/v1/payments/balance` | نیازمند ورود | — |
| POST | `/api/v1/payments/mock/pay` | نیازمند ورود | — |
| GET | `/api/v1/payments/packages` | نیازمند ورود | — |
| POST | `/api/v1/payments/provider/callback` | عمومی | — |
| POST | `/api/v1/payments/purchases` | نیازمند ورود | — |
| GET | `/api/v1/payments/purchases` | نیازمند ورود | — |
| GET | `/api/v1/payments/purchases/:id` | نیازمند ورود | — |

### جوایز و تسویه (`prizes`)

- فصل راهنما: 17
- تعداد نقطه پایانی: 14
- مجوزهای مورد استفاده: `finance.manage`، `finance.approve`
- ناحیه مدیریتی: `/admin/prizes`
- مسیرهای رابط کاربری مرتبط: 1
- تصویرها: `070-admin-finance-en-desktop.png`، `070-admin-finance-fa-desktop.png`، `070-admin-finance-fa-mobile.png`، `071-admin-prizes-en-desktop.png`، `071-admin-prizes-fa-desktop.png`، `071-admin-prizes-fa-mobile.png`

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| GET | `/api/v1/admin/entitlements` | نیازمند مجوز | `finance.manage` |
| POST | `/api/v1/admin/entitlements/:id/approve` | نیازمند مجوز | `finance.manage` |
| POST | `/api/v1/admin/entitlements/:id/cancel` | نیازمند مجوز | `finance.approve` |
| POST | `/api/v1/admin/entitlements/:id/fail` | نیازمند مجوز | `finance.manage` |
| POST | `/api/v1/admin/entitlements/:id/pay` | نیازمند مجوز | `finance.approve` |
| POST | `/api/v1/admin/entitlements/:id/processing` | نیازمند مجوز | `finance.approve` |
| POST | `/api/v1/admin/entitlements/:id/retry` | نیازمند مجوز | `finance.manage` |
| POST | `/api/v1/admin/entitlements/:id/reverse` | نیازمند مجوز | `finance.approve` |
| POST | `/api/v1/admin/entitlements/:id/review` | نیازمند مجوز | `finance.manage` |
| POST | `/api/v1/admin/entitlements/:id/verify-recipient` | نیازمند مجوز | `finance.manage` |
| GET | `/api/v1/admin/finance/reconciliation` | نیازمند مجوز | `finance.manage` |
| GET | `/api/v1/admin/tournaments/:id/entitlements` | نیازمند مجوز | `finance.manage` |
| POST | `/api/v1/admin/tournaments/:id/prizes/allocate` | نیازمند مجوز | `finance.manage` |
| GET | `/api/v1/wallet/entitlements` | نیازمند ورود | — |

### ثبت‌نام و تأیید (`registrations`)

- فصل راهنما: 9
- تعداد نقطه پایانی: 13
- مجوزهای مورد استفاده: `tournament.manage`
- ناحیه مدیریتی: ندارد
- مسیرهای رابط کاربری مرتبط: 2
- تصویرها: `026-account-registrations-en-desktop.png`، `026-account-registrations-fa-desktop.png`، `026-account-registrations-fa-mobile.png`، `027-account-matches-en-desktop.png`، `027-account-matches-fa-desktop.png`، `027-account-matches-fa-mobile.png`

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| POST | `/api/v1/admin/registration-counts` | نیازمند مجوز | `tournament.manage` |
| GET | `/api/v1/admin/tournaments/:id/registrations` | نیازمند مجوز | `tournament.manage` |
| POST | `/api/v1/admin/tournaments/:id/registrations/:rid/approve` | نیازمند مجوز | `tournament.manage` |
| POST | `/api/v1/admin/tournaments/:id/registrations/:rid/cancel` | نیازمند مجوز | `tournament.manage` |
| POST | `/api/v1/admin/tournaments/:id/registrations/:rid/promote` | نیازمند مجوز | `tournament.manage` |
| POST | `/api/v1/admin/tournaments/:id/registrations/:rid/reject` | نیازمند مجوز | `tournament.manage` |
| POST | `/api/v1/admin/tournaments/:id/registrations/:rid/waitlist` | نیازمند مجوز | `tournament.manage` |
| GET | `/api/v1/me/tournament-registrations` | نیازمند ورود | — |
| GET | `/api/v1/me/tournament-registrations/:id` | نیازمند ورود | — |
| GET | `/api/v1/tournaments/:id/participants` | عمومی | — |
| POST | `/api/v1/tournaments/:id/registration` | نیازمند ورود | — |
| GET | `/api/v1/tournaments/:id/registration/me` | نیازمند ورود | — |
| POST | `/api/v1/tournaments/:id/registration/withdraw` | نیازمند ورود | — |

### نمایه‌سازی و نقشه سایت (`seo`)

- فصل راهنما: 22
- تعداد نقطه پایانی: 2
- مجوزهای مورد استفاده: ندارد (عمومی یا فقط نشست)
- ناحیه مدیریتی: ندارد
- مسیرهای رابط کاربری مرتبط: 0

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| GET | `/api/v1/robots.txt` | عمومی | — |
| GET | `/api/v1/sitemap.xml` | عمومی | — |

### جامعه کاربری (`social`)

- فصل راهنما: 14
- تعداد نقطه پایانی: 19
- مجوزهای مورد استفاده: `moderation.manage`
- ناحیه مدیریتی: ندارد
- مسیرهای رابط کاربری مرتبط: 0
- محدودیت مهم: مسدودسازی و بی‌صداکردن تا OD-017 غیرفعال است.
- تصویرها: `008-community-en-desktop.png`، `008-community-fa-desktop.png`، `008-community-fa-mobile.png`، `081-admin-community-en-desktop.png`، `081-admin-community-fa-desktop.png`، `081-admin-community-fa-mobile.png`

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| POST | `/api/v1/admin/community/comments/:id/remove` | نیازمند مجوز | `moderation.manage` |
| GET | `/api/v1/admin/community/posts` | نیازمند مجوز | `moderation.manage` |
| POST | `/api/v1/admin/community/posts/:id/remove` | نیازمند مجوز | `moderation.manage` |
| POST | `/api/v1/comments/:id/remove` | نیازمند ورود | — |
| GET | `/api/v1/feed` | نیازمند ورود | — |
| POST | `/api/v1/follows/:targetType/:targetId` | نیازمند ورود | — |
| DELETE | `/api/v1/follows/:targetType/:targetId` | نیازمند ورود | — |
| GET | `/api/v1/me/following` | نیازمند ورود | — |
| PUT | `/api/v1/me/social-profile` | نیازمند ورود | — |
| POST | `/api/v1/posts` | نیازمند ورود | — |
| GET | `/api/v1/posts/:id` | عمومی | — |
| POST | `/api/v1/posts/:id/comments` | نیازمند ورود | — |
| POST | `/api/v1/posts/:id/remove` | نیازمند ورود | — |
| PUT | `/api/v1/reactions/:targetType/:targetId` | نیازمند ورود | — |
| DELETE | `/api/v1/reactions/:targetType/:targetId` | نیازمند ورود | — |
| GET | `/api/v1/social/config` | عمومی | — |
| GET | `/api/v1/social/profiles/:id` | عمومی | — |
| GET | `/api/v1/social/profiles/by-username/:username` | عمومی | — |
| POST | `/api/v1/social/reports` | نیازمند ورود | — |

### فروشگاه و سفارش‌ها (`store`)

- فصل راهنما: 15
- تعداد نقطه پایانی: 19
- مجوزهای مورد استفاده: `store.manage`
- ناحیه مدیریتی: `/admin/store`
- مسیرهای رابط کاربری مرتبط: 3
- محدودیت مهم: ارسال کالای فیزیکی تا OD-019 و ابطال حق دیجیتال تا OD-020 غیرفعال است.
- تصویرها: `009-store-en-desktop.png`، `009-store-fa-desktop.png`، `009-store-fa-mobile.png`، `028-account-orders-en-desktop.png`، `028-account-orders-fa-desktop.png`، `028-account-orders-fa-mobile.png` …

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| POST | `/api/v1/admin/store/discounts` | نیازمند مجوز | `store.manage` |
| POST | `/api/v1/admin/store/fulfillments/:id/state` | نیازمند مجوز | `store.manage` |
| GET | `/api/v1/admin/store/orders` | نیازمند مجوز | `store.manage` |
| GET | `/api/v1/admin/store/orders/:id/fulfillments` | نیازمند مجوز | `store.manage` |
| POST | `/api/v1/admin/store/products` | نیازمند مجوز | `store.manage` |
| POST | `/api/v1/admin/store/products/:id/status` | نیازمند مجوز | `store.manage` |
| POST | `/api/v1/admin/store/products/:id/variants` | نیازمند مجوز | `store.manage` |
| GET | `/api/v1/admin/store/reconciliation` | نیازمند مجوز | `store.manage` |
| POST | `/api/v1/admin/store/variants/:id/inventory` | نیازمند مجوز | `store.manage` |
| GET | `/api/v1/admin/store/variants/:id/inventory` | نیازمند مجوز | `store.manage` |
| GET | `/api/v1/me/cart` | نیازمند ورود | — |
| PATCH | `/api/v1/me/cart` | نیازمند ورود | — |
| GET | `/api/v1/me/entitlements` | نیازمند ورود | — |
| GET | `/api/v1/me/orders` | نیازمند ورود | — |
| GET | `/api/v1/me/orders/:id` | نیازمند ورود | — |
| POST | `/api/v1/orders` | نیازمند ورود | — |
| GET | `/api/v1/products` | عمومی | — |
| GET | `/api/v1/products/:slug` | عمومی | — |
| GET | `/api/v1/store/config` | عمومی | — |

### پخش زنده (`streams`)

- فصل راهنما: 12
- تعداد نقطه پایانی: 13
- مجوزهای مورد استفاده: `stream.manage`
- ناحیه مدیریتی: `/admin/streams`
- مسیرهای رابط کاربری مرتبط: 3
- محدودیت مهم: ارائه‌دهنده «stub» است. OD-013 اتصال ارائه‌دهنده و OD-014 آرشیو و حقوق پخش را مسدود کرده است.
- تصویرها: `006-streams-en-desktop.png`، `006-streams-fa-desktop.png`، `006-streams-fa-mobile.png`، `050-stream-forbidden-en-desktop.png`، `050-stream-forbidden-fa-desktop.png`، `050-stream-forbidden-fa-mobile.png` …

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| GET | `/api/v1/admin/streams` | نیازمند مجوز | `stream.manage` |
| POST | `/api/v1/admin/streams` | نیازمند مجوز | `stream.manage` |
| GET | `/api/v1/admin/streams/:id` | نیازمند مجوز | `stream.manage` |
| PUT | `/api/v1/admin/streams/:id` | نیازمند مجوز | `stream.manage` |
| POST | `/api/v1/admin/streams/:id/provision` | نیازمند مجوز | `stream.manage` |
| POST | `/api/v1/admin/streams/:id/reconcile` | نیازمند مجوز | `stream.manage` |
| POST | `/api/v1/admin/streams/:id/rights` | نیازمند مجوز | `stream.manage` |
| POST | `/api/v1/admin/streams/:id/state` | نیازمند مجوز | `stream.manage` |
| POST | `/api/v1/admin/streams/:id/takedown` | نیازمند مجوز | `stream.manage` |
| GET | `/api/v1/admin/streams/config` | نیازمند مجوز | `stream.manage` |
| GET | `/api/v1/streams` | عمومی | — |
| GET | `/api/v1/streams/:slug` | عمومی | — |
| POST | `/api/v1/streams/:slug/playback-access` | عمومی | — |

### تیم‌ها و عضویت (`teams`)

- فصل راهنما: 6
- تعداد نقطه پایانی: 20
- مجوزهای مورد استفاده: ندارد (عمومی یا فقط نشست)
- ناحیه مدیریتی: ندارد
- مسیرهای رابط کاربری مرتبط: 4
- تصویرها: `010-teams-en-desktop.png`، `010-teams-fa-desktop.png`، `010-teams-fa-mobile.png`، `011-players-en-desktop.png`، `011-players-fa-desktop.png`، `011-players-fa-mobile.png` …

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| GET | `/api/v1/account/gaming-identities` | نیازمند ورود | — |
| PUT | `/api/v1/account/gaming-identities` | نیازمند ورود | — |
| POST | `/api/v1/invitations/:id/accept` | نیازمند ورود | — |
| POST | `/api/v1/invitations/:id/decline` | نیازمند ورود | — |
| GET | `/api/v1/invitations/mine` | نیازمند ورود | — |
| GET | `/api/v1/public/players/:username/gaming-identities` | عمومی | — |
| GET | `/api/v1/public/teams` | عمومی | — |
| GET | `/api/v1/public/teams/:slug` | عمومی | — |
| POST | `/api/v1/teams` | نیازمند ورود | — |
| GET | `/api/v1/teams/:id` | نیازمند ورود | — |
| PUT | `/api/v1/teams/:id` | نیازمند ورود | — |
| POST | `/api/v1/teams/:id/disband` | نیازمند ورود | — |
| POST | `/api/v1/teams/:id/invitations` | نیازمند ورود | — |
| GET | `/api/v1/teams/:id/invitations` | نیازمند ورود | — |
| POST | `/api/v1/teams/:id/leave` | نیازمند ورود | — |
| POST | `/api/v1/teams/:id/members/:accountId/remove` | نیازمند ورود | — |
| PUT | `/api/v1/teams/:id/members/:accountId/role` | نیازمند ورود | — |
| POST | `/api/v1/teams/:id/snapshots` | نیازمند ورود | — |
| POST | `/api/v1/teams/:id/transfer` | نیازمند ورود | — |
| GET | `/api/v1/teams/mine` | نیازمند ورود | — |

### تورنمنت‌ها (`tournaments`)

- فصل راهنما: 8
- تعداد نقطه پایانی: 13
- مجوزهای مورد استفاده: `tournament.manage`
- ناحیه مدیریتی: `/admin/tournaments`
- مسیرهای رابط کاربری مرتبط: 6
- محدودیت مهم: ثبت‌نام پولی تا OD-007 غیرفعال است.
- تصویرها: `005-tournaments-en-desktop.png`، `005-tournaments-fa-desktop.png`، `005-tournaments-fa-mobile.png`، `033-admin-tournaments-en-desktop.png`، `033-admin-tournaments-fa-desktop.png`، `033-admin-tournaments-fa-mobile.png` …

| متد | مسیر | نوع دسترسی | مجوز |
|---|---|---|---|
| GET | `/api/v1/admin/tournaments` | نیازمند مجوز | `tournament.manage` |
| POST | `/api/v1/admin/tournaments` | نیازمند مجوز | `tournament.manage` |
| GET | `/api/v1/admin/tournaments/:id` | نیازمند مجوز | `tournament.manage` |
| PUT | `/api/v1/admin/tournaments/:id` | نیازمند مجوز | `tournament.manage` |
| POST | `/api/v1/admin/tournaments/:id/clone` | نیازمند مجوز | `tournament.manage` |
| POST | `/api/v1/admin/tournaments/:id/participants-visibility` | نیازمند مجوز | `tournament.manage` |
| GET | `/api/v1/admin/tournaments/:id/preview` | نیازمند مجوز | `tournament.manage` |
| GET | `/api/v1/admin/tournaments/:id/revisions` | نیازمند مجوز | `tournament.manage` |
| POST | `/api/v1/admin/tournaments/:id/transition` | نیازمند مجوز | `tournament.manage` |
| GET | `/api/v1/tournament-slugs` | عمومی | — |
| GET | `/api/v1/tournaments` | عمومی | — |
| GET | `/api/v1/tournaments-calendar` | عمومی | — |
| GET | `/api/v1/tournaments/:slug` | عمومی | — |

## مسیرهای رابط کاربری

| مسیر | نما | پوسته | نمایه‌پذیر |
|---|---|---|---|
| `/:locale(fa\|en)` | `HomeView.vue` | public | بله |
| `/:locale(fa\|en)/design-system` | `DesignSystemView.vue` | public | خیر |
| `/:locale(fa\|en)/content` | `ContentListView.vue` | public | بله |
| `/:locale(fa\|en)/content/:type/:slug` | `ContentDetailView.vue` | public | بله |
| `/:locale(fa\|en)/games` | `GamesCatalogView.vue` | public | بله |
| `/:locale(fa\|en)/games/:slug` | `GameDetailView.vue` | public | بله |
| `/:locale(fa\|en)/tournaments` | `TournamentsListView.vue` | public | بله |
| `/:locale(fa\|en)/tournaments-calendar` | `TournamentCalendarView.vue` | public | بله |
| `/:locale(fa\|en)/tournaments/:slug` | `TournamentDetailView.vue` | public | بله |
| `/:locale(fa\|en)/teams` | `TeamsDirectoryView.vue` | public | بله |
| `/:locale(fa\|en)/teams/:slug` | `PublicTeamView.vue` | public | بله |
| `/:locale(fa\|en)/players` | `PlayersDirectoryView.vue` | public | بله |
| `/:locale(fa\|en)/streams` | `StreamsListView.vue` | public | بله |
| `/:locale(fa\|en)/streams/:slug` | `StreamDetailView.vue` | public | بله |
| `/:locale(fa\|en)/academy` | `AcademyCatalogView.vue` | public | بله |
| `/:locale(fa\|en)/academy/courses/:slug` | `CourseDetailView.vue` | public | بله |
| `/:locale(fa\|en)/academy/learn/:enrollmentId` | `CoursePlayerView.vue` | account | خیر |
| `/:locale(fa\|en)/store` | `StoreCatalogView.vue` | public | بله |
| `/:locale(fa\|en)/store/products/:slug` | `StoreProductView.vue` | public | بله |
| `/:locale(fa\|en)/cart` | `CartView.vue` | account | خیر |
| `/:locale(fa\|en)/checkout` | `CheckoutView.vue` | account | خیر |
| `/:locale(fa\|en)/account/orders` | `AccountOrdersView.vue` | account | خیر |
| `/:locale(fa\|en)/account/registrations` | `AccountRegistrationsView.vue` | account | خیر |
| `/:locale(fa\|en)/account/matches` | `AccountMatchesView.vue` | account | خیر |
| `/:locale(fa\|en)/community` | `CommunityFeedView.vue` | public | خیر |
| `/:locale(fa\|en)/community/posts/:id` | `CommunityPostView.vue` | public | خیر |
| `/:locale(fa\|en)/search` | `SearchView.vue` | public | خیر |
| `/:locale(fa\|en)/help` | `HelpView.vue` | public | بله |
| `/:locale(fa\|en)/players/:username` | `PublicPlayerView.vue` | public | بله |
| `/:locale(fa\|en)/auth/mobile` | `AuthMobileView.vue` | public | خیر |
| `/:locale(fa\|en)/account` | `AccountOverviewView.vue` | account | خیر |
| `/:locale(fa\|en)/account/profile` | `AccountProfileView.vue` | account | خیر |
| `/:locale(fa\|en)/account/security` | `AccountSecurityView.vue` | account | خیر |
| `/:locale(fa\|en)/account/wallet` | `AccountWalletView.vue` | account | خیر |
| `/:locale(fa\|en)/account/notifications` | `NotificationsInboxView.vue` | account | خیر |
| `/:locale(fa\|en)/account/teams` | `TeamsView.vue` | account | خیر |
| `/:locale(fa\|en)/account/teams/:id` | `TeamDetailView.vue` | account | خیر |
| `/:locale(fa\|en)/account/gaming-identities` | `GamingIdentitiesView.vue` | account | خیر |
| `/:locale(fa\|en)/admin` | `AdminOverviewView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/users` | `AdminUsersView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/audit` | `AdminAuditView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/moderation` | `AdminModerationView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/courses` | `AdminCoursesView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/chat` | `AdminChatView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/streams` | `AdminStreamsView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/prizes` | `AdminPrizesView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/store` | `AdminStoreView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/orders` | `AdminOrdersView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/community` | `AdminCommunityView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/media` | `AdminMediaView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/configuration` | `AdminConfigurationView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/notifications` | `AdminNotificationsView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/organizer` | `OrganizerWorkspaceView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/finance` | `AdminFinanceView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/support` | `AdminSupportView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/operations` | `AdminOperationsView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/content` | `AdminContentView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/games` | `AdminGamesView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/tournaments` | `AdminTournamentsView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/tournaments/:id/registrations` | `AdminTournamentRegistrationsView.vue` | admin | خیر |
| `/:locale(fa\|en)/admin/tournaments/:id/competition` | `AdminTournamentCompetitionView.vue` | admin | خیر |
| `/:locale(fa\|en)/403` | `ForbiddenView.vue` | public | خیر |
| `/:pathMatch(.*)*` | `NotFoundView.vue` | public | خیر |

