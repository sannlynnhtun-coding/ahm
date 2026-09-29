# အမ်း (Ahm)

Ahm is a .NET 10 static Blazor WebAssembly loyalty workspace for shop owners and staff. It connects a mobile browser directly to a shop-owned Google Sheet. New shops use no Apps Script deployment, cashier PIN, service account, Ahm database, or server-side Google session.

## Privacy boundary

- Google Identity Services issues the `drive.file` access token directly to the browser.
- The token exists only in JavaScript/.NET runtime memory. Ahm never writes it to IndexedDB, LocalStorage, URLs, logs, or an Ahm server.
- The browser calls Google Sheets and Drive APIs directly. Ahm servers do not persist shop or customer records.
- IndexedDB stores only the selected Sheet ID, public shop ID, display settings, local staff label, and language preference. OAuth tokens and member records are not written there by v3.
- A static host or CDN can still process standard access logs under its own terms. The legacy redirect transiently decrypts old QR codes without storing request or customer data.

## Google Cloud setup (maintainer, once)

1. Create a Google Cloud project and enable **Google Sheets API**, **Google Drive API**, and **Google Picker API**.
2. Configure the OAuth consent/brand screen, verified production domain, `/privacy`, and `/terms`. Add test users while the project is in testing, then complete the required production brand verification.
3. Create a **Web application** OAuth client. Add each Ahm origin under **Authorized JavaScript origins**. No client secret is shipped and a redirect URI is not used by the token client.
4. Create a browser API key. Restrict it to the Ahm HTTPS origins and to the Drive/Picker APIs required by Picker.
5. Copy the OAuth client ID, browser API key, and numeric project number into [`src/Ahm/wwwroot/appsettings.json`](src/Ahm/wwwroot/appsettings.json):

```json
{
  "Google": {
    "ClientId": "...apps.googleusercontent.com",
    "ApiKey": "...",
    "AppId": "123456789012"
  }
}
```

These values are public browser configuration, not secrets. The OAuth request uses only `https://www.googleapis.com/auth/drive.file`. Google’s current consent wording should be shown alongside Ahm’s localized explanation.

## Shop flow

On `/setup`, an owner or staff member clicks **Connect Google**, then either:

- **Create new Ahm Sheet** — Sheets API creates and initializes the five v3 tabs; or
- **Connect existing Sheet** — Google Picker grants/selects a v3 Sheet already shared with that account.

Every Google Sheet Editor is a trusted operator. Ahm does not pretend to enforce finer roles because editors can modify the Sheet in Google’s own UI. Page reloads and expired tokens stop mutations until the user explicitly clicks **Reconnect Google**.

The v3 tabs are:

- `Ahm_Meta`
- `Shop_Config`
- `Reward_Catalog`
- `Event_Ledger` — immutable source of truth
- `Member_Summary` — rebuildable cache

`Event_Ledger` uses `Event_ID`, `Event_Type`, `Member_Token`, `Phone_Number`, `Actor_Label`, `Occurred_At_UTC`, `Payload_JSON`, and `Schema_Version`. All writes use `values.append`. Sheet row order is authoritative and only the first occurrence of an event ID is folded. Purchases and reward selections carry policy/reward snapshots so later configuration edits do not rewrite history.

Customer links have the form `/member?s={publicShopId}&t={memberToken}`. That page exposes no name, phone, balance, stamps, or rewards; it only renders an identifier QR for authorized staff to scan.

## Legacy v2 migration

The migration panel on `/setup` lets an authorized editor choose the old Sheet in Picker. Ahm creates a new v3 Sheet, writes each current member as a `MIGRATION_SNAPSHOT`, copies historical logs to `Legacy_Transaction_Logs`, adds `Ahm_Migration_Lock`, and then renames the source tabs with `Legacy_`. The v2 script in this repository refuses writes when that lock exists. Deployments made from older script versions that do not recognize the lock must also be disabled in Apps Script.

Existing member tokens are preserved. `api/member.js` decrypts old `?c=` codes and redirects to the new staff-only route. A deterministic public shop ID is derived with a separate HMAC subkey from `MEMBER_LINK_KEY`. The endpoint does not contact Apps Script or expose its URL. `api/sheets.js` remains only for a time-limited v2 grace period; the v3 client never calls it. `google-apps-script/Code.gs` is a legacy migration artifact, not onboarding material.

Set a stable random 32-byte hex `MEMBER_LINK_KEY` in Vercel for legacy redirects:

```sh
openssl rand -hex 32
```

Changing the key invalidates old encrypted QR links and changes their derived public shop IDs.

## Develop and verify

Install .NET 10 and Node.js, then run:

```sh
npm ci
npm run vendor
npm run css
dotnet run --project src/Ahm/Ahm.csproj
```

Before release:

```sh
npm test
npm run build
```

Use a staging OAuth project with test users for mobile smoke tests. Verify owner creation, staff Picker selection, concurrent appends, QR staff lookup, migration, token expiry/reconnect, and Burmese/English preference persistence. Google and hosting quotas/policies still apply even though Ahm charges no subscription and runs no application database.
