using Ahm.Models;
using Microsoft.JSInterop;

namespace Ahm.Services;

public sealed class GoogleSheetsService(IJSRuntime js)
{
    public ValueTask<GoogleConnectionState> ConfigureAsync(GooglePublicOptions options) =>
        js.InvokeAsync<GoogleConnectionState>("ahmGoogle.configure", options);

    public ValueTask<GoogleConnectionState> AuthorizeAsync() =>
        js.InvokeAsync<GoogleConnectionState>("ahmGoogle.authorize");

    public ValueTask<GoogleConnectionState> GetConnectionStateAsync() =>
        js.InvokeAsync<GoogleConnectionState>("ahmGoogle.connectionState");

    public ValueTask DisconnectAsync() => js.InvokeVoidAsync("ahmGoogle.disconnect");

    public ValueTask<GoogleShopState> CreateShopAsync(ShopSetup setup) =>
        js.InvokeAsync<GoogleShopState>("ahmGoogle.createShop", setup);

    public ValueTask<GoogleShopState> ConnectExistingAsync(string staffLabel) =>
        js.InvokeAsync<GoogleShopState>("ahmGoogle.connectExisting", staffLabel);

    public ValueTask<GoogleShopState> LoadShopAsync(string spreadsheetId, string staffLabel) =>
        js.InvokeAsync<GoogleShopState>("ahmGoogle.loadShop", spreadsheetId, staffLabel);

    public ValueTask<GoogleShopState> SaveConfigurationAsync(ShopSetup setup) =>
        js.InvokeAsync<GoogleShopState>("ahmGoogle.saveConfiguration", setup);

    public ValueTask<GoogleShopState> AppendEventAsync(ShopSetup setup, string eventType, Member member, object payload, string? eventId = null)
    {
        var ledgerEvent = new LedgerEvent
        {
            EventId = eventId ?? Guid.NewGuid().ToString("N"),
            EventType = eventType,
            MemberToken = member.Token,
            PhoneNumber = member.Phone,
            ActorLabel = setup.StaffLabel,
            Payload = payload
        };
        return js.InvokeAsync<GoogleShopState>("ahmGoogle.appendEvent", setup.SpreadsheetId, ledgerEvent, setup.StaffLabel);
    }

    public ValueTask<GoogleShopState> MigrateLegacyAsync(string gasUrl, string actorLabel) =>
        js.InvokeAsync<GoogleShopState>("ahmGoogle.migrateLegacy", gasUrl, actorLabel);

    public ValueTask<string> ResolveLegacyPathAsync(string gasUrl, string memberToken) =>
        js.InvokeAsync<string>("ahmGoogle.resolveLegacyPath", gasUrl, memberToken);
}
