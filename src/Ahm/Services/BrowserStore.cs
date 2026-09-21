using Ahm.Models;
using Microsoft.JSInterop;

namespace Ahm.Services;

public sealed class BrowserStore(IJSRuntime js)
{
    public ValueTask<ShopSetup?> GetSetupAsync() => js.InvokeAsync<ShopSetup?>("ahmStore.get", "ShopCredentialsStore", "current");
    public ValueTask SaveSetupAsync(ShopSetup setup) => js.InvokeVoidAsync("ahmStore.put", "ShopCredentialsStore", "current", setup);
    public ValueTask<ShopPolicy?> GetPolicyAsync() => js.InvokeAsync<ShopPolicy?>("ahmStore.get", "PolicyStore", "current");
    public ValueTask SavePolicyAsync(ShopPolicy policy) => js.InvokeVoidAsync("ahmStore.put", "PolicyStore", "current", policy);
    public ValueTask<Member?> GetCachedMemberAsync() => js.InvokeAsync<Member?>("ahmStore.get", "CustomerCacheStore", "current");
    public ValueTask SaveCachedMemberAsync(Member member) => js.InvokeVoidAsync("ahmStore.put", "CustomerCacheStore", "current", member);
}
