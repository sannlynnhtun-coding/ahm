using System.Net.Http.Json;
using System.Text.Json;
using Ahm.Models;

namespace Ahm.Services;

public sealed class SheetApi(HttpClient http)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<SheetResult> SendAsync(SheetRequest request)
    {
        using var response = await http.PostAsJsonAsync("api/sheets", request, Json);
        var result = await response.Content.ReadFromJsonAsync<SheetResult>(Json);
        if (result is null) throw new InvalidOperationException("Empty response from the sheet service.");
        if (!response.IsSuccessStatusCode || !result.Ok)
            throw new InvalidOperationException(result.Error ?? "The sheet request failed.");
        if (result.SchemaVersion < 2)
            throw new InvalidOperationException("Update the shop's Apps Script to the latest Ahm code and redeploy it before continuing.");
        return result;
    }

    public async Task CheckVersionAsync(string url)
    {
        try { await SendAsync(new SheetRequest { Url = url, Action = "version" }); }
        catch (InvalidOperationException ex) when (ex.Message.Contains("Invalid cashier PIN", StringComparison.OrdinalIgnoreCase) || ex.Message.Contains("Unknown action", StringComparison.OrdinalIgnoreCase) || ex.Message.Contains("Update the shop's Apps Script", StringComparison.OrdinalIgnoreCase))
        { throw new InvalidOperationException("Update the shop's Apps Script to the latest Ahm code and redeploy it before continuing."); }
    }

    public async Task<string> CreateMemberLinkAsync(string url, string token)
    {
        using var response = await http.PostAsJsonAsync("api/member", new { url, token }, Json);
        var result = await ReadMemberResponseAsync(response);
        return result.Code ?? throw new InvalidOperationException("Member link was not returned.");
    }

    public async Task<SheetResult> GetMemberAsync(string code)
    {
        using var response = await http.GetAsync("api/member?code=" + Uri.EscapeDataString(code));
        return await ReadMemberResponseAsync(response);
    }

    public async Task<SheetResult> ClaimRewardAsync(string code, string rewardId, string requestId)
    {
        using var response = await http.PostAsJsonAsync("api/member", new { action = "claim", code, rewardId, requestId }, Json);
        var result = await ReadMemberResponseAsync(response);
        if (result.SchemaVersion < 2) throw new InvalidOperationException("This shop must update its Apps Script before rewards can be selected.");
        return result;
    }

    public async Task<SheetResult> FindMemberByCodeAsync(string code, string url, string pin)
    {
        using var response = await http.PostAsJsonAsync("api/member", new { code, url, pin }, Json);
        var result = await ReadMemberResponseAsync(response);
        if (result.SchemaVersion < 2) throw new InvalidOperationException("Update the shop's Apps Script to the latest Ahm code and redeploy it before continuing.");
        return result;
    }

    private static async Task<SheetResult> ReadMemberResponseAsync(HttpResponseMessage response)
    {
        var result = await response.Content.ReadFromJsonAsync<SheetResult>(Json);
        if (result is null) throw new InvalidOperationException("Empty response from the member service.");
        if (!response.IsSuccessStatusCode || !result.Ok)
            throw new InvalidOperationException(result.Error ?? "The member request failed.");
        return result;
    }
}
