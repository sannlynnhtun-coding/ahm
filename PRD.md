# Ahm Product Requirements — v6

## Product promise

Ahm is a free, staff-assisted loyalty workspace backed by each shop’s own Google Sheet. It is a static Blazor WebAssembly application. Ahm does not persist Google credentials, shop records, or customer records on an Ahm backend.

## Actors and trust

- Owners create or select the shop Sheet from a mobile browser.
- Staff select a Sheet shared with their Google account and operate the same staff workspace.
- Customers present an identifier QR. They do not view balances or select rewards themselves.
- Every Google Sheet Editor is a trusted operator. There are no application-only owner/cashier roles or PINs.

## Browser-to-Google architecture

```text
Owner/staff mobile browser
  ├─ Google Identity Services: drive.file token (memory only)
  ├─ Google Picker: choose a Sheet the user can access
  └─ Google Sheets/Drive REST APIs: direct authenticated calls
          └─ Shop-owned Google Sheet

Ahm static host
  ├─ serves Blazor/CSS/JS/privacy/terms
  ├─ legacy QR redirect (stateless)
  └─ temporary v2 Apps Script relay (never called by v3)
```

The public build contains only the OAuth client ID, restricted Picker API key, and project number. It contains no client secret. A token expires in memory and cannot be silently refreshed; writes stop until a user gesture reconnects Google.

## Schema v3

The required tabs are `Ahm_Meta`, `Shop_Config`, `Reward_Catalog`, `Event_Ledger`, and `Member_Summary`.

`Event_Ledger` is the transaction source of truth. Its exact columns are:

1. `Event_ID`
2. `Event_Type`
3. `Member_Token`
4. `Phone_Number`
5. `Actor_Label`
6. `Occurred_At_UTC`
7. `Payload_JSON`
8. `Schema_Version`

Supported events are `MIGRATION_SNAPSHOT`, `MEMBER_ENROLLED`, `PURCHASE_RECORDED`, `REWARD_SELECTED`, `REWARD_REDEEMED`, and `CASHBACK_PAID`.

Every transaction is appended with `values.append`; existing ledger rows are never updated. The fold follows Sheet row order, accepts only the first occurrence of an `Event_ID`, and deterministically rejects duplicate enrollment, insufficient credits/balance, sold-out stock, duplicate redemption, malformed payloads, and invalid versions. `Member_Summary` can be rebuilt and is never authoritative.

A purchase event embeds its policy. A selection embeds reward name, type, value, cap, and stock snapshot. Later setting changes therefore affect only later events.

## Setup and operation

- **Create new Ahm Sheet** creates and initializes schema v3 through Sheets API.
- **Connect existing Sheet** uses Picker and rejects non-v3 or view-only files.
- Only non-secret connection preferences and derived caches may persist in IndexedDB.
- API quota responses use bounded backoff. Retried append bodies retain the same event ID.
- Google authorization denial, Picker cancellation, network errors, schema mismatch, and expired authorization must produce actionable UI errors.

## QR and migration

New identifiers use `/member?s={publicShopId}&t={memberToken}`. The public page reveals no private member state. If authorized staff open the link on a connected device, they can continue to staff lookup.

Migration selects the v2 Sheet, creates a v3 Sheet, writes current members/rewards/claims as snapshot events, copies logs to an archive tab, preserves member tokens, and only after successful destination writes renames old operational tabs with `Legacy_`.

The legacy redirect decrypts old AES-GCM codes and derives a stable `PublicShopId` using a purpose-specific HMAC subkey. It returns only a redirect to the new route, uses `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and writes no application logs.

## Security and privacy acceptance

- No bearer token in IndexedDB, LocalStorage, sessionStorage, URLs, request bodies, diagnostics, or application logs.
- CSP permits only the application and required Google Identity/Picker/API origins; untrusted scripts are blocked.
- Sheet IDs, event payload sizes, and numeric values are validated.
- API keys are origin/API restricted and documented.
- Privacy text distinguishes Ahm application persistence from ordinary infrastructure access logs and legacy transient processing.
- Production requires verified domain, public privacy/terms pages, configured OAuth brand, and Google’s required verification.

## Release acceptance

- Pure fold tests cover duplicate IDs, row ordering, duplicate enrollment, carried spend, multiple card completion, stock contention, immutable snapshots, redemption, payout, and malformed input.
- Adapter tests cover memory-only tokens, expiry, Picker cancellation, read-only sheets, schema mismatch, retry/backoff, and append idempotency.
- Migration tests preserve v2 state/tokens and archive safely before disabling old writes.
- Mobile tests cover owner create, staff select, multi-session appends, QR staff lookup, and language persistence.
- `npm test` and the production build pass before deployment; OAuth behavior is smoke-tested with staging test users.
