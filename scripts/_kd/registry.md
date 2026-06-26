
# Harvest Client & Project Context
*Reference for meeting note categorization (e.g. Read.ai → ContextNest)*

---

## How to Use This Document

Use participant email domains to identify which client a meeting belongs to, then assign the corresponding Harvest project code as the meeting tag. **Apply the Client Identification Rules below first** — they handle the cases where a simple domain lookup is wrong (John-only meetings, owned businesses, brand aliases).

---

## Client Identification Rules

Apply these in order, before the raw email-domain lookup:

1. **Client domain present wins.** If any attendee's email domain matches a billable client below, that determines the client. If an end-client domain is *also* present (e.g. `nm.org` under Laughlin Constable, `aventiv.com` under Goods & Services), tag both the billing client and the sub-client.

2. **John-only / no client present → Chameleon Collective.** If the only "internal" attendees are John's own domains (`jhsconsulting.net`, `chameleon.co`) and there is **no** billable-client domain on the invite, tag the meeting to **Chameleon Collective (CC-OPS)**. Then read the meeting context AND the *other* attendees' email domains to classify the topic:
   - external partner/vendor on the call → `partnership`
   - hiring / candidate / talent discussion → `recruiting`
   - prospect / lead / new-business → `sales-strategy`

   This rule **overrides** the literal `jhsconsulting.net → JHS Digital` lookup. `JDC-OPS` is reserved only for purely internal JHS admin/ops with no external attendees.

3. **Owned-business context wins over vendor domains.** Meetings about an owned business (Rocky Point Rentals, Silva Method Atlanta, NE Seed) tag to that business even when the other attendees are outside vendors/partners with their own domains (e.g. a rentals marketing vendor → still Rocky Point Rentals).

### Aliases & Brand Names
- **Eldercare Alliance** = a brand name of **Transforming Age**. Tag ONLY `#client_transforming-age #project_tama`. **Never** emit `#subclient_eldercare-alliance` and never put Eldercare in `end_client` — it is the same legal client, not a sub-client.
- **Headway** = a **direct billing client** (see its entry below). Even when the only other attendee is a Headway person and John is on his own domain, tag `#client_headway` — Rule 2 (Chameleon fallback) does NOT apply to Headway.
- **DP Seeds** = **NE Seed** (NESO). Tag `#client_ne-seed #project_neso`.
- **Uniform** = a *partner* of Chameleon Collective (not a client). Chameleon meetings with Uniform → `#client_chameleon-collective #project_cc-ops #topic_partnership` + free-form `#uniform`.
- **ContextNest / PromptOwl** = partnership context under Chameleon Collective (not standalone clients).

---

## Email Domain → Client Quick Lookup

| Email Domain(s) | Client | Billing Client | Project(s) |
|----------------|--------|----------------|------------|
| `orlandohealth.com` | Orlando Health | Orlando Health | 2026 Martech Staffing (OH26MT) |
| `centurycommunities.com` | Century Communities | Century Communities | Marketing Tech Optimization (CCMTO) |
| `laughlin-constable.com` | Laughlin Constable | Laughlin Constable | ALZ RFP (LCALZ) |
| `nm.org` | Northwestern Medicine | Laughlin Constable | NM.org RFP (no Harvest project yet) |
| `radicaldesign.co` | Radical Design | Radical Design | GA Core Website Redesign (RDGCRD), GA Core Support (RDGCS) |
| `georgiacore.org` | Georgia Core | Radical Design | GA Core Website Redesign (RDGCRD) |
| `goodsandservicesatl.com` | Goods & Services | Goods & Services | Aventiv WMS Support (GSAVS) |
| `aventiv.com`, `securustechnologies.com` | Aventiv / Securus | Goods & Services | Aventiv WMS Support (GSAVS) |
| `transformingage.org` | Transforming Age | Transforming Age | MSFT AI Audit (TAMA) |
| `immunotec.com` | Immunotec | Immunotec | Analytics Audit (ITAU) |
| `headway.co` *(confirm)* | Headway | Headway | (no active Harvest project yet) |
| `therapymatch.com` | Therapymatch | Therapymatch | Builder.io Ad Hoc Support (TMBS) |
| `builder.io` | Builder.io | — | Partner (Orlando Health / Martech 2026) |
| `vercel.com` | Vercel | — | Partner (Orlando Health / Martech 2026) |
| `chameleon.co` | Chameleon Collective | — | Internal network (CC-OPS) — also the **fallback** for John-only/no-client meetings (see Rule 2) |
| `jhsconsulting.net` | JHS Digital Consulting | — | Internal (JDC-OPS) — but John-only + external non-client → Chameleon (see Rule 2) |
| `rockypointlakeglenville.com` | Rocky Point Rentals | — | 35 Bluegill (RPR-OPS) |
| `silvamethodatlanta.com`, `silvamethod.com` | Silva Method Atlanta | — | SMA Operations (SMA-OPS) |

> **Domains marked *(confirm)*** — derived from context, not directly verified. Update as confirmed.

---

## Clients & Projects (Full Harvest List)

### Billable Client Work

#### Orlando Health
- **Harvest Client ID:** 14908923
- **Industry:** Healthcare
- **Relationship:** Via Chameleon Collective
- **Email Domain:** `orlandohealth.com`
- **John's access email:** john.schneider@orlandohealth.com
- **Projects:**
  - `OH26MT` — 2026 Martech Staffing | Fixed Fee $469,168 | Oct 2025–Sep 2026
    - Partners: Builder.io, Vercel

#### Laughlin Constable
- **Harvest Client ID:** 17492505
- **Industry:** Agency
- **Relationship:** Via Chameleon Collective
- **Email Domain:** `laughlin-constable.com`
- **Projects:**
  - `LCALZ` — ALZ RFP | T&M $300/hr | May–Jun 2026
- **Subclients:**
  - Northwestern Medicine (`nm.org`) — NM.org RFP *(no Harvest project yet)*

#### Century Communities
- **Harvest Client ID:** 17502115
- **Industry:** Real estate / Home building
- **Relationship:** Via Chameleon Collective
- **Email Domain:** `centurycommunities.com`
- **Key Contact:** Chris Formes (chris.formes@centurycommunities.com)
- **Projects:**
  - `CCMTO` — Marketing Tech Optimization | T&M | $18k budget | Mar 2026–ongoing (only active Century project)

#### Radical Design
- **Harvest Client ID:** 14912286
- **Industry:** Design agency
- **Relationship:** Via Chameleon Collective
- **Email Domain:** `radicaldesign.co`
- **John's access email:** jschneider@radicaldesign.co
- **Projects:**
  - `RDGCRD` — GA Core Website Redesign | T&M $250/hr | Apr–Jun 2026
  - `RDGCS` — GA Core Support | T&M | Oct 2024–Sep 2025
  - `RDQ424` — Consulting Retainer | Oct–Dec 2024
- **Subclients:**
  - Georgia Core (`georgiacore.org`) — primary end client

#### Goods & Services
- **Harvest Client ID:** 14310387
- **Industry:** Agency
- **Relationship:** Via Chameleon Collective
- **Email Domain:** `goodsandservicesatl.com` *(confirm)*
- **Projects:**
  - `GSAVS` — Aventiv WMS Support | T&M | Feb 2026–Dec 2026
- **Subclients:**
  - Aventiv / Securus (`aventiv.com`, `securustechnologies.com`) — technology/corrections. Topics like Cloudinary asset protection / WMS belong here.

#### Transforming Age
- **Harvest Client ID:** 17714480
- **Industry:** Senior living / Healthcare
- **Relationship:** Via Chameleon Collective
- **Email Domain:** `transformingage.org` *(confirm)*
- **Aliases:** **Eldercare Alliance** (brand name — tag as Transforming Age, NOT a separate sub-client)
- **Projects:**
  - `TAMA` — MSFT AI Audit | T&M $350/hr | $15k budget | May–Jun 2026
    - M365 Copilot governance audit

#### Immunotec
- **Harvest Client ID:** 16598355
- **Industry:** Health/MLM
- **Email Domain:** `immunotec.com`
- **Projects:**
  - `ITAU` — Analytics Audit | T&M $180/hr | $9k budget | Mar–Apr 2026

#### Headway
- **Industry:** *(confirm)*
- **Relationship:** **Direct billing client** — same level as Orlando Health, Transforming Age, Century Communities, and Immunotec. NOT a Chameleon Collective sub-client.
- **Email Domain:** `headway.co` *(confirm)*
- **Key Contact:** Ryan Crawford
- **Projects:**
  - No active Harvest project yet — relationship in development. Tag `#client_headway` with **no** project tag until a Harvest project code exists. Do NOT tag `#client_chameleon-collective` or `#subclient_headway`.

#### Therapymatch
- **Harvest Client ID:** 16605251
- **Industry:** Healthcare technology
- **Email Domain:** `therapymatch.com` *(confirm)*
- **Projects:**
  - `TMBS` — Builder.io Ad Hoc Support | T&M | $10k budget | Oct 2025–Sep 2026

#### Hackensack Meridian Health
- **Harvest Client ID:** 14917767
- **Industry:** Healthcare
- **Email Domain:** `hmhn.org` *(confirm)*
- **Projects:** None currently active

---

### Internal / Owned Businesses

| Client | Project | Code | Email Domain | Notes |
|--------|---------|------|-------------|-------|
| JHS Digital Consulting, LLC | JHS Digital Consulting | JDC-OPS | `jhsconsulting.net` | Primary consulting entity. Only for purely internal ops with no external attendees — otherwise see Rule 2. |
| Chameleon Collective | Chameleon Collective | CC-OPS | `chameleon.co` | Network ops, non-billable. Fallback for John-only/no-client meetings (partnership/recruiting/sales). |
| Silva Method Atlanta | SMA Operations | SMA-OPS | `silvamethodatlanta.com`, `silvamethod.com` | Owned business |
| Rocky Point Rentals | 35 Bluegill | RPR-OPS | `rockypointlakeglenville.com` | Rental property ops. Vendor/marketing meetings still tag here. |
| NE Seed | NE Seed Operations | NESO | — | Farm/seed business. Also referred to as **DP Seeds**. |
| Family | Parenting | FP | — | Personal time tracking |

---

### Inactive / No Current Projects

These clients exist in Harvest but have no active projects. Meetings with them may still occur.

| Client | Last Known Domain | Notes |
|--------|------------------|-------|
| Teradata | `teradata.com` | Data/analytics |
| Prophet | `prophet.com` | Consulting agency |
| ID Label | — | |
| Oasis Imports | — | |
| AlphaInsights | — | Expert network |
| GLG | `glginsights.com` | Expert network |
| Sagittarius Marketing | `sagittarius.agency` *(confirm)* | UK agency |

---

## Harvest Project Code Index

| Code | Project | Client |
|------|---------|--------|
| OH26MT | 2026 Martech Staffing | Orlando Health |
| LCALZ | ALZ RFP | Laughlin Constable |
| CCMTO | Marketing Tech Optimization | Century Communities |
| RDGCRD | GA Core Website Redesign | Radical Design |
| RDGCS | GA Core Support | Radical Design |
| RDQ424 | Consulting Retainer | Radical Design |
| GSAVS | Aventiv WMS Support | Goods & Services |
| TAMA | MSFT AI Audit | Transforming Age |
| ITAU | Analytics Audit | Immunotec |
| TMBS | Builder.io Ad Hoc Support | Therapymatch |
| NESO | NE Seed Operations | NE Seed |
| SMA-OPS | SMA Operations | Silva Method Atlanta |
| RPR-OPS | 35 Bluegill | Rocky Point Rentals |
| CC-OPS | Chameleon Collective | Chameleon Collective |
| JDC-OPS | JHS Digital Consulting | JHS Digital Consulting, LLC |
| FP | Parenting | Family |
