1. Document Information
Field	Value
Product name	Dragon Ecosystem
Document version	1.0.0
Document status	Implementation baseline with registered open-decision gates
Intended audience	Product managers, designers, architects, software engineers, QA engineers, DevOps engineers, security reviewers, moderators, finance operators, tournament operators, content teams, and implementation agents
Initial release	Phase 1 — Esports News and Tournament Platform
Target end state	Integrated five-phase esports, content, tournament, streaming, education, community, commerce, and platform-economy ecosystem
Initial locales	Persian (fa) and English (en)
Primary jurisdiction	Iran
Hosting direction	Arvan Cloud services
Last updated	2026-07-14
Primary source of truth	This document is the product baseline. Implementation precedence is defined by CLAUDE.md and IMPLEMENTATION_DECISIONS.md: security/verifier controls first, then approved implementation decisions, then the active staged prompt, then this document. Approved product changes MUST update this document and REQUIREMENTS_TRACEABILITY.md.
1.1 Source Information

This document is derived from the supplied Dragon Ecosystem product brief and the subsequent clarification decisions.

The Phase 2 streaming direction also considers official Arvan Cloud documentation. Arvan Cloud currently describes live-streaming, video-on-demand, player, secure-link, and API-based video-management capabilities. The implementation MUST validate the exact contracted features in an Arvan Cloud sandbox before committing production architecture to them.

1.2 Requirement Tags

Every major capability, page, use case, data entity, API group, integration, and acceptance test uses one or more of:

FOUNDATION
PHASE_1
PHASE_2
PHASE_3
PHASE_4
PHASE_5
OPTIONAL
FUTURE
OUT_OF_SCOPE

FOUNDATION means the data or service boundary MUST be introduced early enough to avoid blocking later phases. It does not mean every future-facing feature is active in Phase 1.

1.3 Normative Language

The terms MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are interpreted according to RFC 2119.

2. Executive Summary

Dragon Ecosystem is a unified digital platform for esports content, game discovery, tournament operation, teams, live content, education, community interaction, commerce, payments, Dragon Coin, prizes, and operational administration.

Phase 1 MUST launch as an independently valuable production service containing:

A bilingual public esports and gaming website.
News, articles, announcements, guides, rules, and informational pages.
A game catalog.
Persistent user and player profiles.
Persistent teams with owner and member roles.
Individual and team tournament registration.
Free and paid tournament registration.
Administrator-reviewed registrations and an administrator-managed waitlist.
Single-elimination, double-elimination, round-robin, Swiss, and manual/custom competitions.
Versioned bracket generation, editing, locking, regeneration, rollback, standings, match management, and auditable result correction.
Mobile-number OTP authentication.
Email notifications for verified optional email addresses.
In-app notifications and configurable transactional SMS.
Toman payment foundations, represented internally in Iranian rial integers.
Dragon Coin foundations supporting purchase, awards, rewards, platform spending, gifting, and direct user-to-user transfer, without redemption or sale back to Dragon Ecosystem.
Persian and English localization, first-class RTL behavior, SEO, responsive design, light and dark themes, security, auditability, containerized deployment, and production operations.

Later phases extend the same identity, permissions, content, game, tournament, team, media, notification, moderation, payment, ledger, audit, and administration foundations rather than creating disconnected products.

The expected end result is one coherent ecosystem in which users build persistent gaming identities and move between content, competition, teams, streams, learning, community, shopping, and rewards without maintaining separate accounts or histories.

3. Product Goals
3.1 Goals
ID	Tags	Goal	Measurable success condition
GOAL-001	FOUNDATION, PHASE_1	Launch a production esports content and tournament service.	Authorized staff can publish content and games, publish a tournament, accept paid or free registrations, operate all required formats, enter results, and complete standings without database or code intervention.
GOAL-002	FOUNDATION, PHASE_1	Establish one reusable ecosystem identity.	A single account and stable user ID work across every enabled module, with resource-scoped roles and no duplicate phase-specific user tables.
GOAL-003	PHASE_1	Provide complete competition operations.	Phase 1 passes browser tests for individual and team registration plus single elimination, double elimination, round robin, Swiss, and manual/custom formats.
GOAL-004	FOUNDATION, PHASE_1	Make Persian a first-class market experience.	All launch journeys pass in fa RTL and en LTR with zero visible raw translation keys or missing required user-facing translations.
GOAL-005	FOUNDATION	Preserve operational and financial integrity.	Every high-risk administrative, tournament, payment, Dragon Coin, prize, and payout mutation is authorized, idempotent where applicable, and linked to immutable audit evidence.
GOAL-006	PHASE_2	Add integrated live viewing and moderated chat.	Users can discover scheduled/live streams, watch through an Arvan-hosted player, use moderated chat, and access permitted archives.
GOAL-007	PHASE_3	Add structured free and paid learning.	Users can enroll, obtain entitlement, consume lessons, track progress, and complete courses through the same identity and payment services.
GOAL-008	PHASE_4	Add specialized gaming-community and advanced team capabilities.	Users can follow approved entity types, publish and interact with community content, and use advanced team roles with moderation and privacy controls.
GOAL-009	PHASE_5	Add an auditable platform economy.	Store orders, Toman payments, Dragon Coin, rewards, prizes, payouts, and financial reports reconcile to immutable transaction records.
GOAL-010	FOUNDATION	Maintain evolvability across phases.	API and data-model changes follow the compatibility strategy in Section 5.9 and no Phase 1 table or endpoint requires destructive replacement to enable Phases 2–5.
3.2 Non-Goals
ID	Tags	Non-goal
GOAL-011	OUT_OF_SCOPE	Dragon Ecosystem is not a general-purpose social network unrelated to games or esports.
GOAL-012	OUT_OF_SCOPE	Dragon Coin is not redeemable for cash from Dragon Ecosystem.
GOAL-013	OUT_OF_SCOPE	Phase 1 does not include player check-in or player-initiated result disputes.
GOAL-014	OUT_OF_SCOPE	Phase 1 team management does not include manager, captain, or substitute roles.
GOAL-015	OUT_OF_SCOPE	Phase 2 does not require Dragon Ecosystem to build a native video-ingestion, transcoding, or CDN stack.
GOAL-016	OUT_OF_SCOPE	Phase 3 does not promise accreditation, formal certification, or coach revenue sharing until separately approved.
GOAL-017	OUT_OF_SCOPE	Direct messages and private group chat are not part of approved scope.
GOAL-018	OUT_OF_SCOPE	Phase 5 does not include third-party marketplace vendors.
GOAL-019	OUT_OF_SCOPE	The store does not provide a platform-managed returns workflow under the currently approved operating model.
GOAL-020	OUT_OF_SCOPE	International physical shipping is not included; physical fulfillment is limited to Iran.
4. Assumptions and Decisions
4.1 Confirmed Decisions
ID	Tags	Decision
DEC-001	PHASE_1	Phase 1 includes individual and team tournament registration and all five required competition-format families.
DEC-002	PHASE_1	Authentication uses Iranian mobile number and one-time password.
DEC-003	FOUNDATION	The minimum platform age is 13. No custom guardian-consent workflow is required for users aged 13–17 in the approved product scope; mandatory applicable law always prevails.
DEC-004	FOUNDATION, PHASE_1	Locale is detected from the browser/device and falls back to Persian.
DEC-005	FOUNDATION	Timestamps are stored in UTC and displayed in the user’s selected time zone.
DEC-006	PHASE_1	Tournament registration may use automatic or manual approval, configured per tournament.
DEC-007	PHASE_1	Tournament administrators may define custom eligibility questions.
DEC-008	PHASE_1	Player check-in is not included in Phase 1.
DEC-009	PHASE_1	Player-initiated result disputes are not included in Phase 1.
DEC-010	PHASE_1	Persistent team management begins in Phase 1.
DEC-011	PHASE_1	Phase 1 team roles are owner and member/player.
DEC-012	PHASE_1	Team invitations, ownership transfer, removal, and voluntary departure are required.
DEC-013	PHASE_1	Phase 1 does not enforce roster locking.
DEC-014	PHASE_1	Single elimination, double elimination, round robin, Swiss, and manual/custom formats are required.
DEC-015	PHASE_1	Brackets support automatic generation, manual editing, regeneration, version history, locking, and rollback.
DEC-016	PHASE_1	Competition rules use configurable rule profiles plus publisher/federation-specific profiles where applicable.
DEC-017	PHASE_1	Waitlists are administrator-managed.
DEC-018	PHASE_1	Tournament entry fees may use a mixed combination of Toman and Dragon Coin.
DEC-019	PHASE_1	Refund behavior is configured per tournament from approved policy options.
DEC-020	FOUNDATION, PHASE_1	Toman amounts are stored as Iranian rial integer amounts and displayed in Toman.
DEC-021	FOUNDATION, PHASE_1, PHASE_5	Dragon Coin may be purchased, won, granted as a promotion, or granted administratively with a reason.
DEC-022	FOUNDATION, PHASE_1, PHASE_5	Dragon Coin may be used for tournament fees, store purchases, course purchases, gifts, direct transfers, user-to-user purchases, rewards, and approved cosmetic/platform benefits.
DEC-023	FOUNDATION, PHASE_1, PHASE_5	Dragon Coin trading initially means direct user-to-user coin transfer, not an order-book exchange.
DEC-024	FOUNDATION, PHASE_1, PHASE_5	Dragon Coin cannot be sold or redeemed back to Dragon Ecosystem.
DEC-025	PHASE_1	Email is optional and MUST be verified before email notifications or email-assisted recovery.
DEC-026	PHASE_1	Account recovery may use verified email and support review.
DEC-027	PHASE_1	Tournament administrators choose which approved SMS templates are active.
DEC-028	PHASE_1	Phase 1 notification channels are in-app, transactional SMS, and optional verified email.
DEC-029	PHASE_2	Streaming delivery uses Arvan Cloud rather than a Dragon-built streaming stack.
DEC-030	PHASE_3	Phase 3 courses may be free or paid from launch.
DEC-031	PHASE_5	The store supports physical and digital products.
DEC-032	PHASE_5	Physical shipping is limited to Iran.
DEC-033	PHASE_5	Physical stock quantities are managed inside Dragon Ecosystem.
DEC-034	PHASE_5	No platform-managed return workflow is required under the current approved model.
DEC-035	FOUNDATION	The primary legal and operating jurisdiction is Iran.
DEC-036	FOUNDATION	The platform is deployed using Arvan Cloud services.
DEC-037	FOUNDATION	Expected initial peak concurrency is not confirmed; provisional performance targets apply.
DEC-038	FOUNDATION	Application-managed backups, restore drills, RPO, and RTO are not required in the current approved scope. MongoDB persistence, safe migrations, and restart persistence checks remain required.
DEC-039	FOUNDATION	MongoDB 8.x is the required database for the current implementation. The verifier and approved stack policy override database-neutral wording elsewhere.
DEC-040	PHASE_1	Payment is implemented through a deterministic in-repository mock provider adapter. No live payment-provider integration or outbound payment network call is permitted until a later explicit approval.
DEC-041	PHASE_1	SMS, including OTP and transactional tournament messages, is implemented through a deterministic in-repository mock adapter with a protected development/test inbox and failure simulation. No live SMS provider is required.
DEC-042	FOUNDATION	Users aged 13–17 require no product-specific guardian-consent workflow. The product MUST still use age-appropriate privacy, safety, and notice defaults, and MUST obey mandatory law in every operating jurisdiction.
DEC-043	FOUNDATION	Privacy and legal implementation follows mandatory applicable Iranian law and recognized international privacy and child-rights principles where they do not conflict. The system MUST use data minimization, purpose limitation, privacy-by-default, clear notices, security safeguards, consent controls for nonessential analytics, and authenticated export/deletion workflows. This decision does not assert that one universal global privacy law exists.
DEC-044	FOUNDATION, PHASE_1, PHASE_5	Dragon Coin purchases are final and non-refundable and Dragon Coin cannot be redeemed for cash. Duplicate, fraudulent, or system-error corrections use auditable administrative ledger adjustments, not a user refund workflow.
DEC-045	PHASE_1, PHASE_5	Tournament organizers may configure cash prizes in Toman. Cash prizes create pending prize entitlements and are settled manually by authorized finance staff with immutable audit evidence; no external payout provider is required.
DEC-046	FOUNDATION, PHASE_1	The approved initial maximum tournament size is 1,000 participants for individual events or 1,000 teams for team events. Capacity, pagination, contention, bracket, standings, and load tests MUST cover this limit.
DEC-047	FOUNDATION	The required implementation stack is Docker Compose, Vue 3 + Vite + TypeScript, Node.js LTS + TypeScript, and MongoDB 8.x, with Arvan Cloud as the production hosting direction. Exact Arvan product SKUs and topology are deployment configuration rather than a build blocker.
DEC-048	FOUNDATION	The current delivery strategy uses staged Loop Engineering prompts. Each prompt is a bounded vertical slice and may rely only on artifacts from prompts that have already reached PASSED.
DEC-049	FOUNDATION, PHASE_1, PHASE_5	Dragon Coin is a closed-loop, non-cash platform utility/reward unit, not cryptocurrency, investment, bank deposit, or cash equivalent. Purchase and transfer limits, fraud holds, and manual review are configurable engineering controls; exact accounting presentation remains an internal finance configuration and does not block implementation.
DEC-050	FOUNDATION, PHASE_1, PHASE_5	No general internal Toman wallet is active in the approved scope. Toman is used for exact payment amounts and organizer-defined cash-prize entitlements only; users cannot deposit, hold, transfer, spend, or withdraw a platform Toman balance.
4.2 Conservative Assumptions Requiring Validation
ID	Tags	Assumption	Validation point
ASM-001	FOUNDATION, PHASE_1	Iranian mobile numbers are normalized to E.164-compatible canonical form while displaying local formatting.	Before identity implementation.
ASM-002	FOUNDATION	Users aged 13–17 use the platform without a custom guardian workflow; age-appropriate privacy defaults, clear notices, and mandatory applicable-law overrides still apply.	Revalidate only if jurisdiction, target market, or service model changes.
ASM-003	PHASE_1	Administrator-managed waitlist promotion does not require an expiring user acceptance step.	Before tournament workflow freeze.
ASM-004	PHASE_1	No roster lock means membership may change during registration and competition; every registration and match MUST retain immutable roster snapshots.	Before team-tournament implementation.
ASM-005	PHASE_1	In Phase 1, the team owner represents the team for tournament registration because captain and manager roles are deferred.	Before team registration implementation.
ASM-006	PHASE_1	Dragon Coin is represented in whole integer units with no fractional coin.	Before ledger migration is finalized.
ASM-007	PHASE_1	Mixed Toman/Dragon Coin entry fees use administrator-configured fixed components rather than a user-selected exchange rate.	Before checkout implementation.
ASM-008	PHASE_1	Cash prizes remain pending entitlements until finance settlement; Dragon Coin prizes may be credited automatically after approval.	Before prize workflow implementation.
ASM-009	PHASE_2	Dragon Ecosystem owns stream metadata, schedules, access decisions, chat, and moderation, while Arvan Cloud owns video delivery.	Before Phase 2 architecture approval.
ASM-010	PHASE_2	VOD archive is configurable per stream and depends on rights and Arvan contract capabilities.	Before Phase 2 implementation.
ASM-011	PHASE_2	Stream watch access is configurable as public or authenticated; paid viewing is future scope.	Before Phase 2 implementation.
ASM-012	PHASE_5	“No return workflow” does not remove legally mandatory support or refund handling; legally required cases use support-managed adjustments.	Before commerce launch.
ASM-013	FOUNDATION	No application-level backup or restore objective is part of the current scope; data durability relies on MongoDB persistence and the selected hosting platform.	Revisit only when operations explicitly adds disaster-recovery scope.
ASM-014	FOUNDATION	A modular monolith with strict domain boundaries is acceptable initially, but the requirements do not prohibit service extraction.	During architecture review.
ASM-015	FOUNDATION	Public APIs use versioned HTTPS JSON semantics because browser and external-integration requirements need a stable interface.	During API architecture review.
4.3 Open-Decision Register

No unresolved item may be represented merely as “TBD.” It MUST reference an open-decision ID.

ID	Tags	Decision required	Owner	Required by
OD-003	PHASE_1	Select the transactional email provider.	Operations	Before email-notification testing
OD-006	PHASE_1	Approve the initial game-specific competition-rule profiles.	Tournament operations	Before publishing affected tournaments
OD-007	PHASE_1	Define approved tournament-refund policy templates and which events trigger automatic versus reviewed refunds.	Finance and tournament operations	Before paid tournament launch
OD-008	PHASE_1	Determine which transactional tournament SMS classes are mandatory and which may be disabled by users.	Legal and product	Before SMS launch
OD-013	PHASE_2	Confirm contracted Arvan Cloud live, player, API, secure-link, archive, geographic, analytics, and service-level capabilities.	Streaming operations	Before Phase 2 build
OD-014	PHASE_2	Approve stream-content rights, takedown, archive duration, and geographic access policy.	Legal and content	Before Phase 2 launch
OD-015	PHASE_3	Decide coach onboarding, content ownership, paid-course refund, access revocation, and any coach commercial terms.	Education and legal	Before Phase 3 build
OD-016	PHASE_3	Decide whether quizzes and exercises are required at Phase 3 launch.	Education	Before course-authoring implementation
OD-017	PHASE_4	Approve blocking, muting, appeals, and social-profile privacy defaults.	Trust and safety	Before Phase 4 build
OD-018	FUTURE	Decide whether direct messages or private group chat will ever enter scope.	Product and safety	Before any messaging design
OD-019	PHASE_5	Select physical shipping carriers, service regions within Iran, shipping-price rules, and fulfillment service levels.	Commerce operations	Before Phase 5 build
OD-020	PHASE_5	Confirm digital-product entitlement and revocation rules.	Commerce	Before Phase 5 build
OD-023	FOUNDATION	Define customer-support hours and severity-based response targets.	Support operations	Before public launch
OD-024	PHASE_4	Define moderation-appeal eligibility, window, reviewer separation, and finality.	Trust and safety	Before Phase 4 moderation launch
OD-026	FOUNDATION	Select the product analytics and error-monitoring tools and approve consent requirements.	Product, legal, and operations	Before analytics activation
OD-027	PHASE_4	Select web-push and any future mobile-push provider and supported platforms.	Product and operations	Before push activation
OD-028	PHASE_1	Approve username policy, reserved names, and change frequency.	Product and moderation	Before profile launch
OD-029	PHASE_1	Confirm support evidence required to recover an account when both mobile and email are unavailable.	Security and support	Before support recovery activation
OD-030	PHASE_5	Confirm whether user-to-user Dragon Coin purchases represent only future platform-listed digital goods or other approved transactions.	Product, legal, and finance	Before peer commerce activation
4.4 Known Constraints
CON-001 [FOUNDATION]: All production infrastructure MUST run through approved Arvan Cloud services unless an exception is formally approved.
CON-002 [FOUNDATION]: No monetary calculation may use binary floating-point arithmetic.
CON-003 [FOUNDATION]: Public and administrative interfaces MUST support Persian and English.
CON-004 [FOUNDATION]: Persian interfaces MUST support RTL and mixed-direction content.
CON-005 [PHASE_1]: Tournament formats and rules MUST be data-configurable and versioned.
CON-006 [FOUNDATION]: Administrative access MUST be role-scoped; there is no generic unrestricted administrator role except explicitly controlled super-administrator access.
CON-007 [PHASE_2]: Video delivery is externally provided through Arvan Cloud.
CON-008 [PHASE_5]: Physical shipping is domestic to Iran.
CON-009 [FOUNDATION]: Dragon Coin MUST remain distinguishable from cash-equivalent balances and prize entitlements.
CON-010 [FOUNDATION]: Future modules MUST reuse stable ecosystem identities and shared services.
5. Scope and Roadmap
5.1 Capability-to-Phase Matrix
Capability	Foundation	P1	P2	P3	P4	P5
Identity, OTP, sessions, recovery	Core	Launch	Extend	Extend	Extend	Finance hardening
User/player profile	Core	Basic player identity	Stream identity link	Learning profile	Rich social profile	Commerce/financial profile
Role and resource permissions	Core	Tournament/content/admin roles	Stream/chat roles	Education roles	Team/social roles	Shop/finance roles
Game catalog/configuration	Core	Launch	Stream linkage	Course linkage	Follow/statistics linkage	Product linkage
Editorial CMS/media	Core	Launch	Stream/VOD editorial support	Lesson media	Social media reuse	Product media
Persistent teams	Core	Owner/member	Stream linkage	Learning linkage	Advanced roles/clans	Commerce/prize linkage
Tournaments/matches/standings	Core	Full required formats	Broadcast linkage	Progress linkage	Statistics/community	Fees/prizes/payouts
Bracket/rule engine	Core	Full required formats	Broadcast overlays	—	Advanced stats	Prize triggers
In-app notifications	Core	Launch	Stream events	Education events	Social expansion	Financial events
SMS	Core	OTP and configured tournament messages	Stream alerts if approved	Course alerts if approved	Campaign expansion	Financial alerts
Email	Core	Optional verified channel	Extend	Extend	Extend	Receipts/statements
Push	Provider-ready	—	Optional web push	Extend	Required expansion	Financial alerts where approved
Streaming/VOD	Adapter-ready	Links only	Launch through Arvan	Lesson video reuse	Channel follows	Paid/restricted future
Live chat	Moderation-ready	—	Launch	—	Shared community moderation	—
Education	Entitlement-ready	—	—	Launch	Social learning links	Paid integration
Social feed	Event-ready	—	—	—	Launch	Commerce activity if approved
Advanced teams/clans	Schema-ready	Basic teams	—	—	Launch	Prize/commerce extensions
Store/orders	Payment-ready	—	—	Course payments only	—	Launch
Payment processing	Shared foundation	Paid tournament subset	—	Paid courses	—	Full commerce
Dragon Coin	Shared ledger	Purchase, entry fees, prizes, transfers if approved	—	Course use	Social reward hooks	Full economy
Wallet/ledger	Shared foundation	Limited payment and coin ledgers	—	Education extension	—	Full wallet
Prize/payout	Schema-ready	Prize definition and pending entitlements	—	—	—	Full settlement
Moderation/support	Core	Accounts/content/tournaments	Chat/streams	Reviews/courses	Social/community	Commerce/financial disputes
Search/discovery	Core	Content/games/tournaments	Streams	Courses/coaches	Users/teams/posts	Products
Analytics/reporting	Core	Content/tournament/operations	Stream/chat	Education	Social	Financial
Audit/configuration	Core	Launch	Extend	Extend	Extend	Separation of duties
5.2 Phase 1 Launch Scope

[FOUNDATION, PHASE_1]

Phase 1 MUST include:

Public home, content, game, tournament, standings, bracket, search, legal, and help areas.
Mobile OTP registration and login.
Optional verified email.
Player profiles with game identifiers.
Persistent teams with owner/member roles and required membership workflows.
Content and media administration.
Game administration.
Individual and team tournament registration.
Custom registration questions.
Automatic/manual approval, capacity, cancellation, withdrawal, rejection, and administrator-managed waitlist.
Free, Toman-paid, Dragon-Coin-paid, and mixed-fee tournaments.
Versioned rules profiles.
Single elimination, double elimination, round robin, Swiss, and manual/custom formats.
Seeding, byes, scheduling, rescheduling, forfeits, no-shows, disqualification, standings, and tiebreak configuration.
Versioned bracket generation, editing, regeneration, locking, rollback, and audit.
Admin/referee result entry and auditable correction.
Prize definitions using configured combinations of Dragon Coin, cash entitlement, internal Toman balance where activated, and product entitlements.
In-app notifications, verified-email notifications, OTP SMS, and administrator-enabled tournament SMS templates.
Limited payment, ledger, Dragon Coin, and refund foundations required by paid tournaments.
Full role-scoped administration, audit, analytics, support, security, localization, SEO, Docker, deployment, and operations requirements.
5.3 Phase 2 Scope

[PHASE_2]

Stream catalog, schedules, channels, streamers, watch pages, game/tournament/match linkage.
Dragon-managed stream metadata and access policy.
Arvan Cloud player embedding and provider integration.
Scheduled, live, ended, cancelled, archived, and failed states.
Configurable VOD archive and highlights.
Live chat, reports, timeout, bans, moderation queue, and operational monitoring.
Stream and channel notifications.
Public or authenticated viewer access.
Paid stream access remains FUTURE unless approved.
5.4 Phase 3 Scope

[PHASE_3]

Academy catalog, courses, lessons, coaches, free/paid enrollment, entitlements, progress, completion, reviews, moderation, and game-specific learning paths.
Lesson content may include video, text, files, and approved quizzes/exercises.
Paid courses reuse payment and ledger services.
Certification, accreditation, and coach payouts are not approved.
5.5 Phase 4 Scope

[PHASE_4]

Rich profiles, follows, feed, posts, comments, reactions, mentions, reports, blocking/muting if approved, and expanded moderation.
Advanced teams/clans with delegated roles, captain, manager, applications, roster history, statistics, and public histories.
Push-notification expansion.
Direct messages remain out of scope unless OD-018 is approved.
5.6 Phase 5 Scope

[PHASE_5]

Physical and digital storefront, cart, checkout, domestic shipping, orders, inventory, discounts, receipts, refunds/reversals where required, and fulfillment.
Full Toman payment and ledger reporting.
Dragon Coin economy extensions.
A general internal Toman wallet is out of scope under DEC-050; Toman remains limited to payment amounts and cash-prize entitlements.
Prize allocation, payout review, settlement, reconciliation, and financial reporting.
Platform-managed return workflows remain out of scope under DEC-034.
5.7 Shared-Service Dependency Map
Shared service	Consumers
Identity and account lifecycle	Every phase and administration area
Authorization and policy evaluation	Every protected API, page, job, and administrative action
User/player profile	Tournaments, teams, streams, education, social, commerce, payouts
Game catalog	Content, tournaments, streams, courses, social discovery, products
Content/media	Public CMS, games, tournaments, streams, courses, products, social posts
Team service	Tournaments, social, streams, statistics, prizes
Tournament/rules engine	Registration, matches, standings, streams, notifications, prizes
Entitlement service	Paid tournaments, paid courses, digital products, restricted media
Payment orchestration	Tournament fees, courses, orders, Dragon Coin purchases
Ledger service	Payments, Toman balances, Dragon Coin, rewards, prizes, refunds, payouts
Notification service	Every domain event and user preference
Moderation/case service	Accounts, content, chat, courses, social, commerce
Search index	Public and authenticated discovery
Event/outbox service	Cross-module processing, retries, notifications, analytics, integrations
Audit service	All security-sensitive, operational, and financial changes
Configuration service	Rule profiles, templates, feature flags, limits, phase activation
Analytics service	Product, operational, tournament, content, stream, education, social, finance
5.8 Phase Dependency Map
FOUNDATION → PHASE_1: identity, permissions, localization, audit, event delivery, media, money representation, and deployment are prerequisites.
PHASE_1 → PHASE_2: games, tournaments, matches, users, media, moderation, notifications, and event infrastructure are required for stream linkage.
PHASE_1 → PHASE_3: users, games, content/media, entitlement, payment, notifications, moderation, and search are required.
PHASE_1 → PHASE_4: user profiles, teams, moderation, notification center, event feed, media, and search are required.
PHASE_1 + PHASE_3 → PHASE_5: payment and entitlement foundations from paid tournaments/courses are reused.
PHASE_1 + PHASE_4 → PHASE_5: persistent identities, teams, reports, and peer interactions are prerequisites for Dragon Coin transfers and user-to-user purchases.
PHASE_5 payouts depend on versioned tournament prize definitions, DEC-045 manual cash settlement, DEC-049 Dragon Coin classification, and DEC-050 prohibition of a general Toman wallet.
5.9 Compatibility Strategy
Public APIs MUST use an explicit major version, beginning with /api/v1.
API changes within a major version MUST be backward-compatible and additive.
Removing or renaming a field MUST use a documented deprecation period and consumer migration.
Database changes MUST use expand-migrate-contract sequencing.
Stable UUID-style public identifiers MUST NOT be reused after deletion.
Human-readable slugs MAY change but MUST NOT be the sole relationship key.
Domain-event envelopes MUST contain event name, event version, event ID, aggregate ID, occurred-at time, producer, correlation ID, causation ID, and payload.
Event consumers MUST ignore unknown additive fields.
State values MUST be treated as extensible; clients MUST handle unknown states through a safe generic display.
Monetary records MUST retain currency/asset code, integer amount, scale, and immutable source transaction.
Rules, brackets, registration answers, rosters, pricing, discounts, and notification templates MUST be versioned or snapshotted.
Localized content MUST use stable translation-group IDs rather than coupling translations by slug.
Provider-specific values MUST remain behind adapters.
Feature activation MUST use server-controlled configuration and authorization, not client-only hiding.
Data migrations MUST be reversible where practical and MUST have predeployment validation, compatibility checks, and an explicit rollback or forward-fix plan.
Read models and search indexes MUST be rebuildable from authoritative records.
5.10 Phase 1 Migration Risks
Risk	Required mitigation
Mobile-only identity later needs additional methods.	Separate account, identity method, verified contact, and credential entities.
Basic team roles later expand.	Use resource-role assignments rather than a fixed role column.
No roster lock may compromise history.	Snapshot rosters at registration, bracket assignment, and match start.
All competition formats ship early.	Use a versioned rules engine; do not hardcode format behavior into pages.
Paid tournaments precede full commerce.	Build shared payment and ledger boundaries, not tournament-specific balance fields.
Toman is displayed while rial is stored.	Use a Money value contract and enforce exact conversion.
Dragon Coin transfers can create fraud and correction complexity.	Use immutable double-entry-style ledger postings, configurable limits, holds, DEC-044 final-sale rules, and DEC-049 closed-loop controls.
Cash and Dragon Coin prizes may be combined.	Model separate prize components and settlement workflows.
Arvan embedding can create provider lock-in.	Use a streaming-provider adapter and provider-neutral stream records.
Administrator-managed waitlists may later become automatic.	Persist queue order, reason, promotion history, and policy type.
Check-in/disputes are deferred.	Reserve additive states and event boundaries without exposing inactive UI.
Unknown scale may cause premature constraints.	Use stateless application services, paginated APIs, asynchronous jobs, and load-test gates.
6. Stakeholders and User Roles

A person MAY hold multiple global and resource-scoped roles. Authorization MUST evaluate both.

6.1 Role Model
ID	Tags	Role	Scope and goals	Permissions and restrictions
ROLE-001	FOUNDATION	Anonymous visitor	Discover public content and offerings.	Read published public resources only.
ROLE-002	FOUNDATION, PHASE_1	Registered user	Maintain an account, preferences, and history.	Access own account; no tournament participation unless player profile requirements are met.
ROLE-003	PHASE_1	Player	Participate in tournaments.	Manage own game identities and registrations subject to rules.
ROLE-004	PHASE_1	Team member	Belong to a Phase 1 team.	View team-private data; cannot administer team unless owner.
ROLE-005	PHASE_1	Team owner	Operate a Phase 1 team.	Invite/remove members, transfer ownership, register team where eligible; cannot bypass tournament rules.
ROLE-006	PHASE_4	Team captain	Competition-focused delegated team role.	Manage approved roster/tournament actions only.
ROLE-007	PHASE_4	Team manager	Advanced team administration.	Manage delegated team settings without ownership transfer unless separately permitted.
ROLE-008	PHASE_1	Tournament organizer	Business owner of assigned tournaments.	Create and manage assigned tournaments subject to approval policy.
ROLE-009	PHASE_1	Tournament administrator	Operate assigned tournaments.	Review registrations, configure brackets, schedule matches, manage results; no unrelated finance access.
ROLE-010	PHASE_1	Referee	Operate assigned matches.	View assigned participants and enter/correct results within granted scope.
ROLE-011	PHASE_2	Viewer	Watch permitted streams.	Access public or authorized streams and chat subject to moderation.
ROLE-012	PHASE_2	Streamer/channel owner	Manage assigned channel identity and schedules.	No global streaming administration.
ROLE-013	PHASE_2	Live-chat moderator	Moderate assigned chat rooms.	Timeout, ban, remove messages, and review reports only in assigned scope.
ROLE-014	PHASE_3	Learner	Enroll and progress through courses.	Access entitled lessons and own progress.
ROLE-015	PHASE_3	Coach/instructor	Own or author assigned educational content.	Cannot publish or change commercial terms without approval.
ROLE-016	PHASE_1	Content author	Draft content.	Cannot publish unless separately assigned publisher role.
ROLE-017	PHASE_1	Content editor	Review and edit content.	Cannot publish unless granted publisher role.
ROLE-018	PHASE_1	Content publisher	Publish, schedule, unpublish, and archive approved content.	Publication actions are audited.
ROLE-019	PHASE_4	Community moderator	Moderate social content and cases.	Cannot alter financial or tournament records.
ROLE-020	FOUNDATION, PHASE_1	Support operator	Handle support and approved account recovery.	Sensitive fields are masked; high-risk recovery needs reason and audit.
ROLE-021	PHASE_5	Shop operator	Manage catalog, inventory, orders, and fulfillment.	Cannot alter ledgers or execute payouts.
ROLE-022	FOUNDATION, PHASE_1, PHASE_5	Finance operator	Review payments, refunds, adjustments, prizes, and payouts.	Cannot publish tournaments or grant own approvals where dual control applies.
ROLE-023	PHASE_3	Education manager	Manage courses, coaches, moderation, and education reports.	No unrelated platform administration.
ROLE-024	PHASE_2	Streaming operator	Manage streams, provider linkage, VOD, and operational failures.	No global user or finance access.
ROLE-025	FOUNDATION, PHASE_1	Product/platform administrator	Manage approved configuration and operational modules.	Access is permission-specific; no implicit finance or super-admin powers.
ROLE-026	FOUNDATION	Super administrator	Emergency platform-level administration.	Strong authentication, restricted assignment, mandatory reason, enhanced audit, and periodic access review required.
ROLE-027	PHASE_5	Financial approver	Approve high-risk adjustments or payouts.	MUST be a different actor from initiator when dual control applies.
ROLE-028	FOUNDATION	Security auditor	Read security and audit evidence.	Read-only; sensitive payload access is separately controlled.
6.2 Role-Permission Principles
Global role assignment MUST NOT imply access to all resources of that type unless explicitly configured.
Tournament, team, channel, course, and moderation roles MUST support resource scope.
A team owner is owner of one team, not every team.
A tournament administrator is assigned to one or more tournaments.
A referee is assigned to specific tournaments or matches.
Financial permissions MUST be separate from content, tournament, and support permissions.
Administrative permission checks MUST be enforced server-side.
Role changes MUST record actor, subject, scope, previous value, new value, reason, and timestamp.
7. Use Cases
7.1 Normalized Use-Case Catalog
ID	Tags	Name	Primary actor	Objective and main flow	Alternatives/failures	Authorization and acceptance
UC-001	PHASE_1	Register by mobile OTP	Visitor	Enter mobile → receive OTP → verify → accept required terms → create account.	Invalid, expired, reused, or rate-limited OTP; existing account logs in.	Only verified OTP creates/authenticates account; duplicate submission creates no duplicate account.
UC-002	PHASE_1	Complete player profile	User	Set username, display name, birth date, locale/time zone, and game identifiers.	Reserved username, duplicate game identity, underage policy failure.	User edits own profile; changes are validated and audited where security-sensitive.
UC-003	PHASE_1	Browse content and games	Visitor	Discover, filter, open, and share published content/game pages.	Empty results, unpublished resource, invalid locale.	Only published localized resources are public and SEO-indexable.
UC-004	PHASE_1	Discover tournament	Visitor/player	Search/filter/sort tournaments and inspect details, rules, fees, prizes, bracket, and standings.	Registration closed, capacity reached, locale missing.	Public data excludes private registration answers and staff notes.
UC-005	PHASE_1	Register individually	Player	Validate eligibility → answer questions → select payment split where configured → pay/submit → receive status.	Payment failure, duplicate registration, capacity reached, waitlist, rejection.	One active registration per participant/tournament unless rule profile permits otherwise.
UC-006	PHASE_1	Create and manage team	Player	Create team → invite members → members accept → owner manages membership or transfers ownership.	Duplicate name, invite expiry, owner departure without transfer.	Only owner manages Phase 1 team; team must always have one owner while active.
UC-007	PHASE_1	Register team	Team owner	Select eligible roster → capture roster snapshot → answer questions → pay/submit.	Ineligible member, duplicate entry, changed roster, capacity/waitlist.	Owner or later authorized role only; snapshot remains immutable.
UC-008	PHASE_1	Review registration	Tournament administrator	Review details/answers/payment → approve, reject, or waitlist → notify user/team.	Conflict from concurrent review; refund may be required.	Transition requires permission and reason for rejection or override.
UC-009	PHASE_1	Promote waitlisted registration	Tournament administrator	Select waitlisted entry → revalidate → promote to pending/approved → notify.	Capacity conflict or failed eligibility/payment.	Queue and promotion history are audited.
UC-010	PHASE_1	Configure competition	Tournament administrator	Select format and rule-profile version → seed → generate bracket/schedule → review → lock.	Incomplete rules, invalid participant count, conflicting schedule.	Cannot activate competition until validation passes and bracket is locked.
UC-011	PHASE_1	Edit or regenerate bracket	Tournament administrator	Clone current version → edit/regenerate → preview impact → provide reason → activate new version.	Active/completed matches conflict; rollback required.	Existing history is never overwritten; all versions remain auditable.
UC-012	PHASE_1	Operate match and result	Referee/admin	Schedule → start/mark ready → enter result/forfeit/no-show → validate → complete → update progression.	Invalid score, concurrent update, correction after progression.	Result changes require reason; downstream recalculation is deterministic and audited.
UC-013	PHASE_1	Purchase Dragon Coin	User	Choose approved package → complete the approved mock Toman payment flow → confirm callback → credit coin ledger.	Failed, expired, duplicate, corrected, or disputed payment.	Credit occurs once only after verified mock success; user-initiated refunds are unavailable under DEC-044 and the closed-loop controls in DEC-049 apply.
UC-014	PHASE_1	Transfer Dragon Coin	User	Enter recipient and amount → review → confirm → debit sender/credit recipient.	Insufficient funds, limits, blocked recipient, duplicate request, risk hold.	Immutable balanced entries; no transfer to self; activation depends on compliance approval.
UC-015	PHASE_1	Publish content	Author/editor/publisher	Draft localized content → review → schedule/publish → distribute metadata/notifications.	Missing translation, invalid media, schedule failure.	Only publisher may publish; missing required locale blocks publication.
UC-016	PHASE_2	Schedule and watch stream	Streaming operator/viewer	Create Dragon stream record → link Arvan resource → schedule → go live → watch player.	Provider failure, cancellation, authorization failure.	Dragon access policy is checked before watch credentials/embed are returned.
UC-017	PHASE_2	Moderate live chat	Moderator	Review message/report → delete, timeout, or ban → notify and audit.	Concurrent action, expired stream, appeal future.	Moderator is limited to assigned chat scope.
UC-018	PHASE_3	Enroll in course	Learner	Discover → obtain free or paid entitlement → enroll → access lessons → track progress.	Payment failure, revoked entitlement, unpublished lesson.	Access requires active entitlement and enrollment.
UC-019	PHASE_4	Follow and interact	User	Follow approved entity → receive feed activities → post/comment/react/report.	Blocked actor, private resource, moderation restriction.	Visibility and safety policy enforced on every read/write.
UC-020	PHASE_5	Purchase product	Customer	Add item → reserve stock → checkout → pay → create entitlement/fulfillment → receipt.	Stock conflict, payment failure, expiry, refund.	Order/payment creation is idempotent; inventory and digital entitlement are consistent.
UC-021	PHASE_5	Settle prize	Finance operator/approver	Confirm winner → allocate components → review → pay/credit/fulfill → reconcile.	Rejected review, failed payout, reversal, manual recovery.	High-risk payout follows separation of duties and immutable ledger/audit records.
UC-022	FOUNDATION	Recover account	User/support	Verify email or complete support review → replace mobile identity → revoke sessions → notify.	Insufficient evidence or suspicious request.	Recovery requires security audit and cannot expose account existence unnecessarily.
UC-023	FOUNDATION	Change platform configuration	Authorized administrator	Validate permission → edit configuration → approve if high risk → publish → emit event.	Conflict, invalid configuration, failed propagation.	Previous and new versions remain available with actor and reason.
UC-024	FOUNDATION	Report abuse	User	Submit report → triage → investigate → action/dismiss → notify where permitted.	Duplicate, malicious report, insufficient evidence.	Reporter and subject data visibility are restricted.
7.2 Detailed Use-Case Contract

For every use case above:

Preconditions MUST be validated server-side.
Every write MUST carry a correlation ID.
Permission failures MUST return 403; unauthenticated access MUST return 401.
Validation failures MUST identify fields without exposing sensitive implementation details.
Idempotent operations MUST accept an idempotency key.
Postconditions MUST be observable through the relevant read API.
Required notifications MUST be recorded even when external delivery fails.
Analytics events MUST NOT replace authoritative transactional records.
8. User Journeys
8.1 Registration to Tournament Completion

JOURNEY-001 [PHASE_1]

User enters through localized public page.
User registers with mobile OTP.
User completes player profile and required game identity.
User discovers a tournament.
System evaluates capacity, eligibility, duplicate registration, and fee configuration.
User answers custom questions.
User pays Toman and/or Dragon Coin where required.
Registration becomes pending_review, approved, or waitlisted.
Administrator reviews where required.
Approved participant appears in competition setup.
Administrator creates and locks bracket/schedule.
Participant views match schedule.
Referee/administrator enters result.
System advances bracket or recalculates standings.
Tournament completes and eligible prizes become pending allocations.
User receives in-app and enabled channel notifications.

Failure recovery MUST cover OTP failure, incomplete profile, payment failure, capacity race, review rejection, schedule change, result correction, and notification-delivery failure.

8.2 Team Registration Journey

JOURNEY-002 [PHASE_1]

Create team → invite members → accept invitations → owner selects roster → eligibility validation → roster snapshot → team registration → payment → review → waitlist/approval → competition assignment → match-specific roster snapshot → history.

No roster lock is enforced, but membership changes MUST NOT rewrite previous registration or match snapshots.

8.3 Tournament Operation Journey

JOURNEY-003 [PHASE_1]

Create draft → select game and rule profile → configure format → publish → open registration → close registration → finalize entrants → seed → generate versioned bracket → review/edit → lock → schedule matches → enter results → advance/recalculate → complete → allocate prizes → archive.

8.4 Stream Journey

JOURNEY-004 [PHASE_2]

Create Dragon stream → link game/tournament/match/channel → provision or associate Arvan resource → schedule → notify followers/participants where enabled → publish watch page → transition live → moderate chat → end → archive if configured → publish VOD/highlights.

8.5 Course Journey

JOURNEY-005 [PHASE_3]

Discover course → view coach and curriculum → obtain free/paid entitlement → enroll → consume lessons → save progress → complete rules → submit review → receive completion notification.

8.6 Social Journey

JOURNEY-006 [PHASE_4]

Discover user/team/game/coach/channel → follow → receive eligible activities → post/comment/react → report abuse if necessary → moderation action → notification or appeal where approved.

8.7 Store Journey

JOURNEY-007 [PHASE_5]

Discover product → select variant → add cart → validate domestic delivery/digital entitlement → reserve inventory → apply discount → pay Toman/Dragon Coin where allowed → confirm order → fulfill/entitle → issue receipt → handle failure or legally required refund.

8.8 Prize-to-Settlement Journey

JOURNEY-008 [PHASE_1, PHASE_5]

Define prize components → complete tournament → confirm winners → generate pending allocations → review eligibility → credit Dragon Coin or internal entitlement → initiate external cash payout/product fulfillment → approve → settle → reconcile → financial audit.

8.9 Abuse-Report Journey

JOURNEY-009 [FOUNDATION, PHASE_2, PHASE_3, PHASE_4]

Report content/chat/course/social behavior → deduplicate → triage severity → assign moderator → preserve evidence → investigate → action/dismiss → notify permitted parties → appeal in phases where approved → close and retain audit.

8.10 Administrative Configuration Journey

JOURNEY-010 [FOUNDATION]

Administrator opens configuration → authorization check → edit draft version → validate → supply reason → obtain second approval for high-risk finance/security configuration → activate → emit event → update dependent service → verify user-facing effect → retain rollback version.

8.11 Critical Browser Journeys

The following MUST have end-to-end browser tests in both locales where applicable:

JOURNEY-001 through JOURNEY-010 for enabled phases.
Mobile OTP registration and returning login.
Language switching with state preservation.
Team invitation and team registration.
Each competition format from setup through result progression.
Bracket edit, lock, regeneration, and rollback.
Paid and free tournament registration.
Dragon Coin purchase and transfer when activated.
Admin content publication.
Stream watch/chat moderation.
Paid/free course enrollment.
Store checkout and fulfillment.
Account recovery and suspension.
Forbidden direct-URL access.
9. Information Architecture
9.1 Public Areas
/
/content
/content/{type}
/content/{type}/{slug}
/games
/games/{slug}
/tournaments
/tournaments/{slug}
/tournaments/{slug}/bracket
/tournaments/{slug}/standings
/streams
/streams/{slug}
/academy
/academy/courses/{slug}
/coaches/{slug}
/community
/teams
/teams/{slug}
/store
/store/products/{slug}
/search
/help
/legal/{document}
/status
/404

Locale MAY be represented by a locale prefix or negotiated routing, but canonical and hreflang behavior MUST be consistent.

9.2 Authenticated Areas
/account/profile
/account/player-identities
/account/security
/account/preferences
/account/notifications
/account/registrations
/account/matches
/account/teams
/account/invitations
/account/courses
/account/orders
/account/wallet
/account/dragon-coin
/account/rewards
/account/prizes
/account/payouts
/account/reports
/account/support
9.3 Administration Areas
/admin/dashboard
/admin/content
/admin/media
/admin/games
/admin/tournaments
/admin/registrations
/admin/brackets
/admin/matches
/admin/teams
/admin/streams
/admin/chat
/admin/courses
/admin/coaches
/admin/community
/admin/moderation
/admin/store
/admin/orders
/admin/payments
/admin/wallets
/admin/dragon-coin
/admin/rewards
/admin/prizes
/admin/payouts
/admin/notifications
/admin/sms
/admin/support
/admin/users
/admin/roles
/admin/configuration
/admin/analytics
/admin/audit
/admin/operations
9.4 Navigation Requirements
Public primary navigation MUST expose only enabled phases.
Authenticated navigation MUST show account status and unread-notification count.
Administrative navigation MUST be generated from effective permissions.
Hidden menu items MUST NOT substitute for authorization.
Mobile navigation MUST use a keyboard-accessible drawer or equivalent.
Breadcrumbs MUST appear on hierarchical content, tournament, course, store, and administration pages.
Current location MUST be programmatically determinable.
Directional icons MUST mirror only when their meaning is directional.
Navigation labels MUST be localized.
10. Page Requirements
10.1 Common Page Contract

Every page below MUST define or inherit:

Page ID, phase tags, route, purpose, and permitted roles.
Required sections, components, displayed data, and actions.
Loading skeleton or progress state.
Meaningful empty state.
Localized validation and error state.
Success confirmation for writes.
Responsive behavior at defined viewport classes.
WCAG 2.2 AA behavior.
Locale and RTL/LTR behavior.
SEO metadata for public indexable pages.
Direct URL refresh behavior.
Authorization behavior.
Acceptance criteria.

Public pages MUST provide title, description, canonical URL, Open Graph fields, locale alternates, and indexability settings unless marked non-indexable.

10.2 Page Catalog
ID	Tags	Route and page	Roles	Key sections/actions	Acceptance criteria
PAGE-001	PHASE_1	/ Home	Public	Hero, featured content, games, tournaments, announcements, phase-enabled modules.	Loads localized published data; no unpublished resource is exposed; responsive and SEO-valid.
PAGE-002	PHASE_1	/content Content hub	Public	Type/category/tag filters, search, sort, pagination.	URL reflects filters; empty/error/loading states work.
PAGE-003	PHASE_1	/content/{type}/{slug} Content detail	Public	Title, cover, body, author, dates, taxonomy, related items, share.	Correct localized version, structured metadata, sanitized content, 404 for unavailable resource.
PAGE-004	PHASE_1	/games Game catalog	Public	Search, filters, cards, pagination.	Only published games appear; filters are stable on refresh.
PAGE-005	PHASE_1	/games/{slug} Game detail	Public	Description, platforms/configuration, related tournaments/content.	Game links resolve correctly across locales.
PAGE-006	PHASE_1	/tournaments Tournament discovery	Public	Search, game/status/format/fee filters, sort, pagination.	Results match query and expose registration state without leaking private data.
PAGE-007	PHASE_1	/tournaments/{slug} Tournament detail	Public/user	Overview, localized rules, eligibility, questions preview, capacity, fees, prizes, schedule, participants, registration CTA.	CTA reflects authentication, profile, capacity, dates, and existing registration.
PAGE-008	PHASE_1	/tournaments/{slug}/register Registration	Player/team owner	Participant type, roster, questions, fee split, policy consent, review, submit.	Duplicate submission protected; server validation mirrors UI; resulting status displayed.
PAGE-009	PHASE_1	/tournaments/{slug}/bracket Bracket	Public	Version, rounds, matches, status, participants, zoom/pan/list fallback.	Locked active version is shown; accessible list representation exists.
PAGE-010	PHASE_1	/tournaments/{slug}/standings Standings	Public	Rank, played, wins/losses/draws, points, tiebreak details.	Values reproduce rule-profile calculations and explain applied tiebreak order.
PAGE-011	PHASE_1	/auth/mobile Mobile authentication	Public	Country/mobile input, OTP request, OTP verification, resend, legal consent.	Rate-limit and expiry states are clear; account enumeration is prevented.
PAGE-012	PHASE_1	/account/profile Profile	User	Public/private fields, avatar, username, birth date, locale/time zone.	Own data only; username and age rules enforced.
PAGE-013	PHASE_1	/account/player-identities Game identities	Player	Add/edit/verify game IDs per game.	Uniqueness and game-specific validation enforced.
PAGE-014	FOUNDATION	/account/security Security	User	Mobile, verified email, sessions, recovery, security events.	Sensitive changes require recent authentication and revoke affected sessions.
PAGE-015	FOUNDATION	/account/preferences Preferences	User	Locale, time zone, theme, privacy, notification defaults.	Changes persist across sessions and devices where applicable.
PAGE-016	PHASE_1	/account/notifications Notifications	User	Unread/all, filters, mark read, target link.	Read state is idempotent and unauthorized targets are not exposed.
PAGE-017	PHASE_1	/account/registrations Registrations	Player/team owner	Status, tournament, participant, payment, reason, cancellation.	Status history and permitted actions are accurate.
PAGE-018	PHASE_1	/account/matches Match schedule	Player/team member	Upcoming/completed matches, tournament, opponent, time, result.	Times use selected time zone; changes are highlighted.
PAGE-019	PHASE_1	/account/teams Teams	User	Owned/member teams, create team, invitations.	Permission-correct actions shown and enforced.
PAGE-020	PHASE_1	/teams/{slug} Team page	Public/member	Identity, members, tournament/match history, owner controls.	Private member data is hidden publicly; historical snapshots remain accurate.
PAGE-021	PHASE_1	/account/dragon-coin Dragon Coin	User	Available/held balance, history, purchase, transfer, restrictions.	Balance reconciles to ledger; no cash-redemption action exists.
PAGE-022	PHASE_1	/search Search	Public/user	Cross-domain search with type filters.	Only authorized and published results appear.
PAGE-023	PHASE_1	/help Help	Public	FAQs, tournament help, support entry points.	Localized and searchable.
PAGE-024	FOUNDATION	/legal/{document} Legal document	Public	Versioned terms/privacy/cookies/rules.	Acceptance-required versions are identifiable and retained.
PAGE-025	FOUNDATION	/status Service status	Public	Current service state and incidents if enabled.	No sensitive infrastructure detail is exposed.
PAGE-026	FOUNDATION	Error pages	Public	401, 403, 404, 409, 429, 500, maintenance.	Correct status, localized recovery action, no stack trace.
PAGE-027	PHASE_2	/streams Stream discovery	Public	Live/scheduled/archive filters, game/channel/tournament filters.	Live state updates without full reload; unavailable provider state is shown.
PAGE-028	PHASE_2	/streams/{slug} Watch page	Public/authorized viewer	Arvan player, metadata, schedule, chat, related tournament, VOD/highlights.	Access is checked server-side before player data is issued.
PAGE-029	PHASE_2	/channels/{slug} Channel page	Public	Identity, schedule, live state, archives, highlights.	Only published permitted media appears.
PAGE-030	PHASE_3	/academy Academy catalog	Public	Course/game/level/free-paid filters and search.	Entitlement state is shown for authenticated users.
PAGE-031	PHASE_3	/academy/courses/{slug} Course detail	Public/user	Coach, curriculum, price, requirements, reviews, enrollment CTA.	Paid/free state and access rules are correct.
PAGE-032	PHASE_3	/academy/learn/{enrollmentId} Course player	Learner	Lesson navigation, media/text/files, progress, exercises if enabled.	Unauthorized lesson access is blocked; progress persists.
PAGE-033	PHASE_3	/coaches/{slug} Coach profile	Public	Bio, games, courses, reviews.	Only approved profile fields are public.
PAGE-034	PHASE_4	/community Community feed	User/public as configured	Feed, composer, filters, moderation state.	Visibility, block/mute, and pagination rules are enforced.
PAGE-035	PHASE_4	/users/{username} Social profile	Public/user	Rich identity, statistics, follows, posts, teams, history.	Privacy fields and safety restrictions are enforced.
PAGE-036	PHASE_4	/posts/{id} Post detail	Authorized viewer	Post, media, comments, reactions, reports.	Deleted/moderated states preserve safe context without leaking content.
PAGE-037	PHASE_5	/store Storefront	Public	Categories, products, filters, availability, search.	Price/availability reflect authoritative catalog.
PAGE-038	PHASE_5	/store/products/{slug} Product detail	Public	Media, variants, stock, digital/physical type, price, add cart.	Cannot add unavailable variant; domestic shipping limitations are clear.
PAGE-039	PHASE_5	/cart Cart	User	Items, quantities, discounts, fee split, totals.	Totals are server-recalculated using integer amounts.
PAGE-040	PHASE_5	/checkout Checkout	User	Delivery, payment, order review, consent.	Duplicate orders/payments are prevented.
PAGE-041	PHASE_5	/account/orders Orders	User	Order states, items, receipt, fulfillment.	User sees only own orders and entitlements.
PAGE-042	PHASE_5	/account/prizes Prizes	User	Pending, approved, settled, failed allocations.	Separate components and settlement evidence are displayed.
PAGE-043	PHASE_5	/account/payouts Payouts	Eligible user	Payout review and status.	No withdrawal capability is shown unless legally activated.
PAGE-044	PHASE_1	/admin/dashboard Admin dashboard	Authorized staff	Role-specific queues, alerts, KPIs, shortcuts.	Data and actions are permission-scoped.
PAGE-045	PHASE_1	/admin/content Content administration	Content roles	List, draft, review, localization, schedule, publish, archive.	Publication requires complete required locales and permission.
PAGE-046	PHASE_1	/admin/games Game administration	Platform admin	CRUD, configuration, localization, publish/archive.	Referenced games cannot be destructively deleted.
PAGE-047	PHASE_1	/admin/tournaments Tournament administration	Tournament staff	Setup, rules, registration, staff, schedule, prizes, publication.	Incomplete competition configuration blocks publication/activation.
PAGE-048	PHASE_1	/admin/registrations Registration queue	Tournament admin	Filter, inspect, approve, reject, waitlist, promote, refund view.	Concurrent decisions return conflict; all decisions audited.
PAGE-049	PHASE_1	/admin/brackets Bracket editor	Tournament admin	Generate, seed, edit, validate, compare, lock, rollback.	Every active change creates a new immutable version.
PAGE-050	PHASE_1	/admin/matches Match operations	Admin/referee	Schedule, assign, state, result, correction.	Invalid transitions blocked; downstream effects previewed.
PAGE-051	PHASE_1	/admin/teams Team administration	Support/tournament admin	Search teams, inspect history, apply authorized action.	Staff action needs permission and reason.
PAGE-052	PHASE_2	/admin/streams Stream operations	Streaming operator	Link/provision provider resource, schedule, monitor, archive.	Provider failures expose recovery action and correlation ID.
PAGE-053	PHASE_2	/admin/chat Chat moderation	Chat moderator	Live messages, reports, timeouts, bans, history.	Scope-limited and audited.
PAGE-054	PHASE_3	/admin/courses Education administration	Education roles	Courses, lessons, coaches, pricing, enrollment, reviews.	Publication/price changes follow permission and version rules.
PAGE-055	PHASE_4	/admin/community Community moderation	Moderator	Reports, content, users, actions, appeals.	Evidence and reason retained.
PAGE-056	PHASE_5	/admin/store Store administration	Shop operator	Products, variants, inventory, discounts.	Inventory changes are auditable.
PAGE-057	PHASE_5	/admin/orders Order operations	Shop/support	Orders, payment/fulfillment status, support adjustments.	Ledger changes cannot be made directly.
PAGE-058	PHASE_1, PHASE_5	/admin/payments Payment operations	Finance	Payment status, callbacks, refunds, reconciliation.	High-risk operations require reason and optional second approval.
PAGE-059	PHASE_1, PHASE_5	/admin/dragon-coin Coin operations	Finance	Ledger, holds, grants, reversals, transfer investigation.	No mutable balance edit; adjustment uses balanced entries.
PAGE-060	PHASE_5	/admin/prizes Prize operations	Tournament/finance	Definitions, allocations, approvals, settlement.	Tournament and finance responsibilities remain separated.
PAGE-061	PHASE_1	/admin/notifications Notification administration	Platform admin	Templates, events, delivery logs, retries.	Templates are localized and versioned.
PAGE-062	PHASE_1	/admin/sms SMS administration	Authorized operator	Approved templates, tournament enablement, deliveries.	Arbitrary unsanitized SMS sending is prohibited.
PAGE-063	FOUNDATION	/admin/users User/support administration	Support/platform admin	Search, status, recovery, suspension, history.	Sensitive fields masked; high-risk action requires reason.
PAGE-064	FOUNDATION	/admin/roles Role administration	Super admin	Assign/revoke scoped roles and review access.	Cannot remove final emergency administrator without safeguard.
PAGE-065	FOUNDATION	/admin/configuration Configuration	Platform admin	Versioned settings, feature flags, rule profiles.	Invalid or unapproved high-risk config cannot activate.
PAGE-066	FOUNDATION	/admin/audit Audit explorer	Auditor/authorized admin	Filter by actor/resource/action/correlation/time.	Logs are read-only and export is permission-controlled.
PAGE-067	FOUNDATION	/admin/operations Operations	Operations	Job failures, dead letters, health, integrations, recovery.	Manual retry is idempotent and audited.
PAGE-068	FOUNDATION	/admin/analytics Reporting	Authorized staff	Domain-specific dashboards and exports.	Reports respect permissions and disclose freshness.
11. Functional Requirements
11.1 Identity and Account
ID	Tags	Requirement	Acceptance criteria
AUTH-001	FOUNDATION, PHASE_1	The system MUST authenticate Phase 1 users with mobile OTP.	Valid unused OTP authenticates once; invalid, expired, or reused OTP does not.
AUTH-002	PHASE_1	OTP requests MUST be rate-limited by mobile, IP, device signal, and account risk.	Excess requests return localized 429 without issuing additional OTPs.
AUTH-003	PHASE_1	OTP values MUST expire and MUST NOT be stored in reversible plaintext.	Security test confirms expiry and nonrecoverable storage.
AUTH-004	FOUNDATION	Accounts MUST have stable IDs independent of mobile number, email, username, or locale.	Changing a contact or username does not change ownership relationships.
AUTH-005	PHASE_1	Optional email MUST be verified before email delivery or email-assisted recovery.	Unverified email cannot receive transactional account content.
AUTH-006	FOUNDATION	Sessions MUST support revocation per session and globally.	User can revoke another session; revoked session fails on next protected request.
AUTH-007	FOUNDATION	Security-sensitive changes MUST require recent authentication.	Stale sessions are challenged before mobile, email, recovery, or payout changes.
AUTH-008	FOUNDATION	Account recovery MUST support verified-email and support-review paths.	Recovery revokes existing sessions and sends security notifications.
AUTH-009	FOUNDATION	Account states MUST use the state machine in Section 12.	Invalid transitions are rejected and audited.
AUTH-010	FOUNDATION	Suspended users MUST be blocked from protected actions while public data remains handled by moderation policy.	Suspended session receives a localized restriction response.
AUTH-011	FOUNDATION	Users MUST be able to request account deletion and data export under DEC-043 and mandatory applicable law.	Request is recorded, authenticated, and trackable.
AUTH-012	FOUNDATION	Account enumeration MUST be prevented in OTP, login, recovery, and email-verification flows.	Equivalent public responses are used for existing and unknown identities.
AUTH-013	FOUNDATION	The platform MUST retain security-event history visible to the user where safe.	User sees login, recovery, contact change, and session revocation events.
AUTH-014	FOUNDATION	Role and resource assignment MUST be separate from account records.	One user can hold multiple scoped roles without duplicated accounts.
11.2 Content and Games
ID	Tags	Requirement	Acceptance criteria
CONTENT-001	PHASE_1	CMS MUST support news, articles, announcements, guides, rules, and static pages.	Authorized staff can create, localize, preview, publish, schedule, unpublish, and archive each type.
CONTENT-002	PHASE_1	Content MUST support categories and tags.	Filtering returns only correctly associated published content.
CONTENT-003	PHASE_1	Editorial content MUST be localized independently from UI strings.	A UI translation release does not modify editorial records.
CONTENT-004	PHASE_1	Publication MUST require complete Persian and English user-facing versions.	Missing required locale blocks publication with actionable validation.
CONTENT-005	PHASE_1	Content bodies MUST be sanitized.	Stored or rendered scripts and unsafe attributes do not execute.
CONTENT-006	PHASE_1	Scheduled publication MUST be asynchronous, idempotent, and observable.	A retry publishes once and records job state.
CONTENT-007	PHASE_1	Content revisions MUST be retained.	Publisher can compare current and prior versions.
CONTENT-008	PHASE_1	Public content MUST support SEO and Open Graph fields.	Metadata appears in rendered document and validation tests.
CONTENT-009	PHASE_1	Media use MUST reference media-library assets.	Deleting a referenced asset is blocked or uses a managed replacement workflow.
CONTENT-010	PHASE_1	Games MUST support localized identity, status, media, configuration, and related resources.	Published game detail links correctly to tournaments and content.
CONTENT-011	FOUNDATION	Game-specific fields MUST use versioned configuration rather than schema changes per game.	New game identity fields can be configured without code migration where practical.
CONTENT-012	FOUNDATION	Archived content and games MUST preserve historical references.	Existing tournament/history links remain resolvable or use explicit archived behavior.
11.3 Tournament and Registration
ID	Tags	Requirement	Acceptance criteria
TOURN-001	PHASE_1	Staff MUST create localized tournament drafts linked to a game.	Draft can be saved without public exposure.
TOURN-002	PHASE_1	Tournament configuration MUST include participant type, capacity, dates, format, rule profile, fee, refund policy, prizes, eligibility, and registration questions.	Publication validation reports each missing mandatory value.
TOURN-003	PHASE_1	Tournaments MUST support individual, team, or separately configured divisions.	Registration UI and validation match configured participant type.
TOURN-004	PHASE_1	Registration approval MUST be automatic or manual per tournament.	Automatic registrations transition without staff review only when all conditions pass.
TOURN-005	PHASE_1	Capacity MUST be enforced transactionally.	Concurrent final-slot submissions do not overbook.
TOURN-006	PHASE_1	Administrator-managed waitlists MUST retain ordered history.	Promotions, removals, and order changes are auditable.
TOURN-007	PHASE_1	Registration MUST support custom questions with versioned answers.	Question changes do not alter submitted answers.
TOURN-008	PHASE_1	Eligibility MUST validate required profile/game identity and configured custom responses.	Ineligible submissions fail with localized reasons.
TOURN-009	PHASE_1	Registration MUST prevent duplicate active entries for the same participant and tournament.	Concurrent duplicates produce one active registration and one conflict.
TOURN-010	PHASE_1	Team registration MUST capture an immutable roster snapshot.	Later membership changes do not alter submitted roster.
TOURN-011	PHASE_1	No roster lock is enforced, but changes MUST trigger eligibility revalidation and visible history.	Staff can compare current roster with snapshots.
TOURN-012	PHASE_1	Paid registration MUST support Toman, Dragon Coin, or fixed mixed components.	Server-calculated fee components equal configured price exactly.
TOURN-013	PHASE_1	Registration submission and payment confirmation MUST be idempotent.	Repeated requests/callbacks produce no duplicate registration or charge.
TOURN-014	PHASE_1	Administrators MUST approve, reject, waitlist, cancel, or promote registrations according to allowed transitions.	Invalid or stale transition returns conflict.
TOURN-015	PHASE_1	Rejection and administrative cancellation MUST require a reason.	Audit record contains reason and actor.
TOURN-016	PHASE_1	User withdrawal MUST be allowed only within configured policy.	Disallowed withdrawal is rejected with policy explanation.
TOURN-017	PHASE_1	Refund handling MUST use the selected approved policy version.	Refund amount and reason are reproducible from snapshot data.
TOURN-018	PHASE_1	Tournament staff and referee assignments MUST be resource-scoped.	Unassigned staff cannot operate the tournament.
TOURN-019	PHASE_1	Match schedules MUST use UTC storage and localized user display.	Same match displays correctly in two selected time zones.
TOURN-020	PHASE_1	Rescheduling MUST record old/new time, actor, reason, and notifications.	Participants receive recorded notification attempts.
TOURN-021	PHASE_1	Results may be entered by assigned referee or tournament administrator.	Unauthorized user receives 403.
TOURN-022	PHASE_1	Result corrections MUST be versioned and require a reason.	Previous result remains queryable in audit history.
TOURN-023	PHASE_1	Phase 1 MUST support forfeit, disqualification, and no-show outcomes.	Outcome applies rule-profile scoring and progression.
TOURN-024	PHASE_1	Phase 1 MUST NOT expose player check-in.	No public/API action enables check-in; reserved states remain inactive.
TOURN-025	PHASE_1	Phase 1 MUST NOT expose player-initiated result disputes.	Player cannot create dispute; support may record general support case.
TOURN-026	FOUNDATION	Tournament, registration, match, bracket, stream, notification, prize, and payout records MUST use stable relationships.	Navigation and audit can traverse linked records.
TOURN-027	PHASE_1	Tournament cancellation MUST trigger configured registration, payment, notification, and prize cleanup workflows.	No active bracket or unhandled paid registration remains.
TOURN-028	PHASE_1	Tournament completion MUST require all required matches and standings to be final.	Incomplete competition cannot transition to completed.
TOURN-029	PHASE_1	Public participant data MUST follow privacy settings and tournament disclosure policy.	Private registration answers never appear publicly.
TOURN-030	PHASE_1	Tournament exports MUST be permission-controlled and localized where applicable.	Export includes generation time, filters, and stable IDs.
11.4 Competition and Brackets
ID	Tags	Requirement	Acceptance criteria
BRACKET-001	PHASE_1	The engine MUST support single elimination.	Generated bracket advances winners according to locked rules.
BRACKET-002	PHASE_1	The engine MUST support double elimination.	Winners/losers progression follows selected versioned rule profile.
BRACKET-003	PHASE_1	The engine MUST support round robin.	Required pairings and standings are generated without duplicates outside configured repeats.
BRACKET-004	PHASE_1	The engine MUST support Swiss.	Pairing uses the selected versioned policy and reports unresolved constraints.
BRACKET-005	PHASE_1	The engine MUST support manual/custom competition.	Staff can define matches and progression without automated bracket assumptions.
BRACKET-006	PHASE_1	Rules MUST be configured through versioned profiles, including publisher/federation profiles where approved.	Tournament references immutable profile version.
BRACKET-007	PHASE_1	Rule profiles MUST define tiebreakers, pairing constraints, rematches, grand-final behavior, byes, scoring, forfeit, no-show, and disqualification behavior as applicable.	Publication/activation is blocked when format-required rules are absent.
BRACKET-008	PHASE_1	Seeding MUST support manual ordering and configured automated inputs.	Seed list is previewable and auditable before generation.
BRACKET-009	PHASE_1	Byes MUST be explicitly represented.	Bye advancement is visible and reproducible.
BRACKET-010	PHASE_1	Every generation, edit, regeneration, or rollback MUST create a new immutable version.	Prior version data remains unchanged.
BRACKET-011	PHASE_1	Bracket edits MUST validate participant uniqueness and progression consistency.	Invalid cycles or duplicate placements are blocked.
BRACKET-012	PHASE_1	Locking MUST prevent direct mutation of an active version.	Further changes require a new draft version.
BRACKET-013	PHASE_1	Regeneration MUST preview destructive effects on scheduled/completed matches.	Operator must explicitly confirm and supply reason.
BRACKET-014	PHASE_1	Rollback MUST activate a prior valid version by creating a new version referencing it.	Rollback never deletes intervening history.
BRACKET-015	PHASE_1	Standings MUST record inputs and calculated outputs.	Recalculation produces identical output for the same rule/profile/input versions.
BRACKET-016	PHASE_1	Result updates MUST trigger deterministic downstream progression or standings recalculation.	Retry does not duplicate matches or points.
BRACKET-017	PHASE_1	Active bracket versions MUST be readable through accessible visual and tabular representations.	Keyboard/screen-reader user can inspect rounds and matches.
BRACKET-018	FOUNDATION	Format-specific implementations MUST conform to a common competition interface.	Adding a future format does not require replacing tournament entities.
11.5 Teams
ID	Tags	Requirement	Acceptance criteria
TEAM-001	PHASE_1	Users MUST create persistent teams with unique normalized identity.	Duplicate conflicting team name/slug is rejected.
TEAM-002	PHASE_1	Phase 1 team roles MUST be owner and member.	Captain/manager/substitute controls are not exposed.
TEAM-003	PHASE_1	An active team MUST have exactly one owner.	Owner cannot leave without ownership transfer or disbanding.
TEAM-004	PHASE_1	Owners MUST invite users.	Invitation has status, expiry, inviter, and audit history.
TEAM-005	PHASE_1	Invitees MUST accept or decline.	Acceptance is idempotent and creates one membership.
TEAM-006	PHASE_1	Owners MUST remove members; members MUST leave voluntarily.	Historical membership is retained.
TEAM-007	PHASE_1	Owners MUST transfer ownership to an active member.	Transfer is atomic and audited.
TEAM-008	PHASE_1	Team deletion MUST use disbanding/archival rather than destructive removal.	Tournament history remains intact.
TEAM-009	PHASE_1	Team tournament registration MUST be performed by the owner in Phase 1.	Member-only user receives 403.
TEAM-010	PHASE_1	Team and membership histories MUST retain effective dates.	Historical roster query reproduces membership at a given time.
TEAM-011	PHASE_4	Advanced roles and membership applications MUST extend the same team model.	Migration does not replace Phase 1 team IDs.
TEAM-012	FOUNDATION	Team permissions MUST use resource-scoped role grants.	Advanced delegation can be added without a fixed team-role column rewrite.
11.6 Streaming and Chat
ID	Tags	Requirement	Acceptance criteria
STREAM-001	PHASE_2	Dragon MUST own stream metadata, schedules, relationships, access policy, and lifecycle state.	Provider replacement does not change public stream IDs.
STREAM-002	PHASE_2	Video delivery MUST use an Arvan Cloud provider adapter.	No provider secret or raw management credential reaches the browser.
STREAM-003	PHASE_2	Stream states MUST include draft, scheduled, live, ended, cancelled, archived, and failed.	Only allowed transitions succeed.
STREAM-004	PHASE_2	Streams MUST link to zero or more games, tournaments, matches, channels, or streamers.	Related pages resolve bidirectionally.
STREAM-005	PHASE_2	Watch access MUST support public or authenticated modes.	Unauthorized viewer cannot obtain playable access data.
STREAM-006	PHASE_2	Arvan embed/player configuration MUST be issued only after Dragon access validation.	Direct API test cannot bypass Dragon policy.
STREAM-007	PHASE_2	Provider provisioning and synchronization MUST be idempotent.	Retry creates no duplicate provider channel/stream.
STREAM-008	PHASE_2	Provider failure MUST produce user-visible unavailable/retry state and operator alert.	Failure includes correlation ID and does not expose secrets.
STREAM-009	PHASE_2	VOD archive MUST be configurable per stream and rights policy.	Disabled archive creates no public VOD; enabled archive is tracked through processing states.
STREAM-010	PHASE_2	Highlights MUST reference source stream/VOD and rights state.	Removing source access applies configured highlight policy.
STREAM-011	PHASE_2	Stream schedule changes MUST trigger enabled notifications.	Delivery attempts are recorded.
STREAM-012	PHASE_2	Stream analytics MUST distinguish Dragon page views from provider playback metrics.	Reports disclose metric source and freshness.
CHAT-001	PHASE_2	Each live chat room MUST be linked to a stream and moderation scope.	Unlinked or unauthorized rooms cannot accept messages.
CHAT-002	PHASE_2	Messages MUST support send, display, remove, report, and moderation metadata.	Removed message is no longer delivered to ordinary viewers.
CHAT-003	PHASE_2	Sending MUST be rate-limited and abuse-protected.	Flood attempts receive controlled rejection.
CHAT-004	PHASE_2	Moderators MUST apply timeout and ban actions with duration/reason.	Restricted user cannot send during effective period.
CHAT-005	PHASE_2	Message reports MUST create moderation cases with preserved evidence.	Deleting a public message does not delete case evidence.
CHAT-006	PHASE_2	Chat delivery MAY be at-least-once, but clients MUST deduplicate by message ID.	Duplicate delivery renders once.
CHAT-007	PHASE_2	Chat content MUST be sanitized and direction-aware.	Unsafe markup does not execute; mixed-script text remains readable.
CHAT-008	PHASE_2	Private direct messaging MUST NOT be implemented.	No private-message endpoint or UI is shipped.
11.7 Education
ID	Tags	Requirement	Acceptance criteria
EDU-001	PHASE_3	Education managers MUST create localized courses linked to games and coaches.	Draft course is not publicly accessible.
EDU-002	PHASE_3	Courses MUST support free and paid access.	Enrollment obtains correct entitlement path.
EDU-003	PHASE_3	Lessons MUST support text, video, files, and approved exercise types.	Unsupported type is rejected.
EDU-004	PHASE_3	Lesson ordering and prerequisite rules MUST be explicit.	Learner cannot access locked lesson unless rule permits.
EDU-005	PHASE_3	Enrollment MUST have a state machine and entitlement link.	Revoked/refunded entitlement blocks future access according to policy.
EDU-006	PHASE_3	Progress MUST be recorded per learner and lesson.	Refresh/device change preserves progress.
EDU-007	PHASE_3	Completion MUST use configured measurable rules.	Same progress inputs produce same completion result.
EDU-008	PHASE_3	Reviews MUST require eligible enrollment and moderation.	Ineligible user cannot review.
EDU-009	PHASE_3	Course publication MUST validate localized curriculum, access model, and ownership.	Missing requirements block publication.
EDU-010	PHASE_3	Paid-course checkout MUST reuse shared payment, entitlement, and ledger services.	No education-specific mutable payment balance exists.
EDU-011	PHASE_3	Coach profiles MUST expose only approved public fields.	Private contact/payment data is never public.
EDU-012	OUT_OF_SCOPE	Certification, accreditation, and coach payout MUST remain disabled until approved.	No user-facing promise or payout endpoint exists.
11.8 Social and Advanced Community
ID	Tags	Requirement	Acceptance criteria
SOCIAL-001	PHASE_4	Users MUST have rich social profiles extending the Phase 1 profile.	Existing profile IDs and URLs remain valid.
SOCIAL-002	PHASE_4	Following MUST support approved entity types.	Duplicate follow is idempotent.
SOCIAL-003	PHASE_4	Feed generation MUST enforce current visibility and block/mute rules.	Unauthorized activity never appears.
SOCIAL-004	PHASE_4	Users MUST create localized-direction-aware posts with approved media.	Content is sanitized and upload policy enforced.
SOCIAL-005	PHASE_4	Comments and reactions MUST use stable IDs and moderation states.	Removed content displays approved tombstone behavior.
SOCIAL-006	PHASE_4	Mentions MUST notify only visible and eligible recipients.	Blocked user cannot force a notification.
SOCIAL-007	PHASE_4	Reports MUST enter the shared moderation system.	Report is traceable to subject and evidence.
SOCIAL-008	PHASE_4	Blocking and muting MUST remain behind OD-017 until approved.	Feature flag prevents partial activation.
SOCIAL-009	PHASE_4	Advanced teams MUST add captain/manager/delegated permissions without replacing team records.	Phase 1 team history remains intact.
SOCIAL-010	PHASE_4	Public player/team statistics MUST identify source and calculation period.	Displayed number can be reproduced from authoritative records.
SOCIAL-011	PHASE_4	Social notifications MUST respect per-channel preferences.	Disabled preference prevents channel delivery.
SOCIAL-012	OUT_OF_SCOPE	Private direct messages and private group chat MUST remain absent.	No hidden or undocumented messaging feature exists.
11.9 Commerce, Payments, Wallet, Rewards, and Payouts
ID	Tags	Requirement	Acceptance criteria
COMMERCE-001	PHASE_5	Catalog MUST support physical and digital products, categories, variants, localized content, and media.	Each sellable variant has valid type, status, and price.
COMMERCE-002	PHASE_5	Physical variants MUST use internal stock quantities.	Concurrent checkout cannot oversell available stock.
COMMERCE-003	PHASE_5	Shipping addresses MUST be limited to configured Iranian regions.	Unsupported destination is rejected before payment.
COMMERCE-004	PHASE_5	Cart totals MUST be recalculated server-side.	Manipulated client price is ignored.
COMMERCE-005	PHASE_5	Discounts MUST be versioned and validated for period, audience, product, and usage limits.	Invalid coupon produces no price change.
COMMERCE-006	PHASE_5	Checkout MUST create one order per idempotency key.	Retry returns original order.
COMMERCE-007	PHASE_5	Digital products MUST create entitlements only after successful payment.	Failed payment creates no active entitlement.
COMMERCE-008	PHASE_5	Physical fulfillment MUST track internal operational states.	Staff can identify pending, packed, shipped, delivered, cancelled, and failed orders.
COMMERCE-009	PHASE_5	Receipts/invoices MUST display exact rial/Toman representation and Dragon Coin components.	Sum of line items, discounts, fees, and totals reconciles.
COMMERCE-010	PHASE_5	Platform-managed returns UI MUST NOT be shipped under current scope.	No customer return workflow is exposed.
COMMERCE-011	PHASE_5	Legally required support adjustments MUST use support/finance workflows.	Adjustment records actor, reason, authorization, and ledger effect.
COMMERCE-012	PHASE_5	Orders MUST retain price, tax-policy, discount, address, and product snapshots.	Later catalog changes do not alter historical order.
COMMERCE-013	PHASE_5	Inventory adjustments MUST be auditable.	Each adjustment has source, amount, actor, and resulting quantity.
COMMERCE-014	PHASE_5	Search and filters MUST distinguish physical/digital and availability.	Results accurately reflect sellable status.
PAY-001	FOUNDATION, PHASE_1	All fiat amounts MUST be stored as signed/unsigned integer Iranian rial values as appropriate.	No payment code or schema uses binary floating point.
PAY-002	FOUNDATION, PHASE_1	User-facing Toman values MUST convert exactly at 10 rial per Toman.	Round-trip tests preserve valid amounts.
PAY-003	FOUNDATION, PHASE_1	Payment creation MUST require an idempotency key.	Duplicate request returns same payment intent.
PAY-004	FOUNDATION, PHASE_1	Provider callbacks MUST be authenticated according to provider capability and idempotently processed.	Duplicate callback changes state once.
PAY-005	FOUNDATION	Payment states MUST include pending, successful, failed, cancelled, expired, reversed, refunded, disputed, and manual review where relevant.	State-machine tests cover allowed and rejected transitions.
PAY-006	FOUNDATION	Successful business fulfillment MUST occur only after authoritative payment success.	Client redirect alone cannot mark payment successful.
PAY-007	FOUNDATION	Refunds MUST reference original payment and policy/reason.	Refund amount cannot exceed eligible unreversed amount.
PAY-008	FOUNDATION	Reconciliation MUST compare provider records, payments, orders/registrations, and ledger entries.	Differences appear in finance report.
PAY-009	FOUNDATION	Administrative payment adjustments MUST require permission, reason, and immutable audit.	No direct mutable status edit exists.
PAY-010	FOUNDATION	Provider timeouts MUST produce pending/unknown state rather than assumed failure or success.	Recovery job resolves or escalates unknown transaction.
PAY-011	FOUNDATION	Payment logs MUST redact credentials and unnecessary personal data.	Security test finds no provider secret in logs.
PAY-012	FOUNDATION	Paid features in the current build MUST use the approved deterministic mock payment adapter. Live payment-provider configuration and outbound provider calls MUST remain disabled until separately approved.	Feature flags prevent accidental live-provider activation while full mock checkout and callback journeys remain testable.
WALLET-001	FOUNDATION	Cash, Dragon Coin, rewards, pending prizes, and completed payouts MUST be separate assets/accounts.	Query cannot combine them into one ambiguous balance.
WALLET-002	FOUNDATION	Balances MUST be derived from or reconciled to immutable ledger entries.	Rebuild reproduces displayed balance.
WALLET-003	FOUNDATION	Ledger postings MUST be balanced according to the asset-specific accounting model.	Unbalanced transaction is rejected.
WALLET-004	FOUNDATION	Ledger entries MUST be immutable after posting.	Correction creates reversing/adjusting entries.
WALLET-005	FOUNDATION	Wallet operations MUST be idempotent.	Retry creates one posting set.
WALLET-006	FOUNDATION	Holds MUST be supported for pending fees, transfers, refunds, or risk review.	Available and held balances are separately visible.
WALLET-007	FOUNDATION	Negative available balance MUST be prohibited unless a specifically authorized recovery account allows it.	Ordinary user debit below available amount fails atomically.
WALLET-008	FOUNDATION	Every posting MUST reference a source business event.	Ledger explorer links to payment/order/registration/prize/transfer.
WALLET-009	FOUNDATION	A general internal Toman balance MUST NOT be activated under DEC-050.	No user deposit, holding, transfer, spend, withdrawal, or wallet endpoint/UI exists.
WALLET-010	FOUNDATION	Reconciliation jobs MUST detect ledger/balance/read-model differences.	Difference creates operational alert.
WALLET-011	FOUNDATION	Finance exports MUST preserve exact integer amounts and asset codes.	Export/import comparison has no rounding difference.
WALLET-012	FOUNDATION	Manual adjustments MUST require reason and high-risk authorization.	Adjustment creates balanced entries and audit event.
REWARD-001	FOUNDATION, PHASE_1	Dragon Coin MUST be represented separately from fiat.	API returns distinct asset code and balance.
REWARD-002	PHASE_1	Dragon Coin MAY be purchased, awarded, promoted, or administratively granted.	Each issuance source is distinguishable.
REWARD-003	PHASE_1	Administrative grants MUST require permission and reason.	Audit links actor to ledger transaction.
REWARD-004	PHASE_1	Dragon Coin MAY be spent on enabled tournament, course, store, user-purchase, or platform-benefit transactions.	Disabled use case is rejected server-side.
REWARD-005	PHASE_1	Direct user-to-user transfer MUST debit and credit atomically.	No partial transfer occurs.
REWARD-006	PHASE_1	Dragon Coin MUST NOT be redeemed or sold back to Dragon Ecosystem.	No cash-out endpoint, UI, or settlement path exists.
REWARD-007	PHASE_1	Purchase and transfer limits, fraud holds, and manual-review thresholds MUST be configurable under DEC-049.	Limits are enforced consistently across API and admin.
REWARD-008	PHASE_1	Dragon Coin purchases are final and non-refundable. Duplicate, fraudulent, or system-error corrections MUST use an auditable administrative ledger adjustment rather than a refund.	The system never silently creates an unexplained negative balance or cash redemption path.
PAYOUT-001	PHASE_1, PHASE_5	Tournaments MUST define one or more versioned prize components.	Prize snapshot survives later edits.
PAYOUT-002	PHASE_1, PHASE_5	Components MAY be Dragon Coin, cash entitlement, activated internal Toman credit, physical product, or digital product.	Each component has a distinct settlement method.
PAYOUT-003	PHASE_1, PHASE_5	Winner confirmation MUST precede allocation.	Allocation cannot activate for an unconfirmed result.
PAYOUT-004	PHASE_1, PHASE_5	Allocation MUST be idempotent.	Reprocessing creates no duplicate entitlement.
PAYOUT-005	PHASE_1, PHASE_5	Cash prizes MUST remain pending until approved settlement.	Tournament completion alone does not mark cash paid.
PAYOUT-006	PHASE_5	High-risk payout MUST support initiator/approver separation.	Same user cannot perform both where policy requires dual control.
PAYOUT-007	PHASE_5	Payout states MUST support pending, review, approved, processing, successful, failed, cancelled, reversed, and manual review.	Invalid transition is rejected.
PAYOUT-008	PHASE_5	Settlement evidence MUST be retained.	Finance can retrieve provider/reference, actor, time, amount, and recipient evidence.
PAYOUT-009	PHASE_5	Failed payouts MUST be retryable without duplicate payment.	Retry uses stable payout and idempotency references.
PAYOUT-010	PHASE_5	Prize changes after allocation MUST use adjustment/reversal workflow.	Original allocation remains immutable.
PAYOUT-011	PHASE_5	Manual cash settlement MUST require configurable recipient verification, approval thresholds, reason, and immutable evidence under DEC-045.	Settlement cannot be marked successful when required internal checks or evidence are incomplete.
PAYOUT-012	PHASE_5	Financial reports MUST reconcile prize definition, allocation, ledger, and settlement.	Report identifies every unallocated or unsettled difference.
11.10 Notifications, Moderation, Audit, Analytics, Events, and Operations
ID	Tags	Requirement	Acceptance criteria
NOTIF-001	FOUNDATION, PHASE_1	The system MUST provide an in-app notification center.	User can list, filter, open, and mark own notifications read.
NOTIF-002	FOUNDATION	Notification creation MUST be event-driven and idempotent.	Duplicate domain event creates one logical notification.
NOTIF-003	FOUNDATION	Templates MUST be localized and versioned.	Delivery records identify template version and locale.
NOTIF-004	FOUNDATION	User preferences MUST be evaluated per event and channel.	Disabled optional channel receives no attempt.
NOTIF-005	FOUNDATION	Mandatory security messages MUST bypass optional marketing preferences.	Security notification is recorded when event occurs.
NOTIF-006	FOUNDATION	Delivery attempts MUST track queued, sent, delivered, failed, suppressed, expired, and cancelled where supported.	Admin can inspect status and failure reason.
NOTIF-007	FOUNDATION	External delivery MUST retry with bounded backoff.	Permanent failure enters manual/dead-letter state.
NOTIF-008	FOUNDATION	Notification links MUST be authorization-safe.	User opening target without access receives safe forbidden/not-found response.
NOTIF-009	FOUNDATION	Unread count MUST be eventually consistent and correctable.	Rebuild matches unread records.
NOTIF-010	PHASE_2, PHASE_3, PHASE_4, PHASE_5	Later modules MUST register event types through the shared service.	No module creates an independent notification table.
NOTIF-011	PHASE_4	Push notifications MUST remain provider-adapted and preference-controlled.	Provider can be replaced without changing domain events.
NOTIF-012	FOUNDATION	Campaign and transactional notifications MUST be distinguished.	Marketing consent cannot affect mandatory OTP delivery.
SMS-001	PHASE_1	OTP SMS MUST use approved localized templates.	Arbitrary user-controlled text cannot enter OTP body.
SMS-002	PHASE_1	Tournament administrators MAY enable only centrally approved transactional templates.	Unapproved template cannot be selected.
SMS-003	PHASE_1	Supported Phase 1 destination is Iranian mobile numbers.	Unsupported country is rejected or uses another approved channel.
SMS-004	PHASE_1	SMS sends MUST record recipient reference, template, locale, provider status, and correlation ID.	Delivery can be traced without exposing full number to unauthorized staff.
SMS-005	PHASE_1	OTP and transactional SMS rate limits MUST be separate.	Tournament campaign cannot exhaust OTP quota.
SMS-006	PHASE_1	Provider callbacks MUST be authenticated and idempotent where supported.	Duplicate delivery receipt updates once.
SMS-007	PHASE_1	Failed essential SMS MUST not roll back the underlying tournament transaction.	Registration remains valid and delivery failure is visible.
SMS-008	PHASE_1	User opt-out behavior MUST follow OD-008.	Feature remains configurable until decision approval.
SMS-009	FUTURE	Campaign SMS MUST support audience, approval, scheduling, cancellation, suppression, and reporting.	Campaign cannot send without approval.
SMS-010	FOUNDATION	SMS credentials MUST be stored as secrets and redacted.	Credentials do not appear in logs or client bundles.
MOD-001	FOUNDATION	Reports MUST use a shared moderation-case model.	Content/chat/course/social reports can be searched consistently.
MOD-002	FOUNDATION	Cases MUST preserve subject, reporter, evidence, severity, assignment, actions, and timestamps.	Evidence remains after public content removal.
MOD-003	FOUNDATION	Moderation permissions MUST be domain/resource scoped.	Chat moderator cannot suspend unrelated platform accounts.
MOD-004	FOUNDATION	Actions MUST require a reason and selected policy basis.	Action without reason is rejected.
MOD-005	FOUNDATION	Account suspension, content removal, timeout, ban, and dismissal MUST be distinct actions.	Audit identifies exact action and scope.
MOD-006	FOUNDATION	Reporter identity MUST be hidden from the reported user unless legally required.	User-facing response contains no reporter identity.
MOD-007	FOUNDATION	Duplicate reports SHOULD be grouped while preserving each report.	Moderator can see aggregate and individual records.
MOD-008	PHASE_4	Appeals MUST remain disabled until OD-024 is approved.	No partial appeal workflow is exposed.
MOD-009	FOUNDATION	Emergency action MAY be immediate but MUST receive retrospective review.	Unreviewed emergency action appears in oversight queue.
MOD-010	FOUNDATION	Moderation retention MUST follow DEC-043 and configurable data-class policies.	Purge/anonymization jobs obey the documented policy.
ADMIN-001	FOUNDATION	Admin navigation and APIs MUST be permission-scoped.	User cannot access unauthorized module by direct URL.
ADMIN-002	FOUNDATION	High-risk actions MUST require reason entry.	Submission without reason fails.
ADMIN-003	FOUNDATION	Finance/security configuration MUST support dual approval where configured.	Initiator cannot self-approve.
ADMIN-004	FOUNDATION	Bulk actions MUST preview count and impact.	Operator confirms exact affected set.
ADMIN-005	FOUNDATION	Concurrent edits MUST use optimistic conflict detection.	Stale update returns 409.
ADMIN-006	FOUNDATION	Admin lists MUST support search, filters, sorting, pagination, and export where approved.	Query state persists in URL.
ADMIN-007	FOUNDATION	Impersonation MUST NOT be implemented unless separately approved.	No hidden impersonation endpoint exists.
ADMIN-008	FOUNDATION	Sensitive values MUST be masked by default.	Ordinary admin cannot view full credentials/contact data.
ADMIN-009	FOUNDATION	Configuration changes MUST be versioned.	Previous active version remains inspectable.
ADMIN-010	FOUNDATION	Emergency super-admin actions MUST receive enhanced audit.	Event is included in security alert/report.
ADMIN-011	FOUNDATION	Staff access MUST be periodically reviewable.	Report lists active grants by user, role, scope, and last use.
ADMIN-012	FOUNDATION	Admin actions MUST never directly edit derived balances or standings.	Adjustments use domain workflows.
AUDIT-001	FOUNDATION	Audit records MUST be append-only from application users’ perspective.	No admin delete/update endpoint exists.
AUDIT-002	FOUNDATION	Audit events MUST include actor, action, target, scope, before/after summary, reason, timestamp, correlation, and source.	Required fields exist for sampled high-risk actions.
AUDIT-003	FOUNDATION	Sensitive payloads MUST be redacted or hashed.	Audit does not expose OTP, secret, or full payment credentials.
AUDIT-004	FOUNDATION	Financial, role, bracket, result, moderation, recovery, and configuration changes MUST be audited.	Traceability test finds an audit event for each.
AUDIT-005	FOUNDATION	Audit timestamps MUST be UTC and immutable.	Export preserves original time.
AUDIT-006	FOUNDATION	Audit access MUST be read-only and permission-controlled.	Unauthorized access returns 403.
AUDIT-007	FOUNDATION	Audit exports MUST record who exported what and why.	Export action creates its own audit event.
AUDIT-008	FOUNDATION	Retention and archival MUST follow DEC-043 and mandatory financial/legal obligations.	Policy can vary by event class.
ANALYTICS-001	FOUNDATION	Product analytics MUST be distinct from transactional truth.	Disabling analytics does not affect business state.
ANALYTICS-002	PHASE_1	Reports MUST cover content, games, tournaments, registrations, matches, and notifications.	Each report identifies source and freshness.
ANALYTICS-003	PHASE_2	Reports MUST cover stream discovery, watch sessions, provider playback metrics, and chat moderation.	Provider and first-party metrics are separated.
ANALYTICS-004	PHASE_3	Reports MUST cover enrollment, progress, completion, and course revenue.	Revenue reconciles to payments.
ANALYTICS-005	PHASE_4	Reports MUST cover follows, feed engagement, reports, and moderation.	Privacy rules apply to exports.
ANALYTICS-006	PHASE_5	Reports MUST cover catalog, conversion, orders, inventory, payment, coin, prizes, payouts, and reconciliation.	Financial totals trace to ledgers.
ANALYTICS-007	FOUNDATION	Reports MUST support authorized export.	Export records filters, generated time, and stable IDs.
ANALYTICS-008	FOUNDATION	Metric definitions MUST be documented.	Same metric is not calculated differently across dashboards.
ANALYTICS-009	FOUNDATION	Dashboard data freshness MUST be displayed.	User can distinguish live from delayed data.
ANALYTICS-010	FOUNDATION	Analytics consent behavior MUST follow DEC-043 and the selected tool decision OD-026.	Nonessential tracking is disabled when required consent is absent.
EVENT-001	FOUNDATION	Cross-module writes MUST use a transactional outbox or equivalent atomic event-persistence pattern.	Business commit cannot succeed while required event record is lost.
EVENT-002	FOUNDATION	Product-level delivery guarantee MUST be at least once for critical asynchronous events.	Consumers are idempotent under duplicate delivery.
EVENT-003	FOUNDATION	Events MUST use stable IDs and versions.	Duplicate event is recognized; unknown additive fields are tolerated.
EVENT-004	FOUNDATION	Retries MUST use bounded exponential backoff with jitter.	Retry schedule is observable and finite before escalation.
EVENT-005	FOUNDATION	Permanent failures MUST enter dead-letter/manual-recovery workflow.	Operator can inspect, retry, or resolve with audit.
EVENT-006	FOUNDATION	Correlation and causation IDs MUST propagate across synchronous and asynchronous boundaries.	One user transaction can be traced end to end.
EVENT-007	FOUNDATION	Ordering requirements MUST be declared per aggregate or event type.	Consumer rejects or delays unsafe out-of-order transition.
EVENT-008	FOUNDATION	User-visible processing MUST have pending/processing state.	Long job never appears as unexplained success.
EVENT-009	FOUNDATION	Scheduled jobs MUST be idempotent and lock-safe.	Multiple workers do not duplicate publication or settlement.
EVENT-010	FOUNDATION	Webhook producers MUST sign or authenticate events where consumer capability supports it.	Invalid webhook is rejected.
EVENT-011	FOUNDATION	Webhook consumers MUST persist receipt before side effects.	Retry after crash does not duplicate effect.
EVENT-012	FOUNDATION	Event schemas and ownership MUST be documented.	API/event documentation identifies producer and consumers.
OPS-001	FOUNDATION	Application services MUST expose liveness and readiness checks.	Unready instance receives no production traffic.
OPS-002	FOUNDATION	Background workers MUST expose health and queue-lag metrics.	Alert can identify stalled worker.
OPS-003	FOUNDATION	No application-managed backup scheduler is required in the current approved scope.	Release verification does not fail because a backup job is absent.
OPS-004	FOUNDATION	MongoDB named-volume persistence MUST survive normal Compose stop/start and application redeployment.	A restart persistence test proves previously committed test data remains available.
OPS-005	FOUNDATION	Failed jobs and dead letters MUST be visible in operations tooling.	Authorized operator can inspect and safely retry.
OPS-006	FOUNDATION	External-provider status MUST be monitored.	Provider outage creates alert and degraded-state UI.
OPS-007	FOUNDATION	Feature flags MUST be server controlled and audited.	Disabled capability cannot be invoked through API.
OPS-008	FOUNDATION	Maintenance mode MUST preserve safe public messaging and admin access policy.	Users receive localized maintenance response.
OPS-009	FOUNDATION	Secrets MUST support rotation without code change.	Rotated secret becomes active through deployment/configuration process.
OPS-010	FOUNDATION	Production diagnostics MUST avoid sensitive payloads.	Log-review tests confirm redaction.
OPS-011	FOUNDATION	Database migrations MUST be automated, ordered, and observable.	Deployment fails safely on migration error.
OPS-012	FOUNDATION	Search indexes and derived read models MUST be rebuildable.	Rebuild completes without data loss.
OPS-013	FOUNDATION	Operations MUST maintain runbooks for critical failures.	Runbooks cover mock payment callback, ledger difference, bracket corruption, provider outage, migration rollback/forward-fix, and Mongo persistence incidents.
OPS-014	FOUNDATION	Service-level targets MUST be tested against the DEC-046 scale baseline and finalized with support targets under OD-023.	Load evidence covers tournaments of up to 1,000 participants or teams.
12. Business Rules and State Machines
12.1 Business Rules
ID	Tags	Rule	Validation/error behavior
BR-001	PHASE_1	One mobile identity may belong to only one active account.	Conflict without revealing account details.
BR-002	PHASE_1	Username uniqueness is normalized and governed by OD-028.	Invalid/reserved name rejected.
BR-003	FOUNDATION	Users must meet minimum age policy.	Registration/profile completion blocked where policy fails.
BR-004	PHASE_1	One active participant registration per tournament.	Duplicate returns 409.
BR-005	PHASE_1	Capacity is counted from configured qualifying states.	Transactional capacity conflict returns waitlist or full response.
BR-006	PHASE_1	Team owner is the Phase 1 tournament representative.	Member action returns 403.
BR-007	PHASE_1	Team roster snapshots are immutable.	Modification creates a new snapshot/reference.
BR-008	PHASE_1	Registration rules and answers are snapshotted.	Later edits do not change prior submission.
BR-009	PHASE_1	Tournament format cannot activate without complete rule profile.	Activation blocked.
BR-010	PHASE_1	Locked bracket versions are immutable.	Change requires new version.
BR-011	PHASE_1	Result correction requires reason and recalculation preview.	Missing reason rejected.
BR-012	PHASE_1	Player result disputes and check-in are disabled.	Endpoint/action absent or feature-disabled.
BR-013	PHASE_1	Mixed fee components are fixed by tournament configuration.	Client cannot alter split.
BR-014	FOUNDATION	Rial is authoritative for fiat storage; Toman is display/input convention.	Nonconvertible amount rejected.
BR-015	FOUNDATION	Dragon Coin and fiat never share a balance.	Cross-asset posting without explicit exchange transaction prohibited.
BR-016	PHASE_1	Dragon Coin cannot be redeemed from Dragon Ecosystem.	Cash-out request unavailable.
BR-017	PHASE_1	User-to-user transfer is direct and fixed-amount, not an exchange order.	No bid/ask or variable-price order endpoints.
BR-018	FOUNDATION	Balance mutations occur only through ledger transactions.	Direct balance update prohibited.
BR-019	FOUNDATION	Refund cannot exceed eligible captured amount.	Excess rejected.
BR-020	FOUNDATION	Duplicate callback or job must not duplicate effect.	Existing result returned.
BR-021	PHASE_1	Registration cancellation/refund uses snapshotted policy.	Current edited policy cannot be applied retroactively.
BR-022	PHASE_1, PHASE_5	Prize components settle independently.	One failed component does not falsely mark others failed.
BR-023	PHASE_2	Stream access is determined by Dragon before provider playback data is issued.	Unauthorized request denied.
BR-024	PHASE_3	Course access requires active entitlement and enrollment.	Access denied when either is missing.
BR-025	PHASE_4	Feed visibility is evaluated at read time.	Previously generated activity cannot bypass current privacy.
BR-026	PHASE_5	Physical shipping is domestic to Iran.	Unsupported region rejected.
BR-027	PHASE_5	Stock cannot fall below zero.	Concurrent reservation conflict rejected.
BR-028	FOUNDATION	High-risk administrative action requires explicit reason.	Missing reason blocks action.
BR-029	FOUNDATION	Derived standings, balances, and analytics are not directly editable.	Domain-specific adjustment workflow required.
BR-030	FOUNDATION	Required localized user-facing content must be complete before publication.	Publication blocked.
12.2 State-Machine Contract

Each transition MUST define:

Current state and target state.
Permitted actor and scope.
Preconditions and validations.
Timestamp and actor.
Reason where required.
Notifications.
Audit event.
Domain event.
Idempotency behavior.
Failure and recovery path.
12.3 Account States

pending_verification → active → suspended → active

active/suspended → deletion_requested → anonymizing → closed

closed is terminal for authentication.
Rejected recovery attempts do not change state.
Security staff MAY force session revocation without changing account state.
12.4 Tournament States

draft → review → published → registration_open → registration_closed → active → completed → archived

Any pre-completion state MAY transition to cancelled with configured cleanup.

Invalid examples:

draft → active
completed → registration_open
cancelled → active without a formally defined restoration operation.
12.5 Registration States

draft → submitted → pending_payment → pending_review → approved

Alternative transitions:

submitted/pending_review → waitlisted
waitlisted → pending_review/approved
submitted/pending_review/waitlisted → rejected
Eligible nonfinal states → withdrawn
Staff-controlled eligible states → cancelled
Paid cancelled/rejected states MAY enter refund_pending → refunded/refund_failed/manual_review

Check-in states are reserved for future use and MUST remain disabled in Phase 1.

12.6 Match States

draft → scheduled → ready → live → completed

Alternatives:

scheduled/ready → rescheduled
scheduled/ready/live → cancelled
ready/live → forfeit
ready → no_show
Applicable states → disqualified
completed/forfeit/no_show/disqualified → correction_pending → completed

Player-created disputed state is future and disabled in Phase 1.

12.7 Bracket States

draft → generated → edited → validated → locked → active → completed

A version MAY become superseded. Rollback creates a new version referencing a prior version.

12.8 Team and Membership States

Team: active → disbanded → archived

Invitation: pending → accepted/declined/expired/revoked

Membership: active → left/removed

Ownership transfer is atomic: current owner becomes member and selected member becomes owner in one transaction.

12.9 Stream States

draft → scheduled → live → ended → archived

Alternatives:

draft/scheduled → cancelled
scheduled/live → failed
failed → scheduled/live/ended through controlled recovery.
12.10 Course and Enrollment States

Course: draft → review → published → unpublished → archived

Enrollment:

Free: pending → active → completed
Paid: pending_payment → active → completed
Applicable states → revoked/refunded/cancelled
12.11 Moderation States

submitted → triaged → investigating → actioned/dismissed → closed

Future approved appeal:

actioned → appealed → appeal_review → upheld/modified/reversed → closed

12.12 Order and Payment States

Order:

draft → pending_payment → paid → processing → fulfilled/completed

Alternatives: cancelled, expired, payment_failed, partially_fulfilled, refunded, manual_review.

Payment states are defined by PAY-005 and transitions MUST follow provider and business-event validation.

12.13 Ledger and Transfer States

Ledger transaction:

prepared → posted

Alternatives: rejected, reversed through linked reversing transaction.

Dragon Coin transfer:

initiated → risk_review/processing → completed

Alternatives: failed, cancelled, reversed, manual_review.

12.14 Prize and Payout States

Prize allocation:

pending_result → eligible → allocated → settlement_pending → partially_settled/settled

Alternatives: held, cancelled, reversed, manual_review.

Payout state follows PAYOUT-007.

12.15 Notification and SMS States

Notification:

created → queued → sent → delivered/read

Alternatives: suppressed, failed, expired, cancelled.

Campaign:

draft → review → approved → scheduled → sending → completed

Alternatives: cancelled, paused, failed.

13. Forms and Validation
13.1 Common Form Contract

All forms MUST:

Validate on client for usability and again on server authoritatively.
Use localized labels, hints, and validation messages.
Preserve valid user input after recoverable failure.
Prevent duplicate submission.
Expose processing state.
Associate errors with fields and announce them to assistive technology.
Use server-provided field error codes mapped to localized messages.
Reject unknown fields for security-sensitive forms.
Enforce maximum payload size.
Record consent/policy version where applicable.
13.2 Form Catalog
ID	Tags	Form and fields	Key validation and behavior
FORM-001	PHASE_1	Mobile OTP request: mobile number	Required, Iranian number normalization, rate limits, generic response.
FORM-002	PHASE_1	OTP verification: OTP code	Fixed provider-approved length, numeric where applicable, expiry, attempt limit, single use.
FORM-003	PHASE_1	Profile: username, display name, birth date, avatar, bio, locale, time zone	Lengths configurable; username normalized/reserved checks; age validation; safe text.
FORM-004	PHASE_1	Email: address and verification code	Valid normalized email; uniqueness policy; verification required for use.
FORM-005	PHASE_1	Game identity: game, field values	Fields and formats derive from versioned game configuration.
FORM-006	PHASE_1	Team create/edit: localized name, slug, logo, description	Owner only; uniqueness; media policy; safe text.
FORM-007	PHASE_1	Team invitation: recipient	Existing eligible user, no duplicate active invitation/membership, expiry.
FORM-008	PHASE_1	Tournament registration: participant, roster, answers, fee, consent	Eligibility, capacity, duplicate, roster snapshot, question version, exact fee, idempotency.
FORM-009	PHASE_1	Tournament editor: identity, dates, capacity, format, rules, fees, refund policy, prizes	Cross-field date ordering; format-required rules; nonnegative exact amounts; publication validation.
FORM-010	PHASE_1	Rule profile editor	Format-specific required fields, version creation, no active-version mutation.
FORM-011	PHASE_1	Bracket editor	Participant uniqueness, valid graph/progression, completed-match impact preview.
FORM-012	PHASE_1	Match result	Allowed score shape, winner consistency, outcome reason, optimistic version.
FORM-013	PHASE_1	Dragon Coin purchase	Approved package, exact rial amount, provider availability, idempotency.
FORM-014	PHASE_1	Dragon Coin transfer	Recipient, positive integer amount, no self-transfer, available balance, limits, confirmation.
FORM-015	PHASE_1	Content editor	Localized title/slug/body/summary/SEO/media/taxonomy/schedule; sanitation and completeness.
FORM-016	PHASE_2	Stream editor	Schedule, links, access, provider reference, archive policy; time and rights validation.
FORM-017	PHASE_3	Course editor	Localized curriculum, coach, price, access, completion rules; publication completeness.
FORM-018	PHASE_4	Post/comment/report	Length, media, mentions, visibility, safety, rate limits.
FORM-019	PHASE_5	Product editor	Type, variants, inventory, localized content, exact prices, fulfillment.
FORM-020	PHASE_5	Checkout	Cart version, address, payment assets, consent; server recalculation and idempotency.
FORM-021	FOUNDATION	Admin reason/approval	Required reason; optional second approver; initiator cannot self-approve where prohibited.
FORM-022	FOUNDATION	Support recovery	Case, evidence classification, new contact, reviewer, reason, recent-auth rules.

Field minimum/maximum lengths and enumerations MUST be centralized in versioned configuration and documented in API schemas. Security-sensitive maxima MUST also be enforced before parsing large payloads.

14. Data Model
14.1 Data Principles
Authoritative entities MUST use stable opaque IDs.
All mutable entities MUST contain created_at, updated_at, and optimistic version where concurrent updates matter.
Audit-sensitive records MUST record actor/source.
Soft deletion MUST NOT be used as a substitute for explicit lifecycle states.
Financial and audit records MUST not be destructively deleted through ordinary application workflows.
Personal data MUST be classified and access-controlled.
Search indexes, caches, and calculated balances are derived data.
14.2 Entity Catalog
ID	Tags	Entity	Core fields/relationships	Lifecycle, constraints, retention
DATA-001	FOUNDATION	Account	ID, state, locale, time zone, age-policy status	Stable owner root; no hard deletion while legal records remain. Sensitive.
DATA-002	FOUNDATION	IdentityMethod	account, type, canonical identifier, verified state	Unique active mobile/email; sensitive.
DATA-003	FOUNDATION	OTPChallenge	identity, hash, expiry, attempts, status	Short retention; highly sensitive.
DATA-004	FOUNDATION	Session	account, token hash/reference, device, expiry, revoked	Revocable; sensitive.
DATA-005	FOUNDATION	SecurityEvent	account, type, source, metadata	Append-only, retention per DEC-043 data-class policy.
DATA-006	FOUNDATION	RoleDefinition	code, permissions, risk class	Version-controlled configuration.
DATA-007	FOUNDATION	RoleAssignment	user, role, resource scope, effective dates	Audited; no destructive history loss.
DATA-008	PHASE_1	UserProfile	username, display name, birth date, avatar, bio	Public/private field controls; sensitive birth date.
DATA-009	PHASE_1	Game	localized identity, status, media, configuration	Archive rather than delete when referenced.
DATA-010	PHASE_1	PlayerGameIdentity	user, game, field-version, values, verification	Unique rules configurable; sensitive depending on game ID.
DATA-011	PHASE_1	ContentItem	type, status, author, taxonomy, schedule	Versioned; archive retains URLs/history.
DATA-012	PHASE_1	ContentTranslation	content group, locale, title, body, SEO	Unique per locale/version.
DATA-013	PHASE_1	ContentRevision	content, version, snapshot, actor	Append-only.
DATA-014	PHASE_1	Category	type, localized values, parent	Archive when referenced.
DATA-015	PHASE_1	Tag	normalized key, localized label	Merge workflow rather than destructive delete.
DATA-016	FOUNDATION	MediaAsset	owner, storage key, MIME, size, hash, state	Scan/processing lifecycle; access-controlled.
DATA-017	FOUNDATION	MediaVariant	asset, type, dimensions/bitrate	Derived and rebuildable where possible.
DATA-018	PHASE_1	Team	identity, owner relationship, state	Persistent; disband/archive.
DATA-019	PHASE_1	TeamMembership	team, user, role, effective dates, state	Historical records retained.
DATA-020	PHASE_1	TeamInvitation	team, inviter, invitee, expiry, state	Status history retained.
DATA-021	PHASE_1	RosterSnapshot	team/registration/match, immutable members	Immutable competition evidence.
DATA-022	PHASE_1	Tournament	game, organizer, status, dates, participant type, capacity	Versioned configuration snapshots.
DATA-023	PHASE_1	TournamentTranslation	tournament, locale, name, rules, SEO	Required fa and en before publication.
DATA-024	PHASE_1	TournamentStaffAssignment	tournament/match, user, role, scope	Effective and audited.
DATA-025	PHASE_1	EligibilityRuleSet	tournament, version, rules	Immutable after use.
DATA-026	PHASE_1	RegistrationQuestion	tournament, version, type, options, validation	Snapshot/versioned.
DATA-027	PHASE_1	TournamentRegistration	tournament, participant, status, capacity slot, fee snapshot	Unique active constraint; history retained.
DATA-028	PHASE_1	RegistrationAnswer	registration, question version, answer	Immutable after final submission except audited correction. Sensitive.
DATA-029	PHASE_1	WaitlistEntry	registration, order, reason, promotion history	Administrator-managed.
DATA-030	PHASE_1	CompetitionRuleProfile	format, publisher/game scope, version, parameters	Immutable version.
DATA-031	PHASE_1	Competition	tournament/division, format, profile version, state	Owns bracket/standings.
DATA-032	PHASE_1	SeedEntry	competition, participant, seed, source	Versioned with bracket.
DATA-033	PHASE_1	BracketVersion	competition, version, parent, state, reason	Immutable once recorded.
DATA-034	PHASE_1	BracketNode	bracket version, round, position, match/progression	Unique structural constraints.
DATA-035	PHASE_1	Match	competition, participants, schedule, state, version	Retained; result changes versioned.
DATA-036	PHASE_1	MatchResultVersion	match, scores, outcome, winner, actor, reason	Append-only.
DATA-037	PHASE_1	StandingSnapshot	competition, calculation input/profile/version, rows	Immutable published snapshot.
DATA-038	FOUNDATION	Notification	recipient, event, template version, locale, read state	Retention per policy.
DATA-039	FOUNDATION	DeliveryAttempt	notification/campaign, channel, provider, status	Operational retention; sensitive recipient masked.
DATA-040	PHASE_1	NotificationPreference	user, event class, channel, enabled	Unique per effective preference.
DATA-041	PHASE_1	SMSTemplate	code, locale, version, approved state	Immutable approved versions.
DATA-042	PHASE_2	Stream	channel, provider, links, schedule, state, access, archive policy	Provider-neutral stable ID.
DATA-043	PHASE_2	StreamingProviderResource	stream/channel, provider ID, sync state	Secrets not stored in entity payload.
DATA-044	PHASE_2	VODAsset	stream, provider/media reference, rights, state	Retention per rights policy.
DATA-045	PHASE_2	Highlight	source media, time range, state	References rights/source.
DATA-046	PHASE_2	ChatRoom	stream, state, moderation scope	Archive according to policy.
DATA-047	PHASE_2	ChatMessage	room, sender, body, state, timestamps	Evidence retention separate from public display.
DATA-048	FOUNDATION	ModerationReport	reporter, subject type/ID, reason, evidence	Sensitive; access restricted.
DATA-049	FOUNDATION	ModerationCase	reports, assignee, severity, state, actions	Auditable retention.
DATA-050	PHASE_3	CoachProfile	user, localized bio, games, approval	Public/private separation.
DATA-051	PHASE_3	Course	owner, coach, game, state, access model, price	Versioned publication/pricing.
DATA-052	PHASE_3	Lesson	course, type, order, prerequisites, content refs	Versioned.
DATA-053	PHASE_3	Enrollment	user, course, entitlement, state	Unique active enrollment.
DATA-054	PHASE_3	LessonProgress	enrollment, lesson, progress, completion	Unique per enrollment/lesson.
DATA-055	PHASE_3	CourseReview	enrollment, rating, body, moderation state	One active review per eligible enrollment.
DATA-056	PHASE_4	Follow	follower, target type/ID, state	Unique active relation.
DATA-057	PHASE_4	SocialPost	author, body, media, visibility, state	Moderation lifecycle.
DATA-058	PHASE_4	Comment	post/parent, author, body, state	Thread constraints.
DATA-059	PHASE_4	Reaction	actor, target, type	Unique active reaction per configured rule.
DATA-060	PHASE_4	Activity	actor, verb, object, audience, event reference	Derived/rebuildable where practical.
DATA-061	FOUNDATION	MoneyAmount	asset code, integer amount, scale	Value contract, not standalone mutable balance.
DATA-062	FOUNDATION	Payment	provider, purpose, rial amount, state, idempotency	Financial retention; immutable references.
DATA-063	FOUNDATION	PaymentAttempt	payment, provider request/reference, status	Append-only attempt history.
DATA-064	FOUNDATION	Refund	payment, amount, state, reason, policy version	Cannot exceed eligible amount.
DATA-065	FOUNDATION	LedgerAccount	owner/system, asset, class, state	One or more accounts per asset/purpose.
DATA-066	FOUNDATION	LedgerTransaction	source, idempotency, state, timestamps	Immutable after posting.
DATA-067	FOUNDATION	LedgerEntry	transaction, account, signed amount, asset	Balanced posting constraint.
DATA-068	PHASE_1	DragonCoinPackage	coin amount, rial price, status, version	Exact integer values.
DATA-069	PHASE_1	DragonCoinTransfer	sender, recipient, amount, state, ledger ref	No self-transfer; limits.
DATA-070	PHASE_1, PHASE_5	PrizeDefinition	tournament, places, component versions	Snapshot before competition completion.
DATA-071	PHASE_1, PHASE_5	PrizeAllocation	winner, component, state, entitlement/ledger ref	Idempotent unique allocation.
DATA-072	PHASE_5	Payout	allocation, recipient, amount, state, approval	Sensitive financial record.
DATA-073	PHASE_5	Product	type, localized content, status, media	Archive when referenced.
DATA-074	PHASE_5	ProductVariant	product, SKU, price, stock policy	Unique SKU.
DATA-075	PHASE_5	InventoryMovement	variant, quantity delta, source, actor	Append-only.
DATA-076	PHASE_5	Cart	user, state, version	Expirable.
DATA-077	PHASE_5	CartItem	cart, variant, quantity, price preview	Repriced at checkout.
DATA-078	PHASE_5	Discount	code, rule/version, limits, status	Usage tracked.
DATA-079	PHASE_5	Order	user, totals, snapshots, state, payment refs	Financial retention.
DATA-080	PHASE_5	OrderItem	order, product snapshot, quantity, amounts	Immutable after order confirmation.
DATA-081	PHASE_5	Fulfillment	order/item, type, address/entitlement, state	Domestic physical or digital.
DATA-082	FOUNDATION	Entitlement	owner, resource type/ID, source, state, dates	Shared by tournaments/courses/products/media.
DATA-083	FOUNDATION	AuditEvent	actor, action, resource, before/after, reason, correlation	Append-only.
DATA-084	FOUNDATION	DomainEventOutbox	event envelope, state, attempts	Transactionally persisted and purge-controlled.
DATA-085	FOUNDATION	JobExecution	job type, payload ref, state, attempts, correlation	Operational retention.
DATA-086	FOUNDATION	ConfigurationVersion	key/scope, version, value, state, approvals	Immutable active versions.
DATA-087	FOUNDATION	SupportCase	requester, category, state, evidence, assignment	Sensitive, retention policy.
DATA-088	FOUNDATION	ConsentRecord	user, document/version, action, timestamp	Append-only evidence.
DATA-089	FOUNDATION	SearchDocument	source ID/type, locale, fields, visibility	Derived/rebuildable.
DATA-090	FOUNDATION	AnalyticsEvent	pseudonymous actor, event, properties, consent state	Non-authoritative and retention-limited.
14.3 Entity Relationship Overview
Account owns identities, sessions, profile, preferences, notifications, teams, registrations, enrollments, orders, and financial accounts.
Game links content, player identities, tournaments, streams, courses, teams/statistics, and products.
Tournament owns registrations, rule selection, competition, staff assignments, matches, standings, stream links, prize definitions, and notifications.
Competition owns bracket versions, nodes, seeds, matches, and standing snapshots.
Payment references a business purpose such as registration, course enrollment, order, or Dragon Coin package.
Ledger transactions reference their originating payment, transfer, refund, prize, payout, order, registration, or administrative adjustment.
Prize allocation connects tournament results to Dragon Coin, fiat entitlement, internal credit, physical fulfillment, digital entitlement, and payout.
Moderation cases reference reports from content, chat, courses, profiles, posts, comments, teams, orders, or users.
Domain events connect modules asynchronously without replacing authoritative relationships.
15. API Requirements
15.1 Common API Contract
Base path: /api/v1.
HTTPS only.
JSON request/response unless transferring approved files.
Authentication through secure session/token mechanism.
Authorization evaluated server-side.
Mutating endpoints MUST support optimistic conflict checks where applicable.
Financial, registration, order, transfer, allocation, and provider operations MUST support Idempotency-Key.
List endpoints MUST support cursor pagination by default.
Maximum page size MUST be configured and capped at 100 unless an approved internal export endpoint is used.
Sorting and filters MUST be allowlisted.
Timestamps MUST use ISO 8601 UTC.
Money MUST use {assetCode, amountInteger, scale} or an equivalent exact contract.
Localized content MUST identify locale.
APIs MUST return stable error codes.
15.2 Error Format
{
  "error": {
    "code": "REGISTRATION_CAPACITY_REACHED",
    "message": "Localized user-safe message",
    "fieldErrors": [
      {
        "field": "roster",
        "code": "INELIGIBLE_MEMBER",
        "message": "Localized user-safe message"
      }
    ],
    "correlationId": "opaque-id",
    "retryable": false
  }
}
15.3 API Operation Catalog
ID	Tags	Method and path	Purpose and authorization	Key behavior
API-001	PHASE_1	POST /auth/otp/request	Public OTP request	Rate-limited; generic response.
API-002	PHASE_1	POST /auth/otp/verify	Public OTP verification	Creates/reuses account idempotently.
API-003	FOUNDATION	POST /auth/logout	Authenticated	Revokes current session.
API-004	FOUNDATION	GET /auth/sessions	Own account	Lists masked active sessions.
API-005	FOUNDATION	DELETE /auth/sessions/{id}	Own account	Revokes selected session.
API-006	FOUNDATION	POST /account/recovery	Public/support workflow	Enumeration-safe and audited.
API-007	PHASE_1	GET/PATCH /me/profile	Own account	Profile read/update with version.
API-008	PHASE_1	POST /me/email	Own account	Adds unverified email.
API-009	PHASE_1	POST /me/email/verify	Own account	Verifies challenge.
API-010	PHASE_1	GET/POST /me/game-identities	Own player	List/create identity.
API-011	PHASE_1	PATCH/DELETE /me/game-identities/{id}	Own player	Update/archive identity.
API-012	PHASE_1	GET /content	Public	Filtered localized published list.
API-013	PHASE_1	GET /content/{slug}	Public	Published localized detail.
API-014	PHASE_1	GET /games	Public	Search/filter/paginate.
API-015	PHASE_1	GET /games/{slug}	Public	Game detail and relationships.
API-016	PHASE_1	GET /tournaments	Public	Search/filter/sort/paginate.
API-017	PHASE_1	GET /tournaments/{id}	Public	Detail, rules, capacity, fees, prizes.
API-018	PHASE_1	POST /tournaments/{id}/registrations	Player/team owner	Idempotent registration submission.
API-019	PHASE_1	GET /me/registrations	Own account	Registration list/history.
API-020	PHASE_1	GET /registrations/{id}	Participant/authorized staff	Scoped detail.
API-021	PHASE_1	POST /registrations/{id}/withdraw	Participant	Policy-controlled withdrawal.
API-022	PHASE_1	POST /admin/registrations/{id}/approve	Tournament admin	Reason/optimistic version.
API-023	PHASE_1	POST /admin/registrations/{id}/reject	Tournament admin	Required reason/refund workflow.
API-024	PHASE_1	POST /admin/registrations/{id}/waitlist	Tournament admin	Ordered waitlist.
API-025	PHASE_1	POST /admin/registrations/{id}/promote	Tournament admin	Capacity/eligibility revalidation.
API-026	PHASE_1	GET/POST /teams	User	List/create team.
API-027	PHASE_1	GET/PATCH /teams/{id}	Public/owner	Read/update scope.
API-028	PHASE_1	POST /teams/{id}/invitations	Owner	Invite eligible user.
API-029	PHASE_1	POST /team-invitations/{id}/accept	Invitee	Idempotent acceptance.
API-030	PHASE_1	POST /team-invitations/{id}/decline	Invitee	Status transition.
API-031	PHASE_1	DELETE /teams/{id}/members/{userId}	Owner/member self	Remove or leave.
API-032	PHASE_1	POST /teams/{id}/transfer-ownership	Owner	Atomic transfer.
API-033	PHASE_1	POST /teams/{id}/disband	Owner	Preserves history.
API-034	PHASE_1	GET /tournaments/{id}/bracket	Public	Active bracket/version.
API-035	PHASE_1	GET /tournaments/{id}/standings	Public	Published standings.
API-036	PHASE_1	POST /admin/competitions/{id}/generate	Tournament admin	Idempotent version creation.
API-037	PHASE_1	POST /admin/brackets/{id}/versions	Tournament admin	Creates edit version.
API-038	PHASE_1	PATCH /admin/bracket-versions/{id}	Tournament admin	Draft version edit with validation.
API-039	PHASE_1	POST /admin/bracket-versions/{id}/validate	Tournament admin	Returns issues without activation.
API-040	PHASE_1	POST /admin/bracket-versions/{id}/lock	Tournament admin	Activates validated version.
API-041	PHASE_1	POST /admin/brackets/{id}/rollback	Tournament admin	Creates new version from prior.
API-042	PHASE_1	GET /matches/{id}	Authorized/public according to tournament	Match detail.
API-043	PHASE_1	PATCH /admin/matches/{id}/schedule	Admin/referee scope	Reschedule with reason/version.
API-044	PHASE_1	POST /admin/matches/{id}/result	Admin/referee	Result entry and progression.
API-045	PHASE_1	POST /admin/matches/{id}/result-corrections	Admin/referee	Versioned correction.
API-046	PHASE_1	GET /me/notifications	Own account	Cursor list.
API-047	PHASE_1	POST /me/notifications/{id}/read	Own account	Idempotent.
API-048	PHASE_1	PATCH /me/notification-preferences	Own account	Channel/event preferences.
API-049	PHASE_1	POST /payments	Authenticated business flow	Purpose-bound intent, idempotent.
API-050	PHASE_1	GET /payments/{id}	Owner/finance	Scoped status.
API-051	PHASE_1	POST /webhooks/payments/{provider}	Provider	Authenticated callback, idempotent.
API-052	PHASE_1	POST /admin/payments/{id}/refunds	Finance	Policy, reason, permission.
API-053	PHASE_1	GET /me/dragon-coin	Own account	Balances and history.
API-054	PHASE_1	POST /dragon-coin/purchases	User	Package purchase/payment.
API-055	PHASE_1	POST /dragon-coin/transfers	User	Idempotent direct transfer.
API-056	PHASE_1	POST /admin/dragon-coin/grants	Finance	Reason and ledger posting.
API-057	PHASE_1	GET /search	Public/user	Authorized cross-domain search.
API-058	PHASE_1	POST /admin/content	Author	Create draft.
API-059	PHASE_1	PATCH /admin/content/{id}	Content roles	Update draft/revision.
API-060	PHASE_1	POST /admin/content/{id}/publish	Publisher	Completeness validation.
API-061	PHASE_1	POST /admin/media	Authorized uploader	Validated upload initiation.
API-062	PHASE_1	POST /admin/tournaments	Organizer/admin	Create draft.
API-063	PHASE_1	PATCH /admin/tournaments/{id}	Assigned staff	Version/conflict checks.
API-064	PHASE_1	POST /admin/tournaments/{id}/publish	Authorized admin	Full validation.
API-065	PHASE_1	POST /admin/tournaments/{id}/cancel	Authorized admin	Reason and cleanup events.
API-066	PHASE_2	GET /streams	Public	Discovery.
API-067	PHASE_2	GET /streams/{id}	Public/authorized	Metadata and access state.
API-068	PHASE_2	POST /streams/{id}/playback-access	Viewer	Returns provider-safe playback configuration.
API-069	PHASE_2	POST /admin/streams	Streaming operator	Create Dragon stream.
API-070	PHASE_2	POST /admin/streams/{id}/provision	Streaming operator	Provider-adapter operation.
API-071	PHASE_2	POST /webhooks/streaming/{provider}	Provider	Authenticated sync callback.
API-072	PHASE_2	GET /streams/{id}/chat/messages	Viewer	Authorized cursor history/live bootstrap.
API-073	PHASE_2	POST /streams/{id}/chat/messages	Authenticated viewer	Rate-limited send.
API-074	PHASE_2	POST /chat/messages/{id}/reports	Viewer	Moderation report.
API-075	PHASE_2	POST /admin/chat/users/{id}/timeouts	Chat moderator	Scoped action.
API-076	PHASE_2	POST /admin/chat/users/{id}/bans	Chat moderator	Scoped action.
API-077	PHASE_3	GET /courses	Public	Course discovery.
API-078	PHASE_3	GET /courses/{id}	Public	Course detail.
API-079	PHASE_3	POST /courses/{id}/enrollments	Learner	Free/paid entitlement flow.
API-080	PHASE_3	GET /me/enrollments/{id}	Learner	Course access/progress.
API-081	PHASE_3	PUT /enrollments/{id}/lessons/{lessonId}/progress	Learner	Idempotent progress update.
API-082	PHASE_3	POST /courses/{id}/reviews	Eligible learner	One active review.
API-083	PHASE_4	POST/DELETE /follows/{targetType}/{targetId}	User	Idempotent follow/unfollow.
API-084	PHASE_4	GET /feed	User	Visibility-aware cursor feed.
API-085	PHASE_4	POST /posts	User	Create post.
API-086	PHASE_4	POST /posts/{id}/comments	User	Create comment.
API-087	PHASE_4	PUT/DELETE /reactions/{targetType}/{targetId}	User	Idempotent reaction.
API-088	PHASE_4	POST /reports	User	Shared report creation.
API-089	PHASE_5	GET /products	Public	Catalog discovery.
API-090	PHASE_5	GET /products/{id}	Public	Product detail.
API-091	PHASE_5	GET/PATCH /me/cart	User	Read/update versioned cart.
API-092	PHASE_5	POST /orders	User	Idempotent checkout/order.
API-093	PHASE_5	GET /me/orders	User	Own orders.
API-094	PHASE_5	GET /me/orders/{id}	User	Detail/receipt.
API-095	PHASE_5	POST /admin/prize-allocations/{id}/approve	Finance approver	Separation-of-duties check.
API-096	PHASE_5	POST /admin/payouts/{id}/execute	Finance	Idempotent provider/manual execution.
API-097	FOUNDATION	GET /admin/audit	Auditor	Permission-filtered audit search.
API-098	FOUNDATION	GET /admin/operations/jobs	Operations	Failed/pending jobs.
API-099	FOUNDATION	POST /admin/operations/jobs/{id}/retry	Operations	Idempotent audited retry.
API-100	FOUNDATION	GET /health/live, GET /health/ready	Infrastructure	Minimal nonsecret health response.

Rate limits MUST be defined per endpoint class before production and validated against the DEC-046 scale baseline. Authentication, OTP, search, chat, transfer, checkout, and administrative exports require distinct policies.

16. Authentication and Authorization
16.1 Authentication
Mobile OTP is the required Phase 1 method.
OTP delivery MUST use the approved deterministic mock SMS adapter defined by DEC-041.
OTP lifetime, resend interval, attempt count, and lockout MUST be configurable security settings.
Session tokens MUST use secure, HTTP-only, same-site cookies for browser use unless the approved architecture requires another secure mechanism.
Tokens MUST be rotated or revoked after recovery, mobile change, suspicious activity, or passwordless-identity replacement.
Email remains optional.
Email verification is mandatory before email notification or email recovery.
MFA beyond OTP login MAY be introduced for staff and high-risk users; staff production access SHOULD require stronger authentication before launch.
Super-administrator and finance access MUST support enhanced authentication requirements.
16.2 Authorization

Authorization MUST combine:

Account state.
Global permission.
Resource-scoped assignment.
Ownership.
Relationship, such as team membership.
Phase/feature activation.
Business state.
Risk or moderation restriction.
16.3 Role-Permission Matrix
Capability	User	Team owner	Tournament admin	Referee	Content publisher	Moderator	Support	Finance	Platform admin	Super admin
Own profile	Own	Own	Own	Own	Own	Own	Own	Own	Own	Own
Team membership	Member	Manage owned	View assigned	View assigned	—	Moderation scope	Support view	—	Configured	Emergency
Tournament registration	Own	Owned team	Review assigned	View assigned	—	—	Support view	Payment view	Configured	Emergency
Bracket	Read	Read	Manage assigned	Read/limited	—	—	Read support	—	Configured	Emergency
Match results	Read	Read	Manage assigned	Assigned match	—	—	Read support	—	Configured	Emergency
Content publish	—	—	—	—	Yes	Remove by policy	Support view	—	Configured	Emergency
Moderation action	—	—	Tournament scope	Match scope	—	Assigned scope	Limited support	—	Configured	Emergency
Payment refund	Own status	Own status	View registration	—	—	—	Request only	Authorized	No implicit	Emergency
Dragon Coin grant	—	—	Prize request	—	—	—	—	Authorized	No implicit	Emergency
Role assignment	—	—	Tournament staff scope if permitted	—	—	—	—	—	Configured	Yes
Audit read	Own history	Team scope	Assigned scope	Assigned scope	Content scope	Case scope	Support scope	Finance scope	Configured	Yes
16.4 Unauthorized Behavior
Unauthenticated protected request: 401.
Authenticated but forbidden request: 403.
Resource hidden for privacy/safety MAY return 404.
UI MUST not reveal unavailable actions, but server enforcement remains mandatory.
Repeated forbidden access SHOULD generate a security signal.
17. Internationalization and Localization
17.1 Locale Policy
Requirement	Specification
I18N-001	Required locales are Persian fa and English en.
I18N-002	Initial locale is detected from browser/device preference.
I18N-003	Unsupported or missing preference falls back to Persian.
I18N-004	English is the internal authoring fallback for operator context, but missing user-facing Persian or English translations are release-blocking.
I18N-005	Runtime language switching MUST be supported.
I18N-006	Selected locale MUST persist in the user account when authenticated and in a suitable client preference when anonymous.
I18N-007	Application state and the equivalent route SHOULD be preserved during switching.
I18N-008	UI strings MUST NOT be hardcoded in components.
I18N-009	Raw translation keys MUST never appear in production UI.
I18N-010	Automated checks MUST detect missing required keys and localized content.
I18N-011	Major browser journeys MUST run in both locales.
I18N-012	Admin, legal, notifications, SMS, email, validation, errors, and metadata MUST be localized.
17.2 Translation Architecture
Translation keys MUST use stable namespaces such as tournament.registration.status.approved.
Keys MUST describe meaning, not literal English wording.
Interpolation values MUST be escaped by default.
Pluralization MUST use locale-aware rules.
Translation files MUST be organized by locale and domain.
Shared and module-specific namespaces MUST be version controlled.
Missing-key behavior in development MUST be loud.
Production MUST use a safe localized fallback and emit an error signal; it MUST NOT show the raw key.
Adding a locale MUST include translation bundles, formatting configuration, metadata, direction, tests, and completeness validation.
17.3 Localized Content
Editorial, tournament, game, course, stream, product, and legal content MUST use translation-group records.
Publication requiring both locales MUST fail if either required version is incomplete.
Localized slugs MAY differ.
Canonical and alternate-locale relationships MUST remain explicit.
Search MUST index each locale separately.
Content editors MUST see translation status and source version.
17.4 Date, Time, Number, and Currency
Store times in UTC.
Display times in selected user time zone.
Anonymous users use detected/configured time zone with clear display.
Date/time formatting MUST be locale-aware.
Number grouping and digit presentation MUST be locale-aware without changing stored values.
User-entered Persian and Latin digits SHOULD be normalized where a field expects numbers.
Rial is the stored fiat unit.
Toman is the user-facing convention.
Financial UI MUST identify Toman clearly and MUST not ambiguously label rial values.
Dragon Coin MUST use its distinct localized name and asset symbol after brand approval.
17.5 RTL Requirements

For fa:

Root document direction MUST be rtl.
Logical CSS properties MUST be used.
Layout mirroring MUST be semantic, not blanket image reversal.
Back/forward and progression icons MUST be direction-aware.
Media playback, scores, bracket semantics, code, charts, and game-specific interfaces MUST preserve meaningful orientation.
Inputs containing email, URL, username, game ID, promo code, transaction ID, match ID, SKU, or code-like value MUST use bidi isolation and appropriate LTR treatment.
Tables MUST preserve readable numeric alignment.
Pagination direction MUST match reading direction without changing page-number meaning.
Modals, drawers, toast positions, and navigation MUST be tested in RTL.
Mobile and desktop real-browser RTL tests are mandatory.
18. Notifications and Messaging
18.1 Channels
Channel	Phase	Use
In-app	Phase 1	All eligible transactional events
SMS	Phase 1	OTP and administrator-enabled approved tournament templates
Email	Phase 1	Optional verified recipient; transactional messages
Web/mobile push	Phase 4 by default	Expanded community and live notifications after provider decision
Campaign SMS	Future/phase extension	Approved marketing/operational campaigns
18.2 Required Event Classes
Account verification and recovery.
Security-sensitive change.
Registration received, approved, rejected, waitlisted, promoted, cancelled, or refunded.
Match created, scheduled, rescheduled, cancelled, result posted, or corrected.
Tournament changed, started, completed, or cancelled.
Team invitation, acceptance, removal, ownership transfer.
Stream scheduled, live, cancelled, archived.
Course enrollment, payment, lesson/progress milestone, completion.
Social follow, mention, comment, moderation action where enabled.
Order, payment, fulfillment, refund.
Dragon Coin purchase, transfer, grant, hold, or reversal.
Prize allocation, payout review, failure, or settlement.
Administrative and operational alerts.
18.3 Messaging Rules
Templates MUST be localized and versioned.
Template rendering MUST fail safely when required variables are missing.
Notification creation MUST not be rolled back solely because an external channel is unavailable.
Users MUST see delivery-independent in-app status for important business events.
Campaigns MUST not reuse transactional consent assumptions.
Delivery retries MUST avoid duplicate user-visible messages where provider idempotency permits.
Provider delivery reports MUST not be treated as proof the user read a message.
19. File and Media Requirements
ID	Tags	Requirement
MEDIA-001	FOUNDATION	Uploads MUST use an allowlist of MIME types, extensions, signatures, and maximum sizes.
MEDIA-002	FOUNDATION	File content MUST be validated independently of filename and client MIME.
MEDIA-003	FOUNDATION	Uploaded files MUST remain nonpublic until validation and malware scanning complete.
MEDIA-004	FOUNDATION	Images MUST support optimized responsive derivatives and thumbnails.
MEDIA-005	FOUNDATION	Original and derivative relationships MUST be retained.
MEDIA-006	FOUNDATION	Media access MUST follow owning-resource authorization.
MEDIA-007	FOUNDATION	Public media SHOULD use cacheable content-addressed or versioned URLs.
MEDIA-008	FOUNDATION	Deleting referenced media MUST be blocked or use managed replacement/archival.
MEDIA-009	FOUNDATION	Images MUST have localized alternative text where meaningful.
MEDIA-010	FOUNDATION	Decorative images MUST use empty alternative text.
MEDIA-011	PHASE_2	Stream/VOD media records MUST store rights and provider status separately.
MEDIA-012	PHASE_3	Course files MUST require active entitlement.
MEDIA-013	PHASE_4	Social media MUST be moderation-compatible and rate-limited.
MEDIA-014	PHASE_5	Product media MUST preserve order snapshot references where needed.
MEDIA-015	FOUNDATION	Failed processing MUST expose retry/manual recovery and must not publish broken assets.

Exact size limits and allowed formats MUST be documented in configuration before implementation review.

20. Search, Filtering, Sorting, and Pagination
20.1 Searchable Domains
Content: title, summary, body-derived index, category, tag, game.
Games: localized name, aliases.
Tournaments: name, game, status, format, organizer, fee type.
Streams: title, channel, game, tournament, live state.
Courses/coaches: name, game, level, access type.
Social: approved public users, teams, posts.
Products: localized name, category, SKU where authorized.
20.2 Search Behavior
Search MUST be locale-aware.
Persian normalization MUST handle common character variants without altering stored content.
Exact identifiers MAY use exact match.
Private, unpublished, suspended, or unauthorized resources MUST not appear.
Search results MUST identify type and relevant state.
Invalid filters MUST return 400.
Empty queries MAY return curated discovery instead of all data, depending on page.
Query and filter state MUST synchronize with the URL.
20.3 Pagination
Public and transactional APIs SHOULD use cursor pagination.
Administrative tabular lists MAY use cursor or page-based pagination where stable and documented.
Default page size: 20.
Maximum ordinary page size: 100.
Exports MUST use asynchronous jobs for large datasets.
Stable secondary sort by ID MUST prevent duplicate/missing records between pages.
21. Accessibility Requirements

Target: WCAG 2.2 AA.

ID	Requirement and acceptance
A11Y-001	Semantic HTML and landmark regions MUST be used; automated and manual inspection passes.
A11Y-002	Every action MUST be keyboard operable without a pointer.
A11Y-003	Focus MUST be visible and meet contrast requirements.
A11Y-004	Form controls MUST have persistent accessible labels and associated errors.
A11Y-005	Validation summaries and asynchronous errors MUST be announced.
A11Y-006	Dialogs/drawers MUST trap focus appropriately, expose names, and restore focus.
A11Y-007	Heading hierarchy MUST be logical and contain one primary page heading.
A11Y-008	Text and interactive-state contrast MUST meet WCAG AA.
A11Y-009	Meaningful images require localized alternative text.
A11Y-010	Reduced-motion preference MUST disable nonessential animation.
A11Y-011	Pages MUST reflow at 400% zoom without loss of core functionality.
A11Y-012	Touch targets SHOULD meet WCAG 2.2 target-size guidance.
A11Y-013	A skip link MUST be available on repeated-navigation layouts.
A11Y-014	Data tables MUST use captions/headers and responsive alternatives.
A11Y-015	Brackets MUST have a keyboard/screen-reader accessible list or table equivalent.
A11Y-016	Live updates MUST avoid excessive announcements and expose controlled status regions.
A11Y-017	Video MUST support captions when provided/required and accessible player controls.
A11Y-018	Accessibility tests MUST run in Persian RTL and English LTR.
22. Responsive Design Requirements
22.1 Representative Viewports
Category	Representative width
Small mobile	320–374 px
Mobile	375–767 px
Tablet	768–1023 px
Laptop	1024–1439 px
Desktop	1440–1919 px
Large desktop	1920 px and above
22.2 Behavior
No page may create unintended horizontal scrolling at 320 CSS pixels.
Public navigation MUST collapse into mobile navigation below the design-system breakpoint.
Administration navigation MUST support compact drawer/rail behavior.
Multi-column forms MUST collapse to one column on narrow screens.
Tables MUST use priority columns, scrolling containers, cards, or detail expansion without losing actions.
Brackets MUST support pan/zoom and an accessible list fallback.
Modals MUST become full-height sheets where required on mobile.
Sticky actions MUST not obscure content or focus.
Touch and pointer interactions MUST both work.
Landscape orientation MUST not block authentication, bracket, match, stream, course, or checkout journeys.
Responsive behavior MUST be verified in both RTL and LTR.
23. Visual and Design-System Requirements
23.1 Direction

The design MUST be:

Modern and professional.
Gaming-appropriate without impairing information clarity.
Suitable for public discovery and dense administration.
Compatible with light and dark themes.
Responsive and accessible.
Capable of glass-inspired surfaces where contrast, performance, and readability remain acceptable.
Based on rounded, contemporary geometry.
Able to use purple, violet, magenta, neon blue, and orange accent families.

Exact color values, fonts, radii, shadows, gradients, and motion durations are provisional design tokens requiring design approval.

23.2 Design-System Requirements
Tokens MUST cover color, typography, spacing, radius, elevation, motion, z-index, and breakpoints.
Semantic tokens MUST be used instead of raw component colors.
Light and dark themes MUST meet contrast requirements.
Components MUST define default, hover, active, focus, disabled, loading, success, warning, destructive, and selected states.
Status colors MUST not be the only carrier of meaning.
Glass effects MUST provide a solid/high-contrast fallback.
Reduced-motion mode MUST be included.
Icons MUST have consistent geometry and accessible labels where actionable.
Theme and locale switching MUST not cause unusable layout shift.
Administrative density MUST use compact variants without reducing touch/keyboard accessibility.
24. SEO Requirements
ID	Tags	Requirement
SEO-001	PHASE_1	Public indexable pages MUST have localized unique titles and meta descriptions.
SEO-002	PHASE_1	Canonical URLs MUST be emitted consistently.
SEO-003	PHASE_1	Persian and English alternates MUST use correct hreflang.
SEO-004	PHASE_1	Open Graph and supported social metadata MUST use localized content and approved media.
SEO-005	PHASE_1	XML sitemaps MUST include published indexable resources and locale alternates.
SEO-006	PHASE_1	robots.txt MUST distinguish production from nonproduction environments.
SEO-007	PHASE_1	Structured data SHOULD be provided for articles, breadcrumbs, events/tournaments, courses, and products where semantically valid.
SEO-008	PHASE_1	Unpublished, private, account, admin, payment, and personalized pages MUST be non-indexable.
SEO-009	PHASE_1	Redirects MUST preserve approved slug changes and locale equivalents.
SEO-010	PHASE_1	404 responses MUST return an actual 404 status and useful localized navigation.
SEO-011	FOUNDATION	Public server-rendered or equivalent crawlable output MUST expose meaningful content without requiring unsupported crawler execution.
SEO-012	FOUNDATION	SEO validation MUST run against production builds.
25. Performance Requirements

Targets apply to the approved initial scale of up to 1,000 participants or teams in a tournament. Broader traffic and storage assumptions may be tuned without weakening this baseline.

ID	Tags	Provisional target
PERF-001	PHASE_1	Public cached page server response p75 SHOULD be ≤500 ms under agreed normal load.
PERF-002	FOUNDATION	Nonreporting API reads p95 SHOULD be ≤800 ms under agreed normal load.
PERF-003	FOUNDATION	Ordinary writes excluding external-provider wait p95 SHOULD be ≤1,200 ms.
PERF-004	PHASE_1	Tournament lists and admin queues MUST remain paginated and MUST NOT load unbounded collections.
PERF-005	PHASE_1	Standings/bracket recalculation MUST complete synchronously within 2 seconds for approved ordinary tournament size or move to observable asynchronous processing.
PERF-006	FOUNDATION	Public pages SHOULD meet Core Web Vitals “good” thresholds at the 75th percentile on representative mobile where external embeds are excluded or separately measured.
PERF-007	FOUNDATION	Images MUST use responsive sizing, lazy loading below the fold, and optimized formats where supported.
PERF-008	FOUNDATION	Route-level code splitting MUST prevent disabled later-phase modules from inflating Phase 1 public bundles.
PERF-009	FOUNDATION	Static/public content SHOULD use cache/CDN behavior with correct invalidation.
PERF-010	FOUNDATION	Database queries used by ordinary lists MUST avoid unbounded scans and N+1 behavior.
PERF-011	PHASE_2	Stream page performance MUST measure player-provider startup separately from Dragon page load.
PERF-012	PHASE_2	Chat MUST remain usable under the approved room concurrency with backpressure/rate limits.
PERF-013	PHASE_5	Checkout and ledger posting MUST prioritize correctness over optimistic client completion.
PERF-014	FOUNDATION	Load tests MUST validate OTP, tournament registration final-slot contention, bracket progression, notifications, payments, and transfers.
26. Security Requirements
ID	Requirement
SEC-001	All production traffic MUST use TLS.
SEC-002	Input MUST be validated by type, range, length, format, and authorization context.
SEC-003	Output encoding and content sanitation MUST prevent XSS.
SEC-004	Data access MUST prevent injection through parameterized queries or equivalent controls.
SEC-005	Resource ownership and scope checks MUST prevent insecure direct-object references.
SEC-006	Browser authentication MUST include CSRF protection appropriate to the session design.
SEC-007	CORS MUST use an explicit production allowlist.
SEC-008	Secure headers MUST include appropriate content-security, frame, MIME, referrer, and transport controls.
SEC-009	OTP, login, recovery, search, uploads, chat, transfers, and checkout MUST have tailored rate limits.
SEC-010	OTP and recovery flows MUST prevent account enumeration.
SEC-011	Secrets MUST be injected through approved secret management and never committed.
SEC-012	Logs, audit, analytics, and errors MUST redact OTPs, tokens, provider secrets, and unnecessary personal data.
SEC-013	File uploads MUST use signature validation, scanning, private staging, and controlled publication.
SEC-014	Administrative access MUST use least privilege and periodic review.
SEC-015	Super-admin and finance operations SHOULD require stronger authentication and protected devices.
SEC-016	Dependency and container-image scanning MUST run in CI.
SEC-017	Critical/high known vulnerabilities MUST block release unless formally risk-accepted.
SEC-018	Production error responses MUST not disclose stack traces, SQL, secrets, or internal topology.
SEC-019	Payment and webhook callbacks MUST be authenticated and replay-protected where provider capabilities allow.
SEC-020	Financial writes MUST be idempotent and auditable.
SEC-021	Dragon Coin transfer abuse controls MUST support configurable limits, holds, and manual review.
SEC-022	Session fixation and token theft mitigations MUST be implemented.
SEC-023	Sensitive contact and financial data MUST be encrypted at rest through approved infrastructure controls.
SEC-024	Persistent MongoDB volumes, exports when manually created, and migration artifacts MUST be access-controlled; application-managed backup and restore testing is not required in the current scope.
SEC-025	Provider credentials MUST use minimum required scope and support rotation.
SEC-026	Authorization tests MUST cover every administrative API group.
SEC-027	Bracket and result mutations MUST use optimistic concurrency and immutable history.
SEC-028	Search and analytics MUST not leak restricted records.
SEC-029	Security events MUST generate alerts according to severity.
SEC-030	A prelaunch security review and penetration test MUST cover authentication, authorization, payments, uploads, administration, and financial workflows.
27. Privacy, Legal, and Compliance
27.1 Data Categories
Account and contact data.
Birth date and age-policy status.
Player and game identities.
Team membership.
Tournament registration and custom answers.
Payment and transaction references.
Dragon Coin activity.
Prize and payout data.
Shipping information.
Course progress.
Social and chat content.
Reports and moderation evidence.
Device/session/security information.
Analytics data subject to consent policy.
27.2 Requirements
Data collection MUST be minimized to an identified purpose.
Required versus optional fields MUST be clear.
Privacy notice and terms versions MUST be recorded when accepted.
Consent MUST not be bundled where separate choice is legally required.
Account export and deletion requests MUST be supported subject to approved policy.
Deletion MUST preserve records that must remain for financial, security, tournament-integrity, or legal reasons, while removing or anonymizing unnecessary personal data.
Cookie and nonessential analytics behavior MUST follow DEC-043 and remain activation-gated by the selected analytics tool decision OD-026.
Minimum-age wording MUST reflect DEC-003 and DEC-041. No custom guardian-consent workflow is required, while mandatory applicable law remains controlling.
Dragon Coin follows DEC-044 and DEC-049. A general internal Toman wallet is prohibited by DEC-050. Cash-prize configuration and manual settlement follow DEC-045 without requiring an external payout provider.
Legal claims such as “regulated wallet,” “cryptocurrency,” “investment,” or “cash equivalent” MUST NOT be used without approval.
Dragon Coin terms MUST clearly state that it cannot be redeemed or sold back to Dragon Ecosystem.
Store terms MUST state domestic shipping scope and approved refund/support behavior.
Stream and VOD publication MUST require rights confirmation under OD-014.
Retention MUST be defined by data class and approved before production launch.
28. Logging, Monitoring, and Auditability
28.1 Application Logging

Logs MUST contain:

UTC timestamp.
Level.
Service/module.
Environment.
Correlation ID.
Request/job/event ID.
Safe actor/account reference where appropriate.
Safe resource reference.
Error code and stack trace in protected server logging only.

Logs MUST NOT contain:

OTP value.
Session/access token.
Payment credentials.
Provider secret.
Full sensitive registration answers unless explicitly protected.
Unnecessary full phone/email/address.
28.2 Metrics

Required operational metrics include:

Request rate, latency, error rate, and saturation.
Authentication requests, OTP failures, and rate limiting.
Registration volume, approval queues, capacity conflicts.
Bracket job duration and failures.
Notification queue and delivery failures.
Payment pending/unknown/callback failures.
Ledger reconciliation differences.
Dragon Coin transfer failures/holds.
Provider integration failures.
Background-job queue depth and age.
Database health and connection use.
MongoDB persistence restart evidence and migration rollback/forward-fix status.
Search indexing lag.
Stream sync and chat moderation load in Phase 2.
28.3 Alerts

Alerts MUST exist for:

Authentication/SMS provider outage.
Payment callback failure or prolonged pending state.
Ledger imbalance or reconciliation difference.
Registration overbooking attempt.
Bracket/progression inconsistency.
Repeated failed job/dead-letter growth.
Database or storage capacity risk.
MongoDB persistence failure or migration incompatibility.
Elevated authorization failures.
Error-rate/latency breach.
Arvan streaming sync failure in Phase 2.
28.4 Health Checks
Liveness MUST test process viability only.
Readiness MUST test required local dependencies without causing heavy load.
External-provider degradation SHOULD be represented separately from instance readiness unless the service cannot safely operate without it.
29. Error Handling
Error class	HTTP/status behavior	User behavior	Operational behavior
Validation	400 or 422	Localized field messages, input preserved	No error alert unless anomalous
Unauthenticated	401	Login/reverification path	Security telemetry
Forbidden	403	Safe explanation or hidden resource	Repeated attempts may alert
Not found	404	Localized recovery/navigation	No stack trace
Conflict	409	Refresh/review current state	Record conflict metric
Rate limit	429	Retry guidance where safe	Rate-limit telemetry
Provider pending	Business pending state	Processing/status page	Retry/reconciliation job
Provider unavailable	503 or domain degraded state	Safe retry/alternative	Alert and correlation
Unexpected server error	500	Generic localized message and correlation ID	Protected exception logging
Maintenance	503	Localized maintenance page	Health/status integration
Automatic retries MUST be limited to safe/idempotent operations.
Financial and tournament writes MUST never be blindly retried without idempotency.
Frontend error boundaries MUST preserve navigation and report correlation IDs.
Unexpected browser console errors and unhandled promise rejections are release blockers.
30. Testing Requirements
ID	Tags	Requirement
TEST-001	FOUNDATION	Unit tests MUST cover domain rules, state transitions, money conversion, and permission policies.
TEST-002	FOUNDATION	Component tests MUST cover shared UI states in RTL/LTR and light/dark themes.
TEST-003	FOUNDATION	Integration tests MUST cover database constraints, transactions, outbox, jobs, and provider adapters.
TEST-004	FOUNDATION	API contract tests MUST cover success, validation, auth, forbidden, conflict, rate limit, and idempotency.
TEST-005	PHASE_1	Authentication tests MUST cover OTP expiry, reuse, attempts, resend, enumeration, recovery, and session revocation.
TEST-006	PHASE_1	Tournament tests MUST cover capacity contention, waitlist, custom questions, approvals, cancellation, refunds, and roster snapshots.
TEST-007	PHASE_1	Each competition format MUST have deterministic fixtures and progression/standings tests.
TEST-008	PHASE_1	Bracket tests MUST cover generation, edit, validation, lock, regeneration, result correction, and rollback.
TEST-009	FOUNDATION	Financial tests MUST prove exact integer arithmetic, balanced postings, idempotency, reversals, and reconciliation.
TEST-010	PHASE_1	Dragon Coin tests MUST cover purchase, grant, spend, transfer, insufficient funds, hold, duplicate request, and no cash-out.
TEST-011	FOUNDATION	Localization tests MUST validate key completeness and localized content requirements.
TEST-012	FOUNDATION	Browser tests MUST run major journeys in fa RTL and en LTR.
TEST-013	FOUNDATION	Automated accessibility tests and manual keyboard/screen-reader review MUST be completed.
TEST-014	FOUNDATION	Security tests MUST cover OWASP-relevant risks, authorization matrices, rate limits, uploads, and secrets.
TEST-015	FOUNDATION	Production builds MUST be tested, not only development servers.
TEST-016	FOUNDATION	Docker build, startup, migrations, seed behavior, health, and shutdown MUST be tested.
TEST-017	FOUNDATION	Direct URL refresh MUST work for public, account, and administration routes.
TEST-018	FOUNDATION	Loading, empty, success, validation, conflict, forbidden, not-found, rate-limit, and unexpected-error states MUST be tested.
TEST-019	FOUNDATION	Browser runs MUST assert no unexpected console errors or failed network requests.
TEST-020	PHASE_2	Streaming tests MUST use provider sandbox/stubs plus at least one contracted Arvan integration test.
TEST-021	PHASE_2	Chat tests MUST cover ordering, duplicate delivery, rate limit, timeout, ban, and report evidence.
TEST-022	PHASE_3	Course tests MUST cover free/paid entitlement, progress, completion, and revocation.
TEST-023	PHASE_4	Social tests MUST cover visibility, following, moderation, block/mute when enabled, and feed filtering.
TEST-024	PHASE_5	Commerce tests MUST cover stock contention, discounts, checkout idempotency, fulfillment, and financial reconciliation.
TEST-025	FOUNDATION	Persistence tests MUST prove MongoDB data survives normal Compose stop/start and application redeployment; no backup-restore test is required.
TEST-026	FOUNDATION	Release regression and smoke suites MUST be automated.
30.1 Critical Browser-Test Matrix
Register/login by OTP.
Complete profile and game identity.
Create team, invite member, accept, transfer ownership, leave/remove.
Register individual for free tournament.
Register team for paid mixed-fee tournament.
Automatic and manual approval.
Administrator waitlist and promotion.
Single-elimination progression.
Double-elimination progression using selected profile.
Round-robin standings and tiebreak.
Swiss pairings and standings using selected profile.
Manual/custom competition.
Bracket edit/lock/regenerate/rollback.
Result correction and downstream recalculation.
Content localized publish.
Notification preference and delivery-state display.
Dragon Coin purchase/transfer when enabled.
Account recovery.
Admin forbidden-access tests.
Phase 2 stream/watch/chat/moderation.
Phase 3 free/paid enrollment and progress.
Phase 4 feed interaction and report.
Phase 5 cart/payment/order/fulfillment.
Account deletion/export request.
Both themes, both locales, representative mobile/tablet/desktop viewports.
31. Browser and Device Support

Required test targets:

Current and previous major Chromium.
Current and previous major Firefox.
Current and previous major WebKit/Safari equivalent.
Mobile Chromium viewport.
Mobile WebKit viewport where test infrastructure supports it.
Desktop Chromium viewport.
Touch and keyboard input.
320 px minimum viewport.
High zoom and reduced motion.

Unsupported browsers MUST receive graceful degradation rather than silent corruption. Core content and account recovery SHOULD remain accessible where modern visual enhancements are unavailable.

32. Technical and Architectural Constraints
32.1 Architecture
The system SHOULD begin as a modular monolith or similarly cohesive deployable architecture with enforceable domain boundaries.
Modules MUST NOT access another module’s persistence tables directly except through an approved shared data-access boundary.
Domain boundaries MUST include identity, profile, content, games, teams, tournaments, competition, notifications, moderation, media, payments, ledger, education, social, commerce, and operations.
Later service extraction MUST be possible through stable APIs/events.
Authoritative transactional storage MUST support atomic transactions, uniqueness constraints, indexes, and exact integer arithmetic.
MongoDB 8.x is the required transactional database for the current implementation because the verifier and approved stack policy take precedence over earlier database-neutral wording.
A transactional outbox or equivalent is mandatory.
Background jobs and scheduled jobs MUST be supported.
Search MAY begin with database-supported search if it meets requirements, but the search interface MUST allow future external indexing.
Cache use MUST not make authorization or financial state stale beyond safe limits.
Object/media storage MUST use approved Arvan Cloud services through an abstraction.
Streaming provider integration MUST use an adapter.
32.2 Code Quality
Production code MUST use a typed language or enforce equivalent static type checking.
API schemas MUST be machine-readable.
Database migrations MUST be version controlled.
Linting, formatting, type checks, tests, and security scans MUST run in CI.
Modules MUST expose explicit interfaces.
Generated code MUST be reproducible.
No unapproved temporary mocks may exist in production paths. The deterministic payment and SMS adapters approved by DEC-040 and DEC-041 are valid current-scope implementations and MUST remain isolated behind provider interfaces.
Feature placeholders MUST either be removed or clearly disabled without presenting false functionality.
32.3 Environment Configuration
Development, test, staging, and production configurations MUST be separate.
Secrets MUST not use checked-in environment files.
Configuration validation MUST fail startup when required values are missing.
Provider adapters MUST support sandbox/test credentials.
Phase activation MUST be configurable but server-enforced.
33. External Integrations
ID	Tags	Service	Purpose/data	Failure, security, and testing
INT-001	PHASE_1	Mock SMS adapter	Mobile OTP and approved tournament SMS; mobile, template variables, deterministic delivery status	No external network call; bounded retry simulation, masked logs, failure injection, and test inbox required.
INT-002	PHASE_1	Mock payment adapter	Toman payment intent, signed mock callback, final success/failure, reconciliation	No external network call; deterministic scenarios, idempotency, unknown-state recovery, and reconciliation tests required. Dragon Coin refund flow is intentionally absent.
INT-003	PHASE_1	Email provider, OD-003	Verified transactional email	Provider adapter, retries, bounce status where supported, no unverified send.
INT-004	PHASE_2	Arvan Cloud Video/Live	Live delivery, player/embed, provider resource, optional VOD/archive, provider analytics	Machine credential with minimum scope; API/player capability validated in sandbox; degraded mode and reconciliation required.
INT-005	FOUNDATION	Arvan Cloud hosting services	Dockerized Vue web, Node.js API/worker, MongoDB 8.x persistence, object storage/CDN as needed	Version-controlled deployment, private networking where available, secrets, health, scaling, persistence, and rollback/forward-fix tests. Exact product SKU is deployment configuration, not an implementation blocker.
INT-006	PHASE_4	Push provider, OD-027	Web/mobile push	Token privacy, opt-in, invalid-token cleanup, retries, sandbox.
INT-007	FOUNDATION	Analytics/error monitoring, OD-026	Product events, errors, performance	Consent-aware, redacted, non-authoritative, environment separation.
INT-008	PHASE_5	Shipping carrier(s), OD-019	Domestic shipment booking/status	Provider adapter, timeout/retry, no order corruption, sandbox where available.
INT-009	OPTIONAL	Game/publisher APIs	Game identity or tournament data verification	Explicit game-specific approval, rate limits, caching, privacy, and fallback.
33.1 Selected Streaming Approach

The target Phase 2 approach is:

Dragon Ecosystem manages stream identity, schedule, channel/streamer relationships, tournament/match/game relationships, access rules, notifications, chat, moderation, and operational state.
Arvan Cloud provides video delivery and the embedded/player experience.
Dragon SHOULD automate Arvan resource management through the available API when the contracted sandbox proves the required capability.
Manual provider provisioning MAY be retained as an operational fallback.
VOD archive is configurable per stream and depends on rights and contracted functionality.
Provider-specific identifiers remain internal and MUST not replace Dragon IDs.

This choice avoids building a native streaming CDN while preserving provider replaceability. Official Arvan documentation describes live streaming, VOD, player, secure-link, and API-managed video resources, but exact production capabilities MUST be contractually and technically validated.

34. Docker and Environment Requirements
34.1 Required Services

The local and production-like environment MUST support:

Web/frontend service.
Application/API service.
Background worker.
Scheduler.
Transactional database.
Cache if required.
Object-storage-compatible development service or approved test substitute.
Search component if separate.
Mail/SMS/payment/stream provider test adapters.
Observability components appropriate to development/testing.
34.2 Dockerfiles
Production images MUST use multistage builds.
Runtime images MUST exclude build-only tools.
Containers MUST run as nonroot where supported.
Images MUST define health behavior.
Builds MUST be reproducible and pin controlled dependencies.
Secrets MUST not be copied into image layers.
Images MUST be scanned before release.
34.3 Docker Compose

Development Compose MUST define:

Service dependencies.
Named volumes.
Internal networking.
Health checks.
Environment-variable injection.
Database initialization and migrations.
Optional development seed.
Provider stubs.
Startup ordering based on health, not fixed sleeps.
Graceful shutdown.
34.4 Migrations and Seeds
Migrations MUST run through an explicit release step or controlled startup job.
Multiple replicas MUST not race migrations.
Production seed MUST contain only required system configuration and roles.
Demonstration data MUST never be automatically inserted into production.
Seed operations MUST be idempotent.
34.5 Environment Variables

ENVIRONMENT_VARIABLES.md MUST document:

Name.
Purpose.
Required environments.
Secret status.
Allowed format.
Default, if safe.
Rotation procedure.
Owning module.
35. Deployment and Release Requirements
35.1 Environments
Development.
Automated test.
Staging.
Production.

Staging SHOULD use production-equivalent topology and provider sandboxes.

35.2 Deployment
Infrastructure MUST be reproducible through infrastructure-as-code or equivalent version-controlled automation.
Application deployment MUST use immutable build artifacts.
Database migrations MUST be checked before application activation.
Release MUST include compatibility validation and an explicit rollback or forward-fix checkpoint for risky migrations.
Readiness checks MUST pass before traffic.
Deployment MUST support rollback of application version.
Schema rollback MUST follow migration-specific safety plans.
User-visible maintenance MUST be localized when zero-downtime is not practical.
Public domain and TLS configuration MUST be verified.
CDN/cache invalidation MUST be controlled.
Feature flags MUST allow risky integrations to remain disabled after deployment.
35.3 Release Checks

Before production:

CI passes.
Production build passes.
Container scans pass.
Migrations pass on production-like data.
Browser smoke tests pass in fa and en.
Accessibility checks pass.
Security review passes.
Provider sandbox tests pass.
MongoDB persistence restart evidence and migration rollback/forward-fix procedure are current.
Health/readiness pass.
No unexpected console/network error remains.
Traceability matrix is updated.
Open blocking decisions are resolved.
35.4 Postdeployment
Verify home, auth, content, game, tournament, registration, admin, notifications, and health.
Verify provider connectivity.
Monitor error, latency, jobs, database, and callbacks.
Confirm no migration or reconciliation alert.
Record release evidence and responsible approver.
36. Required Documentation
ID	Required document
DOC-001	README.md with product/module overview
DOC-002	Local-development setup
DOC-003	Docker and Docker Compose guide
DOC-004	Environment-variable reference
DOC-005	Production-build and deployment guide
DOC-006	Database schema and migration guide
DOC-007	Architecture and module-boundary overview
DOC-008	API documentation and generated schema
DOC-009	Domain-event catalog
DOC-010	Authentication and authorization model
DOC-011	Tournament-rule and competition-engine guide
DOC-012	Financial ledger, Dragon Coin, payment, refund, and reconciliation guide
DOC-013	Localization and RTL guide
DOC-014	Instructions for adding a new locale
DOC-015	Content/media authoring guide
DOC-016	Test and browser-test instructions
DOC-017	Accessibility verification guide
DOC-018	Security and secret-rotation guide
DOC-019	MongoDB persistence, data export, and migration rollback/forward-fix guide
DOC-020	Operational runbooks and alert response
DOC-021	Provider-integration guides
DOC-022	REQUIREMENTS_TRACEABILITY.md
DOC-023	Release and rollback checklist
DOC-024	Staff role and permission handbook
37. Requirement Traceability Expectations

The implementation team MUST create and maintain REQUIREMENTS_TRACEABILITY.md.

Each row MUST include:

Requirement ID.
Requirement text summary.
Phase tags.
Implementation status.
Implementation files/modules.
Database migration or schema evidence.
Automated unit/component/integration/API tests.
Browser tests.
Verification command.
Evidence location.
Responsible reviewer.
Review status.
Deferred/open-decision reference where applicable.

Allowed statuses:

Not started.
In progress.
Implemented.
Verified.
Deferred by phase.
Blocked by open decision.
Not applicable with approved reason.

A requirement MUST NOT be marked verified without reproducible evidence.

38. Acceptance Test Matrix
Requirement	Tags	Scenario	Preconditions	Test steps	Expected result	Level	Locale	Viewport	Priority
AUTH-001	P1	New OTP registration	Valid Iranian mobile	Request and verify OTP	One active account/session	API/E2E	fa,en	Mobile	Critical
AUTH-003	P1	Reuse OTP	OTP already used	Submit same OTP	Rejected without new session	API/Security	fa,en	Any	Critical
UC-002	P1	Complete profile	Active account	Submit valid profile/game ID	Profile saved and usable	E2E	fa,en	Mobile/Desktop	Critical
TEAM-004	P1	Team invitation	Owner and eligible user	Invite and accept	Active membership once	API/E2E	fa,en	Mobile/Desktop	High
TEAM-007	P1	Ownership transfer	Active owner/member	Transfer ownership	Exactly one new owner	Integration/E2E	fa,en	Desktop	Critical
TOURN-005	P1	Final capacity race	One slot remains	Submit two concurrent entries	One accepted; other full/waitlisted	Integration	en	API	Critical
TOURN-010	P1	Roster snapshot	Team registration submitted	Change team membership	Registration roster unchanged	Integration/E2E	fa,en	Desktop	Critical
TOURN-012	P1	Mixed fee	Configured Toman+coin fee	Submit registration	Exact fiat and coin components posted	Integration/E2E	fa,en	Mobile	Critical
TOURN-014	P1	Manual approval	Pending registration	Approve as assigned admin	Approved, audited, notified	E2E	fa,en	Desktop	Critical
TOURN-006	P1	Waitlist promotion	Full tournament and waitlist	Admin promotes after vacancy	Correct state/order/history	E2E	fa,en	Desktop	High
BRACKET-001	P1	Single elimination	Eligible entrants	Generate, lock, complete matches	Correct champion/progression	Integration/E2E	fa,en	Desktop	Critical
BRACKET-002	P1	Double elimination	Approved rule profile	Complete fixture	Progression matches profile	Integration/E2E	en	Desktop	Critical
BRACKET-003	P1	Round robin	Approved rule profile	Enter all results	Correct standings/tiebreak	Integration/E2E	fa,en	Desktop	Critical
BRACKET-004	P1	Swiss	Approved pairing profile	Run multiple rounds	Valid pairings/standings	Integration/E2E	en	Desktop	Critical
BRACKET-005	P1	Manual competition	Participants	Create custom matches	Valid schedule/results	E2E	fa,en	Desktop	High
BRACKET-010	P1	Regenerate version	Locked bracket exists	Regenerate with reason	New version; old retained	Integration/E2E	en	Desktop	Critical
BRACKET-014	P1	Rollback	Multiple versions	Roll back to prior	New active version referencing prior	Integration/E2E	en	Desktop	Critical
TOURN-022	P1	Correct result	Completed match	Correct with reason	History retained and standings recalculated	Integration/E2E	fa,en	Desktop	Critical
PAY-004	P1	Duplicate callback	Pending payment	Send success callback twice	One success/fulfillment	Integration	en	API	Critical
PAY-002	P1	Toman conversion	Valid amount	Convert/display/round trip	Exact rial retained	Unit/API	fa,en	Any	Critical
WALLET-003	P1	Balanced posting	Valid transaction	Attempt unbalanced entries	Rejected atomically	Unit/Integration	en	API	Critical
REWARD-005	P1	Coin transfer	Sufficient balance	Transfer twice same key	One debit and credit	Integration/E2E	fa,en	Mobile	Critical
REWARD-006	P1	No cash-out	Coin balance	Inspect UI/API	No redemption capability	Security/E2E	fa,en	Any	Critical
CONTENT-004	P1	Missing translation	Persian only draft	Attempt publish	Publication blocked	E2E	fa,en	Desktop	High
I18N-012	P1	RTL journey	Persian locale	Complete registration	Correct RTL and mixed IDs	E2E/Visual	fa	Mobile/Desktop	Critical
A11Y-015	P1	Accessible bracket	Locked bracket	Navigate by keyboard/screen reader	Full match info available	Manual/E2E	fa,en	Desktop	High
STREAM-006	P2	Stream access	Auth-only stream	Request anonymously/authenticated	Denied/allowed correctly	API/E2E	fa,en	Mobile/Desktop	Critical
CHAT-004	P2	Timeout	Active room	Moderator times out user	Send blocked for duration	Integration/E2E	fa,en	Desktop	High
EDU-010	P3	Paid enrollment	Published paid course	Pay and enroll	One entitlement/enrollment	Integration/E2E	fa,en	Mobile	Critical
SOCIAL-003	P4	Feed privacy	Hidden/blocked activity	Load feed	Activity excluded	Integration/E2E	fa,en	Mobile	Critical
COMMERCE-002	P5	Stock contention	One unit available	Two checkouts	One reservation succeeds	Integration	en	API	Critical
PAYOUT-006	P5	Dual control	High-risk payout	Initiator attempts approval	Self-approval blocked	Security/E2E	en	Desktop	Critical
OPS-004	Foundation	Persistence restart	Committed Mongo test data	Stop and restart approved Compose services without deleting volumes	Service returns and committed data remains available	Operational	en	N/A	Critical
SEC-026	Foundation	Admin authorization	Limited admin	Direct URL/API access	403, no data leakage	Security/E2E	fa,en	Desktop	Critical
39. Definition of Done

A phase or release is complete only when:

All mandatory requirements for that phase are implemented.
All mandatory acceptance criteria pass.
All required pages and states are complete.
All controls perform real authorized operations.
Persian and English journeys pass.
RTL and LTR layouts pass.
Translation completeness validation passes.
No raw translation key is visible.
No required user-facing string is hardcoded.
Automated unit, component, integration, API, and database tests pass.
Critical browser tests pass.
Accessibility checks and manual review pass.
Security review passes.
Production builds pass.
Docker execution and health checks pass.
Migrations pass in production-like conditions.
MongoDB persistence restart and migration rollback/forward-fix evidence is current.
No unexpected browser console error remains.
No unexpected failed network request remains.
Financial reconciliation tests pass for enabled financial capabilities.
Audit evidence exists for high-risk workflows.
Documentation and traceability are complete.
No unapproved temporary mock, false placeholder, dead control, or misleading production integration remains. The payment and SMS mocks approved by DEC-040/DEC-041 are valid production-scope adapter implementations for the current build.
No unresolved blocking open decision remains for the released capability.
Rollback and operational runbooks are approved.
40. Open Questions

Only unresolved material decisions remain here:

OD-003: Which transactional email provider is approved?
OD-006: Which game/publisher/federation rule profiles are approved for launch?
OD-007: Which tournament-refund policy templates are approved?
OD-008: Which tournament SMS messages are mandatory versus optional?
OD-013: Which Arvan Cloud live, VOD, player, API, secure-link, analytics, and SLA features are contractually available?
OD-014: What stream rights, archive duration, takedown, and geographic policies apply?
OD-015: What are the coach, content-ownership, course-refund, and commercial policies?
OD-016: Are quizzes/exercises mandatory at Phase 3 launch?
OD-017: What are the Phase 4 blocking, muting, appeal, and privacy defaults?
OD-018: Will direct messaging ever enter scope?
OD-019: Which domestic carriers, shipping prices, and fulfillment targets apply?
OD-020: What digital-product entitlement and revocation rules apply?
OD-023: What support hours and response targets apply?
OD-024: What moderation-appeal rules apply?
OD-026: Which analytics/error-monitoring services and consent behavior are selected?
OD-027: Which push provider and target platforms are selected?
OD-028: What username rules and change limits apply?
OD-029: What support evidence is required when both mobile and verified email are unavailable?
OD-030: Which user-to-user purchases may use Dragon Coin?
41. Requirement Summary
41.1 Baseline Requirement Counts
Category	Count
Product goals and non-goals (GOAL)	20
Confirmed decisions (DEC)	50
Assumptions (ASM)	15
Open decisions (OD)	19
Known constraints (CON)	10
Roles (ROLE)	28
Use cases (UC)	24
User journeys (JOURNEY)	10
Pages (PAGE)	68
Authentication (AUTH)	14
Internationalization (I18N)	12
Accessibility (A11Y)	18
Content (CONTENT)	12
Tournament (TOURN)	30
Bracket/competition (BRACKET)	18
Teams (TEAM)	12
Streaming (STREAM)	12
Chat (CHAT)	8
Education (EDU)	12
Social (SOCIAL)	12
Commerce (COMMERCE)	14
Payments (PAY)	12
Wallet/ledger (WALLET)	12
Rewards/Dragon Coin (REWARD)	8
Prizes/payouts (PAYOUT)	12
Notifications (NOTIF)	12
Media (MEDIA)	15
SMS (SMS)	10
Moderation (MOD)	10
Administration (ADMIN)	12
Audit (AUDIT)	8
Analytics (ANALYTICS)	10
Events/asynchronous processing (EVENT)	12
Operations (OPS)	14
Business rules (BR)	30
Forms (FORM)	22
Data entities (DATA)	90
API operations (API)	100
SEO (SEO)	12
Performance (PERF)	14
Security (SEC)	30
Testing (TEST)	26
Documentation (DOC)	24
External integrations (INT)	9
Total uniquely identified items	922
41.2 Critical Phase 1 Requirements
Mobile OTP identity and recovery.
Complete bilingual/RTL user experience.
Persistent teams and immutable roster history.
Individual/team registration with capacity, review, waitlist, and exact fees.
All five competition formats.
Versioned rule profiles and brackets.
Result history and deterministic progression.
Exact Toman/rial representation.
Shared payment and ledger foundations.
Dragon Coin separation, balanced transfers, and prohibition on cash redemption.
Role-scoped administration.
Audit, idempotency, notifications, provider recovery, security, Docker, deployment, and browser tests.
41.3 MVP/Phase 1 Scope

Phase 1 is not a content-only MVP. It is the complete launchable esports-content and tournament platform defined in Sections 5.2, 10, and 11. Paid tournament and Dragon Coin foundations use the approved mock payment/SMS adapters and decisions DEC-044, DEC-045, DEC-049, and DEC-050; only capability-specific unresolved decisions remain feature-gated.

41.4 Future Requirements
Phase 2: Arvan-delivered streaming, VOD, highlights, and moderated live chat.
Phase 3: Free/paid academy, lessons, coaches, progress, and reviews.
Phase 4: Social feed, follows, posts, comments, reactions, advanced teams, privacy, and expanded moderation.
Phase 5: Store, inventory, orders, domestic fulfillment, full payment/wallet operations, rewards, prizes, payouts, and financial reporting.
Optional/future: push providers, game APIs, exercises, paid stream access, direct messaging only if approved.
41.5 External Dependencies
Approved in-repository mock SMS adapter.
Approved in-repository mock payment adapter.
Transactional email provider.
Arvan Cloud infrastructure.
Arvan Cloud live/video platform.
Future push provider.
Future domestic shipping carriers.
Analytics/error-monitoring tooling.
Game/publisher APIs where approved.
41.6 Unresolved Decision Summary

Nineteen named open decisions remain. Core mock-paid tournaments, Dragon Coin closed-loop operations, and manual cash-prize settlement are not blocked by provider selection. Only the specific capabilities tied to the remaining open decisions MUST remain feature-gated.
