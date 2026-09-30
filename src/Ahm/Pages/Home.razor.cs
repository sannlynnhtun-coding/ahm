using System.Globalization;
using System.Text.RegularExpressions;
using Ahm.Models;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Routing;
using Microsoft.JSInterop;

namespace Ahm.Pages;

public partial class Home : IDisposable
{
    private static readonly Regex IdentifierPattern = new("^[A-Za-z0-9_-]{8,160}$", RegexOptions.Compiled);
    private bool loaded, busy, messageIsError, googleConfigured, googleConnected, showEnroll, validMemberLink, burmese = true;
    private bool showRewardDialog, openRewardDialogAfterRender;
    private string page = "", message = "", lookup = "", newName = "", publicShopId = "", memberToken = "";
    private string rewardDialogError = "", rewardDialogReturnFocusId = "add-reward";
    private string? editingRewardId;
    private int spend;
    private ShopSetup setup = new();
    private GoogleShopState state = new();
    private Member? member;
    private ShopReward rewardDraft = NewRewardDraft();

    private string Title => page switch
    {
        "setup" => "Shop setup | Ahm",
        "cashier" => "Staff workspace | Ahm",
        "member" => "Member identifier | Ahm",
        "privacy" => "Privacy | Ahm",
        "terms" => "Terms | Ahm",
        _ => "Ahm | Google Sheets loyalty"
    };

    protected override void OnInitialized() => Nav.LocationChanged += LocationChanged;
    protected override Task OnParametersSetAsync() => LoadAsync();

    private void LocationChanged(object? sender, LocationChangedEventArgs args) =>
        _ = InvokeAsync(async () => { await LoadAsync(); StateHasChanged(); });

    public void Dispose() => Nav.LocationChanged -= LocationChanged;

    private async Task LoadAsync()
    {
        loaded = false;
        page = new Uri(Nav.Uri).AbsolutePath.Trim('/').ToLowerInvariant();
        message = "";
        member = null;
        showEnroll = false;
        try
        {
            burmese = (await Store.GetLanguageAsync()) != "en";
            setup = await Store.GetSetupAsync() ?? NewSetup();
            var options = new GooglePublicOptions
            {
                ClientId = Configuration["Google:ClientId"] ?? "",
                ApiKey = Configuration["Google:ApiKey"] ?? "",
                AppId = Configuration["Google:AppId"] ?? ""
            };
            googleConfigured = options.IsConfigured;
            var connection = await Sheets.ConfigureAsync(options);
            googleConnected = connection.Connected;
            if (page == "member")
            {
                var uri = new Uri(Nav.Uri);
                publicShopId = Query(uri, "s");
                memberToken = Query(uri, "t");
                validMemberLink = IdentifierPattern.IsMatch(publicShopId) && IdentifierPattern.IsMatch(memberToken);
            }
            else if (page == "cashier" && string.IsNullOrWhiteSpace(setup.SpreadsheetId))
            {
                message = T("Staff workspace သုံးရန် ဆိုင် Sheet ကို အရင်ချိတ်ပါ။", "Connect a shop Sheet before using the staff workspace.");
            }
        }
        catch (Exception ex) { SetError(ex); }
        loaded = true;
    }

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (showRewardDialog && openRewardDialogAfterRender)
        {
            openRewardDialogAfterRender = false;
            await Js.InvokeVoidAsync("ahmUi.openDialog", "reward-dialog", "reward-name");
        }
        if (page == "member" && validMemberLink)
            await Js.InvokeVoidAsync("ahmQr.render", "publicMemberQr", Nav.Uri);
        if (page == "cashier" && member is not null)
            await Js.InvokeVoidAsync("ahmQr.render", "memberQr", MemberUrl(member));
    }

    private static ShopSetup NewSetup() => new()
    {
        Rewards = [new ShopReward { Name = "Cashback", Type = "CASHBACK", Value = 10000 }]
    };

    private async Task ToggleLanguage()
    {
        burmese = !burmese;
        await Store.SaveLanguageAsync(burmese ? "my" : "en");
    }

    private string T(string myanmar, string english) => burmese ? myanmar : english;

    private async Task ConnectGoogle()
    {
        if (busy) return;
        await Run(async () =>
        {
            await Sheets.AuthorizeAsync();
            googleConnected = true;
            if (!string.IsNullOrWhiteSpace(setup.SpreadsheetId))
            {
                await ApplyState(await Sheets.LoadShopAsync(setup.SpreadsheetId, setup.StaffLabel));
                await OpenRequestedMemberAsync();
            }
            message = T("Google ကို ဤ session အတွက် ချိတ်ပြီးပါပြီ။", "Google is connected for this session.");
        });
    }

    private async Task CreateShop()
    {
        if (!googleConnected || busy) return;
        if (string.IsNullOrWhiteSpace(setup.ShopName)) { SetError(T("ဆိုင်အမည် ထည့်ပါ။", "Enter a shop name.")); return; }
        await Run(async () =>
        {
            await ApplyState(await Sheets.CreateShopAsync(setup));
            message = T("Ahm Sheet အသစ်ဖန်တီးပြီး ချိတ်ထားပါပြီ။", "The new Ahm Sheet was created and connected.");
        });
    }

    private async Task ConnectExisting()
    {
        if (!googleConnected || busy) return;
        await Run(async () =>
        {
            await ApplyState(await Sheets.ConnectExistingAsync(setup.StaffLabel));
            message = T("ရွေးထားသော Sheet ကို ချိတ်ပြီးပါပြီ။", "The selected Sheet is connected.");
        });
    }

    private async Task SaveSettings()
    {
        if (!googleConnected || busy) return;
        if (string.IsNullOrWhiteSpace(setup.ShopName) || setup.Policy.MinSpendPerStamp < 1 || setup.Policy.MaxStamps is < 1 or > 30 || setup.Policy.MinWithdrawal < 1)
        { SetError(T("Shop setting များကို ပြန်စစ်ပါ။", "Check the shop settings.")); return; }
        if (!setup.Rewards.Any(reward => reward.Active)) { SetError(T("Active reward အနည်းဆုံးတစ်ခု လိုပါသည်။", "At least one active reward is required.")); return; }
        await Run(async () =>
        {
            await ApplyState(await Sheets.SaveConfigurationAsync(setup));
            message = T("Setting များကို Sheet သို့ သိမ်းပြီးပါပြီ။", "Settings were saved to the Sheet.");
        });
    }

    private static ShopReward NewRewardDraft() => new() { Name = "", Type = "FREE_ITEM", Value = 0, Active = true };

    private void OpenAddRewardDialog()
    {
        editingRewardId = null;
        rewardDraft = NewRewardDraft();
        rewardDialogError = "";
        rewardDialogReturnFocusId = "add-reward";
        showRewardDialog = true;
        openRewardDialogAfterRender = true;
    }

    private void OpenEditRewardDialog(ShopReward reward)
    {
        editingRewardId = reward.Id;
        rewardDraft = new ShopReward
        {
            Id = reward.Id,
            Name = reward.Name,
            Type = reward.Type,
            Value = reward.Value,
            MaxDiscount = reward.MaxDiscount,
            StockQuantity = reward.StockQuantity,
            Description = reward.Description,
            Active = reward.Active
        };
        rewardDialogError = "";
        rewardDialogReturnFocusId = $"edit-reward-{reward.Id}";
        showRewardDialog = true;
        openRewardDialogAfterRender = true;
    }

    private async Task SaveRewardDraft()
    {
        rewardDialogError = ValidateReward(rewardDraft);
        if (rewardDialogError.Length > 0) return;

        rewardDraft.Name = rewardDraft.Name.Trim();
        rewardDraft.Description = rewardDraft.Description.Trim();
        if (rewardDraft.Type == "FREE_ITEM") rewardDraft.Value = 0;
        if (rewardDraft.Type != "PERCENT_DISCOUNT") rewardDraft.MaxDiscount = 0;

        if (editingRewardId is null)
        {
            setup.Rewards.Add(rewardDraft);
        }
        else
        {
            var reward = setup.Rewards.FirstOrDefault(item => item.Id == editingRewardId);
            if (reward is null)
            {
                rewardDialogError = "This reward is no longer in the catalog.";
                return;
            }
            reward.Name = rewardDraft.Name;
            reward.Type = rewardDraft.Type;
            reward.Value = rewardDraft.Value;
            reward.MaxDiscount = rewardDraft.MaxDiscount;
            reward.StockQuantity = rewardDraft.StockQuantity;
            reward.Description = rewardDraft.Description;
            reward.Active = rewardDraft.Active;
        }

        await CloseRewardDialog();
    }

    private static string ValidateReward(ShopReward reward)
    {
        if (string.IsNullOrWhiteSpace(reward.Name)) return "Enter a reward name.";
        if (reward.Type is not ("CASHBACK" or "PERCENT_DISCOUNT" or "FREE_ITEM")) return "Choose a valid reward type.";
        if (reward.Type != "FREE_ITEM" && reward.Value < 1) return "Enter a value greater than zero.";
        if (reward.Type == "PERCENT_DISCOUNT" && reward.Value > 100) return "Discount percentage cannot be more than 100.";
        if (reward.MaxDiscount < 0) return "Maximum discount cannot be negative.";
        if (reward.StockQuantity is < 0) return "Stock quantity cannot be negative.";
        return "";
    }

    private async Task CloseRewardDialog()
    {
        var returnFocusId = rewardDialogReturnFocusId;
        showRewardDialog = false;
        openRewardDialogAfterRender = false;
        rewardDialogError = "";
        editingRewardId = null;
        rewardDraft = NewRewardDraft();
        await InvokeAsync(StateHasChanged);
        await Js.InvokeVoidAsync("ahmUi.focusById", returnFocusId);
    }

    private void DisableReward(ShopReward reward)
    {
        if (reward.Active) reward.Active = false;
        else setup.Rewards.Remove(reward);
    }

    private async Task FindMember()
    {
        if (!googleConnected || busy || string.IsNullOrWhiteSpace(setup.SpreadsheetId)) return;
        if (string.IsNullOrWhiteSpace(lookup)) { SetError(T("ဖုန်း၊ token သို့မဟုတ် QR link ထည့်ပါ။", "Enter a phone, token or QR link.")); return; }
        await Run(async () =>
        {
            await ApplyState(await Sheets.LoadShopAsync(setup.SpreadsheetId, setup.StaffLabel));
            var (shop, token, phone) = ParseLookup(lookup);
            if (shop.Length > 0 && shop != setup.PublicShopId) throw new InvalidOperationException("QR_SHOP_MISMATCH");
            member = token.Length > 0
                ? state.Members.FirstOrDefault(item => item.Token == token)
                : state.Members.FirstOrDefault(item => NormalizePhone(item.Phone) == NormalizePhone(phone));
            showEnroll = member is null && token.Length == 0 && phone.Length > 0;
            if (member is not null)
            {
                message = T("Member ကို Sheet မှ sync လုပ်ပြီးပါပြီ။", "Member synced from the Sheet.");
            }
            else message = showEnroll ? T("Member မတွေ့ပါ။ အသစ်ဖန်တီးနိုင်သည်။", "No member found. You can create one.") : T("Member token မတွေ့ပါ။", "Member token was not found.");
        });
    }

    private async Task OpenRequestedMemberAsync()
    {
        if (page != "cashier") return;
        var uri = new Uri(Nav.Uri);
        var token = Query(uri, "t");
        var shop = Query(uri, "s");
        if (token.Length == 0) return;
        lookup = Nav.Uri;
        if (shop != setup.PublicShopId) throw new InvalidOperationException("QR_SHOP_MISMATCH");
        member = state.Members.FirstOrDefault(item => item.Token == token);
    }

    private async Task Enroll()
    {
        if (!googleConnected || busy || string.IsNullOrWhiteSpace(newName)) return;
        var (_, token, phone) = ParseLookup(lookup);
        if (token.Length > 0 || string.IsNullOrWhiteSpace(NormalizePhone(phone))) { SetError(T("မှန်ကန်သော ဖုန်းနံပါတ် ထည့်ပါ။", "Enter a valid phone number.")); return; }
        var candidate = new Member { Token = Guid.NewGuid().ToString("N"), Phone = NormalizePhone(phone), Name = newName.Trim() };
        var eventId = Guid.NewGuid().ToString("N");
        await Run(async () =>
        {
            await ApplyState(await Sheets.AppendEventAsync(setup, "MEMBER_ENROLLED", candidate, new { name = candidate.Name, phone = candidate.Phone }, eventId));
            ThrowIfRejected(eventId);
            member = state.Members.FirstOrDefault(item => item.Token == candidate.Token);
            showEnroll = false;
            message = T("Member အသစ်ကို ledger တွင် ထည့်ပြီးပါပြီ။", "The new member was appended to the ledger.");
        });
    }

    private async Task RecordPurchase()
    {
        if (member is null || spend < 1 || !googleConnected || busy) return;
        var current = member;
        var policy = new
        {
            minSpendPerStamp = setup.Policy.MinSpendPerStamp,
            maxStamps = setup.Policy.MaxStamps,
            cashbackReward = setup.Policy.CashbackReward,
            minWithdrawal = setup.Policy.MinWithdrawal,
            allowRollover = setup.Policy.AllowRollover
        };
        await AppendForMember("PURCHASE_RECORDED", current, new { amount = spend, policy }, T("ဝယ်ယူမှုကို ledger တွင် ထည့်ပြီးပါပြီ။", "Purchase appended to the ledger."));
    }

    private async Task SelectReward(ShopReward reward)
    {
        if (member is null || member.RewardCredits < 1 || reward.StockQuantity == 0 || busy) return;
        var snapshot = new
        {
            id = reward.Id, name = reward.Name, type = reward.Type, value = reward.Value,
            maxDiscount = reward.MaxDiscount, stockQuantity = reward.StockQuantity,
            description = reward.Description, active = reward.Active
        };
        await AppendForMember("REWARD_SELECTED", member, new { claimId = Guid.NewGuid().ToString("N"), reward = snapshot }, T("Reward ရွေးချယ်မှုကို ledger တွင် ထည့်ပြီးပါပြီ။", "Reward selection appended to the ledger."));
    }

    private async Task RedeemReward(MemberReward claim)
    {
        if (member is null || busy) return;
        await AppendForMember("REWARD_REDEEMED", member, new { claimId = claim.Id, billAmount = spend }, T("Reward အသုံးပြုမှုကို မှတ်တမ်းတင်ပြီးပါပြီ။", "Reward redemption was recorded."));
    }

    private async Task PayCashback()
    {
        if (member is null || member.AvailableCashback < setup.Policy.MinWithdrawal || busy) return;
        await AppendForMember("CASHBACK_PAID", member, new { amount = member.AvailableCashback, minWithdrawal = setup.Policy.MinWithdrawal }, T("Cashback payout ကို မှတ်တမ်းတင်ပြီးပါပြီ။", "Cashback payout was recorded."));
    }

    private async Task AppendForMember(string eventType, Member current, object payload, string success)
    {
        if (!googleConnected) { SetError(T("Google ကို ပြန်ချိတ်ပါ။", "Reconnect Google.")); return; }
        await Run(async () =>
        {
            var eventId = Guid.NewGuid().ToString("N");
            await ApplyState(await Sheets.AppendEventAsync(setup, eventType, current, payload, eventId));
            ThrowIfRejected(eventId);
            member = state.Members.FirstOrDefault(item => item.Token == current.Token);
            message = success;
        });
    }

    private async Task ApplyState(GoogleShopState next)
    {
        var localLabel = setup.StaffLabel;
        state = next;
        setup = next.Setup;
        if (string.IsNullOrWhiteSpace(setup.StaffLabel)) setup.StaffLabel = localLabel;
        await Store.SaveSetupAsync(setup);
    }

    private async Task ScanQr()
    {
        try { lookup = await Js.InvokeAsync<string>("ahmQr.scan"); await FindMember(); }
        catch (Exception ex) when (ex.Message.Contains("cancel", StringComparison.OrdinalIgnoreCase)) { }
        catch (Exception ex) { SetError(ex.Message.Contains("BarcodeDetector") ? T("ဤ browser တွင် camera QR scan မရပါ။ Link ကို paste လုပ်ပါ။", "Camera QR scanning is unavailable here. Paste the link instead.") : T("QR ဖတ်မရပါ။", "The QR could not be read.")); }
    }

    private async Task CopyMemberUrl()
    {
        if (member is null) return;
        try { await Js.InvokeVoidAsync("navigator.clipboard.writeText", MemberUrl(member)); message = T("Member link copy လုပ်ပြီးပါပြီ။", "Member link copied."); messageIsError = false; }
        catch { SetError(T("Link copy မလုပ်နိုင်ပါ။", "The link could not be copied.")); }
    }

    private string MemberUrl(Member value) => $"{Nav.BaseUri.TrimEnd('/')}/member?s={Uri.EscapeDataString(setup.PublicShopId)}&t={Uri.EscapeDataString(value.Token)}";

    private static (string Shop, string Token, string Phone) ParseLookup(string input)
    {
        var candidate = input.Trim();
        if (Uri.TryCreate(candidate, UriKind.Absolute, out var uri))
            return (Query(uri, "s"), Query(uri, "t"), "");
        return IdentifierPattern.IsMatch(candidate) && candidate.Length >= 20 ? ("", candidate, "") : ("", "", candidate);
    }

    private static string NormalizePhone(string value) => new(value.Where(character => char.IsDigit(character) || character == '+').ToArray());
    private static string Query(Uri uri, string key) => uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries).Select(part => part.Split('=', 2)).Where(pair => Uri.UnescapeDataString(pair[0]) == key).Select(pair => pair.Length > 1 ? Uri.UnescapeDataString(pair[1]) : "").FirstOrDefault() ?? "";
    private static string Money(int value) => value.ToString("N0", CultureInfo.InvariantCulture);
    private static string RewardTypeLabel(ShopReward reward) => reward.Type switch
    {
        "CASHBACK" => "Cashback",
        "PERCENT_DISCOUNT" => "Percentage discount",
        _ => "Free item"
    };
    private static string RewardCatalogValue(ShopReward reward) => reward.Type switch
    {
        "CASHBACK" => $"{Money(reward.Value)} MMK",
        "PERCENT_DISCOUNT" when reward.MaxDiscount > 0 => $"{reward.Value}% (up to {Money(reward.MaxDiscount)} MMK)",
        "PERCENT_DISCOUNT" => $"{reward.Value}%",
        _ => "Item"
    };
    private static string RewardLabel(ShopReward reward) => reward.Type switch { "CASHBACK" => $"{Money(reward.Value)} MMK", "PERCENT_DISCOUNT" => $"{reward.Value}% (cap {Money(reward.MaxDiscount)})", _ => "Free item" };
    private int? RemainingStock(ShopReward reward) => reward.StockQuantity is int cap ? Math.Max(0, cap - state.StockUsed.GetValueOrDefault(reward.Id)) : null;
    private void ThrowIfRejected(string eventId)
    {
        // An uncertain network retry may append the same row twice. The first row is authoritative;
        // a later DUPLICATE_EVENT_ID diagnostic therefore means idempotent success, not rejection.
        var rejection = state.Diagnostics.FirstOrDefault(item => item.EventId == eventId && item.Reason != "DUPLICATE_EVENT_ID");
        if (rejection is not null) throw new InvalidOperationException($"EVENT_REJECTED:{rejection.Reason}");
    }

    private void DismissMessage() { message = ""; messageIsError = false; }
    private void SetError(string value) { message = value; messageIsError = true; }
    private void SetError(Exception exception)
    {
        var value = exception.Message;
        if (value.Contains("AUTH_EXPIRED")) { googleConnected = false; value = T("Google session သက်တမ်းကုန်သွားသည်။ Reconnect Google ကို နှိပ်ပါ။", "The Google session expired. Click Reconnect Google."); }
        else if (value.Contains("PICKER_CANCELLED")) value = T("Sheet ရွေးချယ်မှု ပယ်ဖျက်ခဲ့သည်။", "Sheet selection was cancelled.");
        else if (value.Contains("SCHEMA_MISMATCH")) value = T("ဤ Sheet သည် Ahm Sheet မဟုတ်ပါ။ Ahm ဖြင့် ဖန်တီးထားသော Sheet ကို ရွေးပါ။", "This is not an Ahm Sheet. Choose a Sheet created by Ahm.");
        else if (value.Contains("SHEET_NOT_EDITABLE")) value = T("ဤ Sheet တွင် Editor access လိုပါသည်။", "Editor access to this Sheet is required.");
        else if (value.Contains("QR_SHOP_MISMATCH")) value = T("ဤ QR သည် ချိတ်ထားသော ဆိုင်နှင့် မကိုက်ပါ။", "This QR belongs to a different shop.");
        else if (value.Contains("EVENT_REJECTED:REWARD_SOLD_OUT")) value = T("ဤ reward ကို အခြားဝန်ထမ်းက ရွေးပြီး stock ကုန်သွားပါပြီ။", "Another staff member took the last available reward.");
        else if (value.Contains("EVENT_REJECTED:INSUFFICIENT")) value = T("လက်ကျန် မလုံလောက်သဖြင့် event ကို ledger က ပယ်ချခဲ့သည်။", "The ledger rejected the event because the balance is insufficient.");
        else if (value.Contains("EVENT_REJECTED:DUPLICATE")) value = T("ထပ်နေသောလုပ်ဆောင်ချက်ကို ledger က လျစ်လျူရှုခဲ့သည်။", "The ledger ignored the duplicate operation.");
        else if (value.Contains("GOOGLE_CONFIG_MISSING")) value = "Google OAuth public configuration is missing.";
        SetError(value);
    }

    private async Task Run(Func<Task> action)
    {
        busy = true; message = ""; messageIsError = false;
        try { await action(); }
        catch (Exception ex) { SetError(ex); }
        finally { busy = false; }
    }
}
