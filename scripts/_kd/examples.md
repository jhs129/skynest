
# Meeting Tagging Examples & Corrections

Few-shot guidance injected into the tagger prompt. Each example is a correction
captured during QA — add a new block whenever the tagger gets one wrong.

## Rules
- "OH Web Scrum" / "OH.com" / "OH" → billing client Orlando Health (OH26MT). Topic: scrum (or go-live for launch meetings).
- "ALZ.org" pitch/preso → billing client Laughlin Constable, sub-client ALZ.org, project LCALZ. Topic: proposal. Tag BOTH `#client_laughlin-constable` and `#subclient_alz-org`.
- "DP Seeds" → an alias for the owned business **NE Seed** (NESO). Tag `#client_ne-seed #project_neso`.
- Builder.io / Vercel are PARTNERS on Orlando Health (OH26MT), not clients — tag client Orlando Health + free-form `#builder-io` / `#vercel`.
- **No billable client present + only John's domains (`jhsconsulting.net`, `chameleon.co`) on the invite → Chameleon Collective (CC-OPS), never "unknown."** Read the context AND the *other* attendees' email domains to pick the topic: external partner/vendor → `partnership`; hiring/candidate/talent → `recruiting`; prospect/lead/new-business → `sales-strategy`.
- **HARD CORRECTION — Eldercare Alliance:** "Eldercare Alliance" is a brand name of **Transforming Age**, NOT a separate client or sub-client. Tag ONLY `#client_transforming-age #project_tama`. You must NEVER emit `#subclient_eldercare-alliance` (or any Eldercare sub-client tag). If a meeting mentions Eldercare Alliance, set `end_client` to null — do not put Eldercare in `end_client`.
- **HARD CORRECTION — Headway:** Headway is a **direct billing client** at the same level as Orlando Health, Transforming Age, Century Communities, and Immunotec. Tag `#client_headway`. NEVER tag Headway meetings as `#client_chameleon-collective` or `#subclient_headway`. There is no Harvest project yet, so leave `project` null (no project tag).
- Owned-business meetings (Rocky Point Rentals, Silva Method Atlanta, NE Seed) stay tagged to the business even when outside vendors/partners with their own domains are on the call.
- Don't invent sub-clients. Only tag a sub-client when it's a known end client under a billing agency (ALZ.org, Northwestern Medicine, Georgia Core, Aventiv/Securus).

## Examples
- ContextNest / PromptOwl partnership call → `#client_chameleon-collective #project_cc-ops #topic_partnership` + `#contextnest #promptowl`
- "Uniform — Healthcare Connect" (Uniform is a Chameleon partner) → `#client_chameleon-collective #project_cc-ops #topic_partnership` + `#uniform`
- "Yada — Marketing Mastermind" (rentals marketing vendor) → `#client_rocky-point-rentals #project_rpr-ops #topic_partnership` + `#short-term-rentals`
- "John / Kenny Connect" (Century Communities) → `#client_century-communities #project_ccmto #topic_strategy` + `#ai-roadmap`
- "Cloudinary Asset Protection" (Aventiv/Securus under Goods & Services) → `#client_goods-services #subclient_aventiv #project_gsavs #topic_development` + `#cloudinary`
- "Eldercare Alliance — Copilot Governance" → `#client_transforming-age #project_tama #topic_governance #topic_stakeholder-interview` (NO sub-client — Eldercare is a Transforming Age brand)
- "John & Ryan Connect — Headway Alignment" (Ryan Crawford is from Headway) → `#client_headway #topic_partnership #topic_sales-strategy` (Headway is a direct client — NOT Chameleon, NOT a sub-client; no project tag yet)
