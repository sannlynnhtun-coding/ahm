using Ahm.Models;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.Routing;
using Microsoft.JSInterop;

namespace Ahm.Pages;

public partial class Home : IDisposable
{
    private bool loaded, busy, showEnroll, legacyMode, messageIsError, confirmPayout;
    private string page = "", pin = "", lookup = "", newName = "", message = "", memberLink = "", memberCode = "", pendingRewardId = "", pendingClaimRequestId = "", pendingRedeemClaimId = "", pendingRedeemRequestId = "", payoutRequestId = "";
    private int spend;
    private int? rewardNameFocusIndex;
    private ShopSetup setup = new();
    private Member? member;
    private ShopReward? rewardToConfirm;

    protected override void OnInitialized() => Nav.LocationChanged += LocationChanged;

    protected override Task OnParametersSetAsync() => LoadAsync();

    private void LocationChanged(object? sender, LocationChangedEventArgs args)
    {
        _ = InvokeAsync(async () => { await LoadAsync(); StateHasChanged(); });
    }

    public void Dispose() => Nav.LocationChanged -= LocationChanged;

    private async Task LoadAsync()
    {
        page = new Uri(Nav.Uri).AbsolutePath.Trim('/').ToLowerInvariant();
        loaded = false;
        message = "";
        messageIsError = false;
        confirmPayout = false;
        legacyMode = false;
        member = null;
        rewardToConfirm = null;
        memberLink = "";
        memberCode = "";
        pendingRewardId = pendingClaimRequestId = "";
        pendingRedeemClaimId = pendingRedeemRequestId = "";
        payoutRequestId = "";
        showEnroll = false;
        try
        {
            if (page == "member")
            {
                setup = new ShopSetup();
                pin = "";
                var uri = new Uri(Nav.Uri);
                var code = Query(uri, "c");
                var shop = Query(uri, "s");
                var token = Query(uri, "t");
                if (!string.IsNullOrWhiteSpace(code))
                {
                    var result = await Api.GetMemberAsync(code);
                    legacyMode = result.SchemaVersion < 2;
                    memberCode = code;
                    setup.ShopName = result.ShopName ?? setup.ShopName;
                    setup.Policy = result.Policy ?? setup.Policy;
                    setup.Rewards = result.Rewards ?? [];
                    member = result.Member;
                }
                else if (!string.IsNullOrWhiteSpace(shop) && !string.IsNullOrWhiteSpace(token))
                {
                    code = await Api.CreateMemberLinkAsync(shop, token);
                    Nav.NavigateTo("/member?c=" + Uri.EscapeDataString(code), replace: true);
                    return;
                }
            }
            else
            {
                setup = await Store.GetSetupAsync() ?? new ShopSetup { Rewards = [new ShopReward { Name = "Cashback", Type = "CASHBACK", Value = 10000 }] };
                setup.Policy = await Store.GetPolicyAsync() ?? setup.Policy;
                if (page == "" && !string.IsNullOrWhiteSpace(setup.GasUrl)) member = await Store.GetCachedMemberAsync();
                if (page == "cashier" && string.IsNullOrWhiteSpace(setup.GasUrl))
                {
                    page = "setup";
                    Nav.NavigateTo("/setup");
                }
            }
        }
        catch (Exception ex) { SetError(ex); }
        loaded = true;
    }

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (member is not null && memberLink.Length > 0 && page == "cashier")
            await Js.InvokeVoidAsync("ahmQr.render", "memberQr", MemberUrl());
        if (rewardNameFocusIndex is int index)
        {
            rewardNameFocusIndex = null;
            await Js.InvokeVoidAsync("ahmUi.focusById", $"reward-name-{index}");
        }
    }

    private async Task SaveSetup()
    {
        if (busy) return;
        if (!Uri.TryCreate(setup.GasUrl, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.Host != "script.google.com" || !uri.AbsolutePath.EndsWith("/exec") || string.IsNullOrWhiteSpace(pin)) { SetError("Enter your Apps Script URL ending in /exec and the cashier PIN."); return; }
        if (string.IsNullOrWhiteSpace(setup.ShopName) || setup.Policy.MinSpendPerStamp < 1 || setup.Policy.MaxStamps is < 1 or > 30 || setup.Policy.CashbackReward < 1 || setup.Policy.MinWithdrawal < 1) { SetError("Enter a shop name and valid stamp and payout amounts."); return; }
        if (setup.Rewards.Count == 0 || setup.Rewards.All(r => !r.Active)) { SetError("Add and enable at least one reward."); return; }
        setup.Policy.AllowRollover = true;
        await Run(async () => {
            await Api.CheckVersionAsync(setup.GasUrl);
            var result = await Api.SendAsync(new SheetRequest { Url = setup.GasUrl, Action = "configure", Pin = pin, ShopName = setup.ShopName.Trim(), Policy = setup.Policy, Rewards = setup.Rewards });
            setup.Policy = result.Policy ?? setup.Policy;
            setup.Rewards = result.Rewards ?? setup.Rewards;
            await Store.SaveSetupAsync(setup);
            await Store.SavePolicyAsync(setup.Policy);
            Nav.NavigateTo("/cashier");
        });
    }

    private async Task RefreshSettings()
    {
        if (busy) return;
        if (string.IsNullOrWhiteSpace(pin) || string.IsNullOrWhiteSpace(setup.GasUrl)) { SetError("Enter the Apps Script URL and cashier PIN before loading settings."); return; }
        await Run(async () => {
            await Api.CheckVersionAsync(setup.GasUrl);
            var result = await Api.SendAsync(new SheetRequest { Url = setup.GasUrl, Action = "find", Pin = pin });
            await SyncSettingsAsync(result);
            message = "Latest settings loaded from Sheet.";
        });
    }

    private void AddReward()
    {
        setup.Rewards.Add(new ShopReward { Type = "FREE_ITEM" });
        rewardNameFocusIndex = setup.Rewards.Count - 1;
    }
    private async Task RemoveReward(ShopReward reward)
    {
        if (string.IsNullOrEmpty(reward.Id)) setup.Rewards.Remove(reward);
        else reward.Active = false;
        await Js.InvokeVoidAsync("ahmUi.focusById", "add-reward");
    }

    private async Task FindMember()
    {
        if (busy) return;
        if (string.IsNullOrWhiteSpace(lookup)) { SetError("Enter a phone number or member QR link."); return; }
        if (string.IsNullOrWhiteSpace(pin)) { SetError("Enter your cashier PIN first."); return; }
        await Run(async () => {
            var value = lookup.Trim();
            var isUrl = Uri.TryCreate(value, UriKind.Absolute, out var url);
            var code = isUrl ? Query(url!, "c") : "";
            var token = isUrl ? Query(url!, "t") : (Guid.TryParse(value, out _) ? value : "");
            var result = code.Length > 0
                ? await Api.FindMemberByCodeAsync(code, setup.GasUrl, pin)
                : await Api.SendAsync(new SheetRequest { Url = setup.GasUrl, Action = "find", Pin = pin, Phone = token.Length == 0 ? value : null, Token = token.Length > 0 ? token : null });
            member = result.Member;
            await SyncSettingsAsync(result);
            pendingRedeemClaimId = pendingRedeemRequestId = "";
            payoutRequestId = "";
            confirmPayout = false;
            showEnroll = member is null && token.Length == 0 && code.Length == 0;
            if (member is not null) await Store.SaveCachedMemberAsync(member);
            message = member is null ? "No customer found. Check the number or create a member card below." : "Customer card loaded.";
            if (member is not null) await PrepareMemberLinkAsync();
        });
    }

    private async Task LookupKeyDown(KeyboardEventArgs e) { if (e.Key == "Enter") await FindMember(); }

    private async Task Enroll()
    {
        if (busy || string.IsNullOrWhiteSpace(newName) || string.IsNullOrWhiteSpace(pin)) return;
        await Run(async () => {
            var result = await Api.SendAsync(new SheetRequest { Url = setup.GasUrl, Action = "enroll", Pin = pin, Phone = lookup.Trim(), Name = newName.Trim(), RequestId = Guid.NewGuid().ToString("N") });
            member = result.Member;
            await SyncSettingsAsync(result);
            showEnroll = false;
            if (member is not null) await Store.SaveCachedMemberAsync(member);
            message = "Member card created.";
            if (member is not null) await PrepareMemberLinkAsync();
        });
    }

    private async Task AddStamp()
    {
        if (member is null || busy || spend < 1) return;
        await Run(async () => {
            var result = await Api.SendAsync(new SheetRequest { Url = setup.GasUrl, Action = "stamp", Pin = pin, Phone = member.Phone, Spend = spend, RequestId = Guid.NewGuid().ToString("N") });
            member = result.Member;
            await SyncSettingsAsync(result);
            if (member is not null) await Store.SaveCachedMemberAsync(member);
            confirmPayout = false;
            payoutRequestId = "";
            message = "Purchase and stamps synced to Sheet.";
        });
    }

    private async Task SelectReward(ShopReward reward)
    {
        if (member is null || member.RewardCredits < 1 || reward.StockQuantity == 0 || busy || memberCode.Length == 0) return;
        if (pendingRewardId.Length > 0 && pendingRewardId != reward.Id) { SetError("Refresh the card before choosing a different reward."); return; }
        pendingRewardId = reward.Id;
        if (pendingClaimRequestId.Length == 0) pendingClaimRequestId = Guid.NewGuid().ToString("N");
        await Run(async () => {
            var result = await Api.ClaimRewardAsync(memberCode, reward.Id, pendingClaimRequestId);
            member = result.Member;
            setup.Policy = result.Policy ?? setup.Policy;
            setup.Rewards = result.Rewards ?? setup.Rewards;
            pendingRewardId = pendingClaimRequestId = "";
            rewardToConfirm = null;
            message = reward.Type == "CASHBACK" ? "Cashback added to your balance." : "Reward selected. Show it to the cashier when using it.";
        });
    }

    private void ReviewReward(ShopReward reward) => rewardToConfirm = reward;
    private void CancelRewardReview() => rewardToConfirm = null;
    private Task ConfirmRewardChoice() => rewardToConfirm is null ? Task.CompletedTask : SelectReward(rewardToConfirm);

    private async Task RedeemReward(MemberReward reward)
    {
        if (member is null || reward.Status != "Pending" || busy) return;
        if (pendingRedeemClaimId.Length > 0 && pendingRedeemClaimId != reward.Id) { SetError("Refresh the card before redeeming a different reward."); return; }
        pendingRedeemClaimId = reward.Id;
        if (pendingRedeemRequestId.Length == 0) pendingRedeemRequestId = Guid.NewGuid().ToString("N");
        await Run(async () => {
            var result = await Api.SendAsync(new SheetRequest { Url = setup.GasUrl, Action = "redeem", Pin = pin, Phone = member.Phone, ClaimId = reward.Id, Spend = spend, RequestId = pendingRedeemRequestId });
            member = result.Member;
            await SyncSettingsAsync(result);
            if (member is not null) await Store.SaveCachedMemberAsync(member);
            pendingRedeemClaimId = pendingRedeemRequestId = "";
            if (reward.Type == "PERCENT_DISCOUNT") spend = Math.Max(0, spend - result.Discount);
            message = reward.Type == "PERCENT_DISCOUNT" ? $"Apply {Money(result.Discount)} MMK discount. Paid amount: {Money(spend)} MMK." : "Free item marked as given.";
        });
    }

    private async Task Withdraw()
    {
        if (!confirmPayout || member is null || busy || member.AvailableCashback < setup.Policy.MinWithdrawal) return;
        await Run(async () => {
            var result = await Api.SendAsync(new SheetRequest { Url = setup.GasUrl, Action = "withdraw", Pin = pin, Phone = member.Phone, Amount = member.AvailableCashback, RequestId = payoutRequestId });
            member = result.Member;
            await SyncSettingsAsync(result);
            if (member is not null) await Store.SaveCachedMemberAsync(member);
            confirmPayout = false;
            payoutRequestId = "";
            message = "Cashback payout recorded. Pay the customer now.";
        });
    }

    private void ShowPayoutReview()
    {
        if (member is null || member.AvailableCashback < setup.Policy.MinWithdrawal) return;
        if (payoutRequestId.Length == 0) payoutRequestId = Guid.NewGuid().ToString("N");
        confirmPayout = true;
    }
    private void CancelPayoutReview() => confirmPayout = false;

    private async Task SyncSettingsAsync(SheetResult result)
    {
        setup.Policy = result.Policy ?? setup.Policy;
        setup.Rewards = result.Rewards ?? setup.Rewards;
        setup.ShopName = result.ShopName ?? setup.ShopName;
        await Store.SaveSetupAsync(setup);
        await Store.SavePolicyAsync(setup.Policy);
    }

    private async Task ScanQr()
    {
        try { lookup = await Js.InvokeAsync<string>("ahmQr.scan"); await FindMember(); }
        catch (Exception ex) when (ex.Message.Contains("Scanning cancelled")) { }
        catch (Exception ex) { SetError(ex.Message.Contains("BarcodeDetector") ? "Camera scanning is not supported here. Paste the QR link or token." : "Couldn't scan the QR code. Try again or paste the member link."); }
    }

    private async Task CopyMemberUrl()
    {
        try { await Js.InvokeVoidAsync("navigator.clipboard.writeText", MemberUrl()); message = "Member link copied. Share it only with this customer."; messageIsError = false; }
        catch { SetError("Couldn't copy the member link. Try again or show the QR code."); }
    }
    private async Task PrepareMemberLinkAsync()
    {
        try { memberLink = await Api.CreateMemberLinkAsync(setup.GasUrl, member!.Token); }
        catch { memberLink = ""; SetError("Customer card loaded, but its QR link could not be created. Try finding the customer again."); }
    }
    private async Task CopyScript()
    {
        try { await Js.InvokeVoidAsync("ahmSetup.copyScript"); message = "Apps Script code copied. Paste it into Code.gs."; messageIsError = false; }
        catch { SetError("Couldn't copy the script. Open the code file and copy it manually."); }
    }
    private string MemberUrl() => memberLink.Length == 0 ? "" : Nav.BaseUri.TrimEnd('/') + "/member?c=" + Uri.EscapeDataString(memberLink);
    private static string Money(int value) => value.ToString("N0", System.Globalization.CultureInfo.InvariantCulture);
    private string ActionLabel(string action) => action switch { "STAMP_ADD" => legacyMode ? "Stamp Added" : "Stamps Earned", "CARD_COMPLETE" => legacyMode ? "Card Completed" : "Reward Choice Earned", "REWARD_SELECTED" => "Reward Selected", "REWARD_REDEEM" => "Reward Redeemed", "CASHBACK_PAYOUT" => "Cashback Paid Out", _ => action };
    private static string RewardLabel(ShopReward reward) => reward.Type switch { "CASHBACK" => $"{Money(reward.Value)} MMK cashback", "PERCENT_DISCOUNT" => $"{reward.Value}% off (up to {Money(reward.MaxDiscount)} MMK)", _ => "Free item" };
    private string HistoryDelta(Activity item) => item.Action switch
    {
        "STAMP_ADD" when legacyMode => "+1 stamp",
        "CARD_COMPLETE" when legacyMode => "+" + Money(item.Delta) + " MMK",
        "STAMP_ADD" => $"+{item.Delta} stamp(s)",
        "CARD_COMPLETE" => $"+{item.Delta} choice(s)",
        "REWARD_SELECTED" when item.Delta == 0 => "Reward chosen",
        "REWARD_REDEEM" when item.Delta == 0 => "Used",
        _ => (item.Delta >= 0 ? "+" : "") + Money(item.Delta) + " MMK"
    };
    private static string Query(Uri uri, string key) => uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries).Select(part => part.Split('=', 2)).Where(pair => Uri.UnescapeDataString(pair[0]) == key).Select(pair => pair.Length > 1 ? Uri.UnescapeDataString(pair[1]) : "").FirstOrDefault() ?? "";
    private async Task DismissMessage()
    {
        message = "";
        messageIsError = false;
        await Js.InvokeVoidAsync("ahmUi.focusById", "main-content");
    }
    private void SetError(string text) { message = text; messageIsError = true; }
    private void SetError(Exception ex) => SetError(ex is HttpRequestException or TaskCanceledException ? "Couldn't reach the shop. Check your connection and try again." : ex.Message);
    private async Task Run(Func<Task> action) { busy = true; message = ""; messageIsError = false; try { await action(); } catch (Exception ex) { SetError(ex); } finally { busy = false; } }
}
