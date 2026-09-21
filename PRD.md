# Product Requirements Document (PRD)

**Project Name:** အမ်း (Ahm / Earn)

**Tagline:** Smart Loyalty, Earn Cashback

**Platform Architecture:** Blazor WebAssembly (Pure Client-Side, Zero Backend Server)

**Database & Storage:** Google Sheets (Google Apps Script Web App Engine)

**Client Storage Engine:** Browser IndexedDB (No LocalStorage)

**Customer Identifier:** Phone Number & Encrypted QR Token

**Business Model:** 100% Free & Open Community Tool (Zero Infrastructure Cost for Creator)

**Version:** 5.0.0

---

## ၁။ စီမံကိန်း အကျဉ်းချုပ် (Executive Summary)

**"အမ်း (Ahm)"** သည် ကော်ဖီဆိုင်၊ လက်ဖက်ရည်ဆိုင်၊ စားသောက်ဆိုင်နှင့် ဘီယာဆိုင်များအတွက် ရည်ရွယ်ထုတ်လုပ်ထားသော စက္ကူကတ်မဲ့ Digital Loyalty & Cashback စနစ်ဖြစ်သည်။

စနစ်အမည်ဖြစ်သော **"အမ်း"** သည် အင်္ဂလိပ်ဘာသာ **"Earn" (အမှတ်နှင့် ဆုကြေးများ စုဆောင်းရယူသည်)** ဆိုသော အဓိပ္ပာယ်နှင့် အသံထွက်တူညီပြီး၊ မြန်မာစကားအရ **"ငွေသားပြန်အမ်းငွေ (Cashback)"** ကို တိုက်ရိုက်ရည်ညွှန်းသည်။

ဤစနစ်သည် ဗဟိုဆာဗာ (Central Server) မရှိဘဲ Static Web Hosting ပေါ်တွင် အခမဲ့ လွှင့်တင်ထားမည့် **Blazor WebAssembly** ဖြစ်သည်။ ဆိုင်ရှင်များသည် မိမိတို့၏ ကိုယ်ပိုင် **Google Sheets** အား Database အဖြစ် အသုံးပြုပြီး Google Apps Script ဖြင့် CORS အခက်အခဲမရှိ Browser မှ တိုက်ရိုက် ချိတ်ဆက်အသုံးပြုမည်ဖြစ်သည်။ ဆိုင်ရှင်၏ Credential များနှင့် Cache များကို Browser ၏ **IndexedDB** တွင်သာ သိမ်းဆည်းမည်ဖြစ်သည် (LocalStorage ကို လုံးဝအသုံးမပြုပါ)။

---

## ၂။ အသုံးပြုသူ အဆင့်များနှင့် အခန်းကဏ္ဍ (Target Users & Roles)

1. **ဆိုင်ရှင်နှင့် ကောင်တာဝန်ထမ်း (Shop Owner / Cashier):**
* မိမိ Google Sheet မှ Apps Script Web App URL အား Blazor WASM ထဲသို့ ထည့်သွင်း၍ "အမ်း" စနစ်ကို အစပြုလည်ပတ်သူ။
* Customer ဘေလ်ရှင်းသည့်အခါ ဖုန်းနံပါတ် (သို့မဟုတ် Encrypted QR) ဖြင့် ရှာဖွေပြီး Stamp ပေါင်းပေးခြင်း၊ Cashback ထုတ်ပေးခြင်းများ ဆောင်ရွက်သူ။


* ဆိုင်၏ မူဝါဒ (Spend per Stamp, Target Stamps) နှင့် Reward Catalog ကို သတ်မှတ်သူ။




2. **စားသုံးသူ (Customer):**
* မည်သည့် Mobile App မျှ Install လုပ်စရာမလို၊ အကောင့်ဖွင့်စရာမလိုဘဲ ငွေရှင်းကောင်တာတွင် ဖုန်းနံပါတ်နှင့် နာမည်သာ ပြောပြသူ။


* မိမိရရှိထားသော Stamp နှင့် ပြန်အမ်းငွေ (Cashback) ကို စစ်ဆေးလိုပါက Encrypted QR ကို Scan ဖတ်ကာ ဖုန်း Browser ဖြင့် ချက်ချင်း ကြည့်ရှုသူ။





---

## ၃။ စနစ်၏ တည်ဆောက်ပုံ (System Architecture)

```text
[Customer / Cashier Device]
             │
             ▼
      [Blazor WebAssembly ("အမ်း")]
             │
             ├── Local State & Offline Cache ──► [Browser IndexedDB]
             │
             ▼ Direct HTTPS Call (No CORS, No Proxy)
[Google Apps Script Web App (API Engine)]
             │
             ▼ Auto Append / Query Rows
   [Shop Owner's Google Sheet]
      ├── Tab 1: Member_Cards
      ├── Tab 2: Transaction_Logs
      └── Tab 3: Shop_Config

```

---

## ၄။ Client Storage ဖွဲ့စည်းပုံ (Browser IndexedDB Stores)

LocalStorage ကို လုံးဝမသုံးဘဲ Browser ၏ **IndexedDB** ထဲတွင် အောက်ပါ Object Store များကို တည်ဆောက်သိမ်းဆည်းမည်-

* **`ShopCredentialsStore`:**
* `gas_web_app_url`: ဆိုင်ရှင်၏ Google Apps Script Web App URL
* `shop_name`: ဆိုင်အမည် (ဥပမာ - Shwe Tea House)




* **`PolicyStore`:**
* `min_spend_per_stamp`: Stamp ၁ ခု ရရှိရန် သုံးစွဲငွေ အချိုး (Default: 10,000 MMK)


* `max_stamps`: ကတ်ပြည့်ရန် လိုအပ်သော အရေအတွက် (Default: 10 ခု)


* `cashback_reward`: Sheet အဟောင်းမှ ပြောင်းလာသည့်ဆိုင်အတွက် မူလ Cashback Catalog Item ဖန်တီးရာတွင်သာ အသုံးပြုသော တန်ဖိုး


* `min_withdrawal`: စတင်ထုတ်ယူနိုင်သည့် အနည်းဆုံးပမာဏ (Default: 1,000 MMK)


* ပိုလျှံသော Stamp နှင့် သုံးစွဲငွေကို နောက်ကတ်/နောက်ဝယ်ယူမှုသို့ အမြဲ ကူးပြောင်းမည်။ Reward Catalog ကို Sheet တွင် သိမ်းပြီး Browser Setup တွင် Cache လုပ်မည်။




* **`CustomerCacheStore`:**
* မကြာသေးမီက ရှာဖွေထားသော Customer Data များကို IndexedDB တွင် ခေတ္တ Cache လုပ်ထားခြင်းဖြင့် Google Sheet ဆီသို့ Request သွားရောက်မှု အကြိမ်ရေကို လျှော့ချပေးမည်။



---

## ၅။ Google Sheet Database ဖွဲ့စည်းပုံ (Shop Owner's Private Storage)

ဆိုင်ရှင်၏ Google Drive ထဲရှိ Sheet ဖိုင်တွင် အောက်ပါ Tab (၅) ခု ပါဝင်မည်ဖြစ်သည်-

### ၅.၁။ Tab 1: `Member_Cards`

* **Column A (Phone_Number):** Customer ဖုန်းနံပါတ် (Primary Search Key)
* **Column B (Customer_Name):** စားသုံးသူအမည်
* **Column C (Current_Stamps):** လက်ရှိ Stamp အရေအတွက်


* **Column D (Available_Cashback):** ထုတ်ယူနိုင်သည့် ပြန်အမ်းငွေပမာဏ (MMK)


* **Column E (Lifetime_Cashback):** စုစုပေါင်း ရရှိခဲ့သည့် ပြန်အမ်းငွေ (MMK)


* **Column F (Last_Visit):** နောက်ဆုံး ဘေလ်ရှင်းခဲ့သည့် နေ့စွဲနှင့် အချိန်
* **Column G-J:** Member Token၊ နောက်ဝယ်ယူမှုသို့ ဆက်သယ်သောငွေ၊ မသုံးရသေးသော ဆုရွေးခွင့်နှင့် နောက်ဆုံးဆုရွေးချယ်မှု Request ID

### ၅.၂။ Tab 2: `Transaction_Logs`

* **Column A (Log_ID):** Auto-generated Sequence ID (ဥပမာ - 1, 2, ...)


* **Column B (Phone_Number):** Customer ဖုန်းနံပါတ်
* **Column C (Action):** `STAMP_ADD`, `CARD_COMPLETE`, `REWARD_SELECTED`, `REWARD_REDEEM`, `CASHBACK_PAYOUT`

* **Column D (Delta_Amount):** အတိုး/အလျော့ ပမာဏ (Stamp သို့မဟုတ် Cashback MMK)


* **Column E (Note):** အသေးစိတ် မှတ်ချက် (ဥပမာ - `Card complete`, `Leftover from previous card`)


* **Column F (Timestamp):** ဖြစ်ပွားခဲ့သည့် အချိန်
* **Column G (Request_ID):** တူညီသော Request ကို ထပ်မံမတွက်မိစေရန် ID



### ၅.၃။ Tab 3: `Shop_Config`

* ဆိုင်၏ မူဝါဒ Parameter များနှင့် စည်းမျဉ်းများကို Key-Value ပုံစံဖြင့် သိမ်းဆည်းထားခြင်း။

### ၅.၄။ Tab 4: `Reward_Catalog`

* ဆိုင်က ဖန်တီးထားသော Cashback၊ ရာခိုင်နှုန်း Discount နှင့် Free Item များ၏ အမည်၊ တန်ဖိုး၊ အများဆုံးလျှော့ငွေ၊ Active အခြေအနေနှင့် လက်ကျန် Stock ကို သိမ်းဆည်းသည်။ Stock ကို အလွတ်ထားလျှင် အကန့်အသတ်မရှိဟု သတ်မှတ်ပြီး ၀ ဖြစ်လျှင် Sold Out ပြသည်။

### ၅.၅။ Tab 5: `Member_Rewards`

* Customer ရွေးခဲ့သည့် ဆု၏ အမည်၊ အမျိုးအစား၊ တန်ဖိုးနှင့် Pending/Applied/Redeemed အခြေအနေကို ရွေးချယ်ချိန်တန်ဖိုးအတိုင်း သိမ်းဆည်းသည်။



---

## ၆။ အဓိက လုပ်ငန်းစဉ်များ (Functional Workflows)

### ၆.၁။ ဆိုင်စတင်ချိတ်ဆက်ခြင်း (Shop Onboarding)

1. ဆိုင်ရှင်သည် ပေးထားသော Google Sheet Template ကို မိမိ Google Drive ထဲသို့ "Make a Copy" ကူးယူသည်။
2. Sheet ထဲရှိ Apps Script ကို 1-Click ဖြင့် "Deploy as Web App" ပြုလုပ်ပြီး ရလာသော Web App URL ကို ကူးယူသည်။
3. Blazor WASM စနစ်၏ `/setup` တွင် ထို URL နှင့် ဆိုင်အချက်အလက်များကို ဖြည့်စွက်သည်။
4. စနစ်က အချက်အလက်များကို Browser ၏ **IndexedDB** တွင် သိမ်းဆည်းလိုက်ပြီး နေ့စဉ် သုံးစွဲမည့် "အမ်း POS View" သို့ အလိုအလျောက် ရောက်ရှိသွားမည်။

### ၆.၂။ Customer စာရင်းသွင်းခြင်းနှင့် Stamp ထည့်ပေးခြင်း (Daily POS Flow)

```text
[Customer ဘေလ်ရှင်းခြင်း] ──► ဝန်ထမ်းအား ဖုန်းနံပါတ်နှင့် နာမည်ပြောခြင်း
                                        │
                                        ▼
                  [ဝန်ထမ်းက ဖုန်းနံပါတ် ရိုက်ထည့်ရှာဖွေခြင်း]
                                        │
                ┌───────────────────────┴───────────────────────┐
                ▼                                               ▼
        [ဖုန်းနံပါတ် အသစ်ဖြစ်ပါက]                       [ယခင်ရှိပြီးသား ဖုန်းဖြစ်ပါက]
                │                                               │
 နာမည်ထည့်၍ Customer အသစ်ဖန်တီးခြင်း              လက်ရှိ Stamp အကွက်ဟောင်းကို ဖွင့်ပြခြင်း[cite: 1]
 (Google Sheet သို့ auto append row)                            │
                │                                               │
                └───────────────────────┬───────────────────────┘
                                        │
                                        ▼
                [ဘေလ်ပမာဏနှင့် ပိုငွေအရ Stamp အရေအတွက်တွက်ခြင်း]

```

### ၆.၃။ Encrypted QR Identity Flow

* **QR Generation:** စနစ်က Customer ၏ ဖုန်းနံပါတ်ကို AES / HMAC သို့မဟုတ် Base64 URL-Safe ဖြင့် Encrypt ပြုလုပ်ကာ QR Token ထုတ်ပေးသည်။


* **QR Scanning:**
* ကောင်တာဝန်ထမ်းက Customer ၏ QR Code (ဖုန်း screen သို့မဟုတ် Physical Card) ကို Scan ဖတ်ပါက စနစ်က Decrypt ပြုလုပ်၍ ဖုန်းနံပါတ်အား အလိုအလျောက် ရှာဖွေပေးသည်။


* Customer ကိုယ်တိုင် Scan ဖတ်ပါက Browser ပေါ်တွင် App သွင်းစရာမလိုဘဲ မိမိ၏ Stamp အရေအတွက်နှင့် လက်ကျန် Cashback ကို တိုက်ရိုက် ကြည့်ရှုနိုင်သည်။





### ၆.၄။ Dynamic Stamp Rule နှင့် Reward Catalog

* ဆိုင်သည် `Spend per Stamp` နှင့် `Target Stamps` ကို Setup တွင် ပြင်နိုင်သည်။ ဘေလ်ငွေနှင့် ယခင်ပိုငွေကို ပေါင်းပြီး `floor(total / Spend per Stamp)` ဖြင့် Stamp တွက်သည်။ ကျန်ငွေကို နောက်ဝယ်ယူမှုသို့ ဆက်သယ်သည်။ ဥပမာ ၁၀,၀၀၀ MMK လျှင် Stamp ၁ ခုအဖြစ် သတ်မှတ်ထားချိန် ၂၅,၀၀၀ MMK ဘေလ်သည် Stamp ၂ ခုနှင့် ပိုငွေ ၅,၀၀၀ MMK ဖြစ်သည်။
* Stamp ပန်းတိုင်ပြည့်တိုင်း ဆုရွေးခွင့် ၁ ကြိမ် ရသည်။ တစ်ဘေလ်မှ ပန်းတိုင်များစွာ ပြည့်နိုင်ပြီး ပိုသော Stamp များကို ဆက်သယ်သည်။
* ဆိုင်သည် Reward Catalog ထဲတွင် Cashback ပမာဏ၊ အများဆုံးလျှော့ငွေပါသော ရာခိုင်နှုန်း Discount သို့မဟုတ် Free Item ကို ဖန်တီးပြီး ဖွင့်/ပိတ်နိုင်သည်။ Stock အရေအတွက် သတ်မှတ်နိုင်ပြီး Stock ၀ ဖြစ်သောဆုကို Customer မရွေးနိုင်ပါ။ Customer သည် QR Member Page မှ ရရှိထားသော ဆုရွေးခွင့်အတွက် ဆုတစ်မျိုးကို ရွေးသည်။
* Cashback ရွေးလျှင် `Available Cashback` နှင့် `Lifetime Cashback` တိုးသည်။ Discount သို့မဟုတ် Free Item ရွေးလျှင် Cashier မှ အသုံးပြုမှုကို အတည်ပြုသည်။ ရွေးပြီးသားဆု၏ အမည်နှင့်တန်ဖိုးကို မှတ်တမ်းထဲ သိမ်းထားသောကြောင့် Catalog ပြင်ခြင်းက ထိုဆုကို မပြောင်းစေပါ။
* Cashback Withdrawal ကို သတ်မှတ်ထားသော အနည်းဆုံးပမာဏ ပြည့်ချိန် Cashier က မှတ်တမ်းတင်ပြီး Customer ကို ငွေသားပေးသည်။ Discount ပမာဏကို System က တွက်ပေးပြီး Cashier က ဘေလ်ပေါ်တွင် အသုံးပြုသည်။





---

## ၇။ Customer Member View (မိုဘိုင်းမျက်နှာပြင် ဒီဇိုင်း)

Customer သည် QR ဖတ်၍ ကြည့်ရှုသည့်အခါ အောက်ပါအချက်များကို ရှင်းလင်းစွာ မြင်တွေ့ရမည်-

* **Header:** ဆိုင်အမည်နှင့် Customer နာမည်။


* **Member Card (Stamp Grid):** ဆိုင်က သတ်မှတ်ထားသော Stamp ပန်းတိုင်၊ လက်ရှိ Stamp၊ နောက်ဝယ်ယူမှုသို့ ဆက်သယ်ထားသော ငွေပမာဏနှင့် ဆုရွေးခွင့် အရေအတွက်။


* **Cashback Status:** ထုတ်ယူနိုင်သော လက်ကျန်ငွေ (`0 MMK available`) နှင့် စုစုပေါင်း ရရှိခဲ့သည့် ငွေပမာဏ (`Lifetime cashback earned: 20,000 MMK`)။

* **Reward Choice:** ဆုရွေးခွင့် ရှိပါက Customer သည် Catalog ထဲမှ ဆုတစ်မျိုးကို ရွေးနိုင်ပြီး မသုံးရသေးသော Discount/Free Item ကို ပြနိုင်သည်။


* **Withdrawal & Activity Logs:** ငွေထုတ်ယူခဲ့သည့် စာရင်းနှင့် လတ်တလော Stamp ရရှိခဲ့သည့် မှတ်တမ်းများ။



---

## ၈။ စနစ်၏ ထူးခြားသော အားသာချက်များ (Key Benefits)

1. **Zero Maintenance & Zero Cost:** System Creator ဘက်မှ မည်သည့် Server၊ Database သို့မဟုတ် CORS Proxy စရိတ်မျှ လုံးဝ စိုက်ထုတ်ရန် မလိုဘဲ အခမဲ့ ဖြန့်ဝေနိုင်ခြင်း။
2. **No CORS Restrictions:** Google Apps Script Web App ကို Browser (Blazor WASM) မှ တိုက်ရိုက် `POST/GET` ခေါ်ယူနိုင်ခြင်း။
3. **Data Privacy & Ownership:** ဆိုင်ရှင်များ၏ Customer စာရင်းနှင့် ငွေကြေးစာရင်းများသည် မိမိတို့၏ ကိုယ်ပိုင် Google Drive ထဲတွင်သာ ၁၀၀% လုံခြုံစွာ တည်ရှိနေခြင်း။
4. **IndexedDB High Performance:** LocalStorage ကဲ့သို့ Data ကန့်သတ်ချက် သေးငယ်ခြင်းမရှိဘဲ လုံခြုံမြန်ဆန်သော Local Caching ကို ရရှိစေခြင်း။
