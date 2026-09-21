# အမ်း (Ahm)

.NET 10 standalone Blazor WebAssembly loyalty app styled with Tailwind CSS. The interface follows `ahm-ui-sample.html`. Each shop's records live in its own Google Sheet. The static app runs on Vercel; one small Vercel Function relays requests to Google Apps Script so browser CORS and Content Service redirects cannot hide write results.

## Run locally

Install .NET 10 SDK and Node.js, then run:

```sh
npm ci
npm run vendor
npm run css
dotnet run --project src/Ahm/Ahm.csproj
```

The local `dotnet run` server serves the UI but does not host `/api/sheets`. For end-to-end use, run `vercel dev` after linking the project, or use a deployed Vercel URL.

## Brand assets

The final logo is [`src/Ahm/wwwroot/logo.svg`](src/Ahm/wwwroot/logo.svg). Favicon, touch, app, and social preview PNGs are generated from the same mark with `pwsh -File scripts/generate-logo-icons.ps1` on Windows. The original generated concept is in [`assets/ahm-logo-source.png`](assets/ahm-logo-source.png). Brand colors are defined in [`src/Ahm/Styles/app.css`](src/Ahm/Styles/app.css).

## Set up a shop

The deployed `/setup` page walks shop owners through these steps and provides a **Copy Apps Script code** button and direct links to Google Sheets and Google's help pages.

1. Create a blank Google Sheet in the shop owner's Google Drive.
2. Open **Extensions → Apps Script** and replace `Code.gs` with [`google-apps-script/Code.gs`](google-apps-script/Code.gs).
3. In **Project Settings → Script properties**, add `CASHIER_PIN` with a unique value of at least eight characters. Keep it private.
4. In the Apps Script editor, select and run `initializeAhm` once. Authorize it. This records the Sheet ID in Script properties so web app requests can open the correct Sheet.
5. Choose **Deploy → New deployment → Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Authorize the script and copy its `/exec` URL. Do not use the `/dev` URL.
6. On the deployed Ahm site, open `/setup`, enter the shop name, `/exec` URL, PIN, stamp policy and reward catalog, then save. Setup creates `Member_Cards`, `Transaction_Logs`, `Shop_Config`, `Reward_Catalog`, and `Member_Rewards` tabs automatically.

For an existing shop, replace the Apps Script with the new `Code.gs`, redeploy it as a new Web App version, and use **Load latest settings from Sheet** on `/setup` before saving. The old member columns and cashback balances are retained. New columns track unspent bill amounts and reward choices. Existing cashback stays available for payout; future completed stamp cards earn a choice from the catalog.

Each purchase earns `floor((carried spend + bill amount) / spend per stamp)` stamps. The remainder is carried to the next purchase. When the configured stamp target is reached, the member receives one reward choice per completed card. The customer opens their QR member link and chooses an active catalog item: fixed cashback, a percentage discount with an MMK cap, or a free item. Cashback is added to the available balance immediately. The cashier redeems discount and free-item choices from the customer card; for discounts, enter the current bill amount first and apply the displayed MMK discount to the bill. Changes to a catalog item do not alter rewards already chosen by members.

Owners can turn any catalog item off. Each item can also have a finite stock quantity; leave stock blank for unlimited availability. Zero stock shows **Sold out** and blocks selection. A successful customer selection reduces finite stock by one under the shop's Apps Script lock. Already selected rewards remain redeemable if the catalog item is later disabled or sold out.

Policy edits take effect on the next recorded purchase, including for existing stamps and carried spend. Reducing the target can complete an in-progress card on that next purchase. Chosen rewards retain their name and value at selection time.

Customer QR links contain one AES-256-GCM encrypted code. The Vercel function decrypts it and requests that card from the shop's Apps Script; the member page receives only the member's display data, shop name, policy, and active rewards. The Apps Script URL and member token are absent from new URLs and customer API responses. Anyone holding a link can read that member's card **and choose an earned reward**, so share it only with that customer. Existing `?s=...&t=...` links are converted to encrypted links when opened, but the old shared URLs cannot be erased remotely; replace previously shared QR codes. Cashier actions require the PIN, which is held only in memory for the current browser session. Shop URL, policy and recent member cache use IndexedDB; the app does not use LocalStorage.

## Deploy on Vercel

The repository's [`vercel.json`](vercel.json) installs .NET 10 during a Linux build when necessary, runs Tailwind and `dotnet publish`, serves the published `wwwroot`, and rewrites Blazor routes to `index.html`.

Set `MEMBER_LINK_KEY` to a random 32-byte hex value in Vercel's Production environment before deploying. Keep this value stable: changing it invalidates previously issued member links. For local `vercel dev`, set the same key in the Development environment.

```sh
vercel link
vercel deploy --prod
```

The site can be deployed before any shop creates a Sheet. A shop completes setup in its own browser after deployment.

## Constraints

- Google Apps Script has execution quotas and Google Sheets is unsuitable for high-volume or highly regulated financial systems.
- Payouts are recorded in the Sheet before cash is handed to the customer. The cashier must hand over cash after the success message.
- Discount redemption records the discount amount; it does not change an external POS bill automatically. The cashier must apply the displayed amount. Google Sheets does not provide database transactions across the member, claim, and log tabs, so operators should verify the member history if Apps Script reports a failure during a reward or payout action.
- Camera scanning uses the browser's `BarcodeDetector` API where available. Cashiers can paste a QR link or token elsewhere.
- This design includes a Vercel relay. The PRD's assertion that arbitrary Blazor fetch requests to Apps Script are free of CORS restrictions is not dependable with Google Content Service redirects.
