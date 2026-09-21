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
        return result;
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

    public async Task<SheetResult> FindMemberByCodeAsync(string code, string url, string pin)
    {
        using var response = await http.PostAsJsonAsync("api/member", new { code, url, pin }, Json);
        return await ReadMemberResponseAsync(response);
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
