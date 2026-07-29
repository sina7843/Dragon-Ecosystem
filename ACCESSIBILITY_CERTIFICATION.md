# Accessibility Certification Checklist

**Status: Engineering preparation complete — Authorized human certification pending.**

Prepared by DRAGON-28 on 2026-07-29. This document exists so that an authorized human
tester can certify the product against a concrete list. It records what automation already
covers and what only a person can confirm.

No tester identity, date, screen-reader result, approval, or signature appears in this
document, and none may be added by engineering. A model-generated checklist is not a
certification.

## How to read the columns

- **Automated** — asserted by a test in this repository, named in the row. Automation
  proves the attribute exists; it does not prove the experience works.
- **Human** — requires a person, and cannot be closed by engineering.

## Representative routes

Certification should cover at least one route per audience:

| Audience | Route |
|---|---|
| Anonymous | `/{locale}` home, `/{locale}/tournaments`, `/{locale}/store` |
| Authenticated user | `/{locale}/account/wallet`, `/{locale}/cart`, `/{locale}/checkout`, `/{locale}/community` |
| Scoped operator | `/{locale}/admin/store`, `/{locale}/admin/community` |
| Administrator | `/{locale}/admin/moderation`, `/{locale}/admin/prizes`, `/{locale}/admin/orders` |

Each in **Persian RTL** and **English LTR**, at **320px** and **desktop**.

## Checklist

| # | Criterion | Automated | Human verification required |
|---|---|---|---|
| 1 | Keyboard-only navigation reaches every interactive control | Partial — `shell.spec.ts` asserts table pagination is keyboard-operable | Yes — full traversal of each representative route |
| 2 | Skip link moves focus to the main region | Yes — `shell.spec.ts` "the skip link moves focus to the main region" | Confirm it is announced and visible on focus |
| 3 | Focus order follows reading order | No | Yes — including RTL, where visual and DOM order can diverge |
| 4 | Focus indicator is always visible | No — contrast of the indicator is not asserted | Yes, in light and dark themes |
| 5 | Modal traps focus and restores it to the invoker | Yes — `shell.spec.ts` "the dialog traps focus and restores it to the invoker on close" | Confirm with a screen reader |
| 6 | Every control has an accessible name | Partial — `store.spec.ts`, `economy.spec.ts`, `community.spec.ts` assert `label[for]` on composer, transfer, and search controls | Yes — remaining controls, and quality of the names |
| 7 | Form errors are announced and associated with the field | Yes — `accessibility.spec.ts` "an invalid form submission announces an error summary and marks the field invalid" | Confirm the announcement is actually heard |
| 8 | Live regions announce async state without stealing focus | Partial — toasts use `role="status"`/`role="alert"` | Yes |
| 9 | Tables expose a caption and header scope | Yes — `store.spec.ts` asserts the cart table caption; `shell.spec.ts` asserts a caption | Yes — header association read correctly |
| 10 | Persian RTL layout is correct and readable | Partial — `dir="rtl"` asserted on every locale-specific browser test | Yes — visual and reading-order review by a Persian reader |
| 11 | English LTR layout is correct | Partial — `dir="ltr"` asserted | Yes |
| 12 | Mixed-direction usernames and identifiers render safely | Partial — `dir="auto"` on user-generated bodies (`community`, `chat`, `store`); `bdi` on usernames | Yes — Persian display name beside a Latin username, and the reverse |
| 13 | 320px reflow with no horizontal scrolling | Yes — `shell.spec.ts` "never scrolls horizontally, including at the 320px floor"; whole suite runs a 320px project | Yes — usability, not just absence of overflow |
| 14 | 200% browser zoom remains usable | No | Yes |
| 15 | Contrast in light and dark themes | Partial — `design-system` token tests assert token pairs exist | Yes — measured contrast ratios on real surfaces |
| 16 | Reduced-motion preference respected | No | Yes |
| 17 | Screen-reader pass (NVDA/JAWS/VoiceOver) | **Not possible in automation** | Yes — the core of certification |
| 18 | No raw localization key reaches a rendered page | Yes — every browser suite asserts a raw-key pattern; `locales.test.ts` asserts every literal `t()` key resolves in both locales | No |
| 19 | Gated and forbidden states are understandable, not blank | Partial — `store.spec.ts`, `community.spec.ts`, `economy.spec.ts` assert the refusal states render | Yes — clarity of wording |
| 20 | Financial figures are unambiguous (total vs held vs available) | Partial — asserted present in `wallet.spec.ts` | Yes — comprehension, including Persian numerals |

## What automation cannot close

Rows 3, 4, 14, 15, 16, and 17 have no automated coverage and are the substance of a real
certification. Rows marked *Partial* prove an attribute exists but not that the experience
is usable — a `label[for]` can point at a useless name, and a `dir` attribute can be
correct while the reading order is not.

## Standard

No WCAG conformance level is claimed. If the authoritative requirements name a target
level, certification should be performed against it; this checklist does not set one,
because engineering has no authority to.

## Sign-off

**Authorized human certification: PENDING.**

To be completed by an authorized accessibility reviewer. Engineering must not fill this in.

| Field | Value |
|---|---|
| Tester | *(pending)* |
| Date | *(pending)* |
| Assistive technology used | *(pending)* |
| Result | *(pending)* |
| Signature / authorization reference | *(pending)* |
