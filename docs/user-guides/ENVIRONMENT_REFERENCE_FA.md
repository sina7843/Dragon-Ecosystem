# ضمیمه متغیرهای محیطی

> تولید خودکار از پیکربندی برنامه. هیچ مقدار واقعی از فایل‌های محلی خوانده یا چاپ نمی‌شود.

| متغیر | نوع | Feature Gate | حاضر در `.env.example` |
|---|---|---|---|
| `ANALYTICS_EXTERNAL_ENABLED` | غیرمحرمانه | OD-026 | بله |
| `ANALYTICS_PSEUDONYM_SALT` | غیرمحرمانه | — | بله |
| `AUTH_SECRET` | محرمانه | — | بله |
| `ENABLE_DEV_ROUTES` | غیرمحرمانه | — | بله |
| `ENTITLEMENT_REVOCATION_ENABLED` | غیرمحرمانه | OD-020 | بله |
| `HOST` | غیرمحرمانه | — | بله |
| `KAVENEGAR_API_KEY` | محرمانه | — | بله |
| `KAVENEGAR_OTP_TEMPLATE` | غیرمحرمانه | — | بله |
| `KAVENEGAR_SENDER` | غیرمحرمانه | — | بله |
| `MEDIA_MAX_BYTES` | غیرمحرمانه | — | بله |
| `MODERATION_APPEALS_ENABLED` | غیرمحرمانه | OD-024 | بله |
| `MONGODB_URI` | محرمانه | — | بله |
| `NODE_ENV` | غیرمحرمانه | — | بله |
| `NOTIFICATIONS_EMAIL_ENABLED` | غیرمحرمانه | — | بله |
| `NOTIFICATIONS_SMS_ENABLED` | غیرمحرمانه | OD-008 | بله |
| `OTP_MAX_ATTEMPTS` | غیرمحرمانه | — | بله |
| `OTP_REQUESTS_PER_IP` | غیرمحرمانه | — | بله |
| `OTP_REQUESTS_PER_MOBILE` | غیرمحرمانه | — | بله |
| `OTP_RESEND_SECONDS` | غیرمحرمانه | — | بله |
| `OTP_TTL_SECONDS` | غیرمحرمانه | — | بله |
| `OTP_WINDOW_SECONDS` | غیرمحرمانه | — | بله |
| `PAID_COURSES_ENABLED` | غیرمحرمانه | OD-015 | بله |
| `PAID_TOURNAMENTS_ENABLED` | غیرمحرمانه | OD-007 | بله |
| `PAYMENTS_CALLBACK_SECRET` | محرمانه | — | بله |
| `PAYMENTS_MOCK_ENABLED` | غیرمحرمانه | — | بله |
| `PAYMENTS_PURCHASE_TTL_SECONDS` | غیرمحرمانه | — | بله |
| `PHYSICAL_FULFILLMENT_ENABLED` | غیرمحرمانه | OD-019 | بله |
| `PORT` | غیرمحرمانه | — | بله |
| `PUBLIC_ORIGIN` | غیرمحرمانه | — | بله |
| `PUSH_NOTIFICATIONS_ENABLED` | غیرمحرمانه | OD-027 | بله |
| `RECENT_AUTH_MINUTES` | غیرمحرمانه | — | بله |
| `SESSION_TTL_HOURS` | غیرمحرمانه | — | بله |
| `SMS_PROVIDER` | غیرمحرمانه | — | بله |
| `SOCIAL_BLOCKING_ENABLED` | غیرمحرمانه | OD-017 | بله |
| `STREAMING_PROVIDER` | غیرمحرمانه | — | بله |
| `STREAM_PLAYBACK_TTL_SECONDS` | غیرمحرمانه | — | بله |
| `STREAM_RIGHTS_POLICY_APPROVED` | غیرمحرمانه | OD-014 | بله |
| `STREAM_SECURE_LINK_SECRET` | محرمانه | — | بله |
| `TRUSTED_PROXIES` | غیرمحرمانه | — | **خیر** |

## متغیرهایی که کد می‌خواند اما در `.env.example` نیستند

- `TRUSTED_PROXIES`

این یک شکاف مستندسازی است و در `TRAINING_AND_UX_FINDINGS.md` ثبت شده است.

## متغیرهای `.env.example` که پیکربندی سرور نمی‌خواند

- `API_PROXY_TARGET`
- `MONGODB_TEST_URI`

این‌ها را ابزارهای دیگر (پیش‌نمایش وب و پایگاه‌داده آزمون) مصرف می‌کنند.

