using Ahm.Models;
using Microsoft.JSInterop;

namespace Ahm.Services;

public sealed class BrowserStore(IJSRuntime js)
{
    private const string ConnectionStore = "ShopConnectionStore";
    private const string PreferenceStore = "PreferenceStore";

    public ValueTask<ShopSetup?> GetSetupAsync() => js.InvokeAsync<ShopSetup?>("ahmStore.get", ConnectionStore, "current");
    public ValueTask SaveSetupAsync(ShopSetup setup) => js.InvokeVoidAsync("ahmStore.put", ConnectionStore, "current", setup);
    public ValueTask RemoveSetupAsync() => js.InvokeVoidAsync("ahmStore.remove", ConnectionStore, "current");
    public ValueTask<LegacyShopSetup?> GetLegacySetupAsync() => js.InvokeAsync<LegacyShopSetup?>("ahmStore.get", "ShopCredentialsStore", "current");
    public async ValueTask<string> GetLanguageAsync() => await js.InvokeAsync<string?>("ahmStore.get", PreferenceStore, "language") ?? "my";
    public ValueTask SaveLanguageAsync(string language) => js.InvokeVoidAsync("ahmStore.put", PreferenceStore, "language", language);
}
