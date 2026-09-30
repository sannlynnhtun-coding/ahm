namespace Ahm.Models;

public sealed class GooglePublicOptions
{
    public string ClientId { get; set; } = "";
    public string ApiKey { get; set; } = "";
    public string AppId { get; set; } = "";
    public bool IsConfigured => !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ApiKey) && !string.IsNullOrWhiteSpace(AppId);
}

public sealed class ShopSetup
{
    public string SpreadsheetId { get; set; } = "";
    public string PublicShopId { get; set; } = "";
    public string ShopName { get; set; } = "";
    public string StaffLabel { get; set; } = "";
    public ShopPolicy Policy { get; set; } = new();
    public List<ShopReward> Rewards { get; set; } = [ShopReward.DefaultCashback()];
}

public sealed class ShopPolicy
{
    public int MinSpendPerStamp { get; set; } = 10000;
    public int MaxStamps { get; set; } = 10;
    public int CashbackReward { get; set; } = 10000;
    public int MinWithdrawal { get; set; } = 1000;
    public bool AllowRollover { get; set; } = true;
}

public sealed class Member
{
    public string Phone { get; set; } = "";
    public string Name { get; set; } = "";
    public int Stamps { get; set; }
    public int SpendRemainder { get; set; }
    public int RewardCredits { get; set; }
    public List<MemberReward> Claims { get; set; } = [];
    public int AvailableCashback { get; set; }
    public int LifetimeCashback { get; set; }
    public string LastVisit { get; set; } = "";
    public string Token { get; set; } = "";
    public List<Activity> History { get; set; } = [];
}

public sealed class ShopReward
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "Cashback";
    public string Type { get; set; } = "CASHBACK";
    public int Value { get; set; } = 10000;
    public int MaxDiscount { get; set; }
    public int? StockQuantity { get; set; }
    public string Description { get; set; } = "";
    public bool Active { get; set; } = true;

    public static ShopReward DefaultCashback() => new();
}

public sealed class MemberReward
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Type { get; set; } = "";
    public int Value { get; set; }
    public int MaxDiscount { get; set; }
    public string Status { get; set; } = "";
    public string SelectedAt { get; set; } = "";
    public string RedeemedAt { get; set; } = "";
}

public sealed class Activity
{
    public string Action { get; set; } = "";
    public int Delta { get; set; }
    public string Note { get; set; } = "";
    public string Timestamp { get; set; } = "";
}

public sealed class GoogleShopState
{
    public ShopSetup Setup { get; set; } = new();
    public List<Member> Members { get; set; } = [];
    public List<LedgerDiagnostic> Diagnostics { get; set; } = [];
    public Dictionary<string, int> StockUsed { get; set; } = [];
}

public sealed class LedgerDiagnostic
{
    public int Row { get; set; }
    public string EventId { get; set; } = "";
    public string EventType { get; set; } = "";
    public string Reason { get; set; } = "";
}

public sealed class GoogleConnectionState
{
    public bool Configured { get; set; }
    public bool Connected { get; set; }
    public long ExpiresAt { get; set; }
}

public sealed class LedgerEvent
{
    public string EventId { get; set; } = Guid.NewGuid().ToString("N");
    public string EventType { get; set; } = "";
    public string MemberToken { get; set; } = "";
    public string PhoneNumber { get; set; } = "";
    public string ActorLabel { get; set; } = "";
    public string OccurredAtUtc { get; set; } = DateTimeOffset.UtcNow.ToString("O");
    public object Payload { get; set; } = new { };
    public int SchemaVersion { get; set; } = 3;
}
