namespace Ahm.Models;

public sealed class ShopSetup
{
    public string ShopName { get; set; } = "";
    public string GasUrl { get; set; } = "";
    public ShopPolicy Policy { get; set; } = new();
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
    public int AvailableCashback { get; set; }
    public int LifetimeCashback { get; set; }
    public string LastVisit { get; set; } = "";
    public string Token { get; set; } = "";
    public List<Activity> History { get; set; } = [];
}

public sealed class Activity
{
    public string Action { get; set; } = "";
    public int Delta { get; set; }
    public string Note { get; set; } = "";
    public string Timestamp { get; set; } = "";
}

public sealed class SheetResult
{
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public Member? Member { get; set; }
    public ShopPolicy? Policy { get; set; }
    public string? ShopName { get; set; }
    public string? Code { get; set; }
}

public sealed class SheetRequest
{
    public string Url { get; set; } = "";
    public string Action { get; set; } = "";
    public string? Pin { get; set; }
    public string? Phone { get; set; }
    public string? Name { get; set; }
    public string? Token { get; set; }
    public string? ShopName { get; set; }
    public ShopPolicy? Policy { get; set; }
    public int? Spend { get; set; }
    public int? Amount { get; set; }
    public string? RequestId { get; set; }
}
