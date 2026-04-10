from datetime import datetime, timedelta
import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
TABLE_NAME = os.getenv("SUPABASE_TABLE", "stock")

_client = None


def get_table():
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_KEY:
            raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set")
        _client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _client.table(TABLE_NAME)


def _parse_time(value: str) -> datetime:
    # Supabase returns ISO8601 timestamps; normalize trailing Z for fromisoformat.
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _format_time(value: str) -> str:
    parsed = _parse_time(value)
    return parsed.strftime("%Y-%m-%d %H:%M:%S")


def check_db_connection():
    """Validate Supabase credentials/table access."""
    try:
        get_table().select("timestamp").limit(1).execute()
        return True, "ok"
    except Exception as exc:
        return False, str(exc)


def insert_price(symbol: str, price: float):
    """Insert a new stock price row."""
    row = {
        "symbol": symbol,
        "price": round(price, 2),
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }
    get_table().insert(row).execute()


def get_all_prices():
    """Return all historical records sorted by timestamp ascending."""
    response = get_table().select("symbol,price,timestamp").order("timestamp", desc=False).execute()
    rows = response.data or []
    return [
        {
            "symbol": row["symbol"],
            "price": float(row["price"]),
            "time": _format_time(row["timestamp"]),
        }
        for row in rows
    ]


def get_latest_prices():
    """Return only the latest price row for each stock symbol."""
    response = get_table().select("symbol,price,timestamp").order("timestamp", desc=False).execute()
    rows = response.data or []

    latest_by_symbol = {}
    for row in rows:
        latest_by_symbol[row["symbol"]] = row

    return [
        {
            "symbol": symbol,
            "price": float(row["price"]),
            "time": _format_time(row["timestamp"]),
        }
        for symbol, row in sorted(latest_by_symbol.items())
    ]


def get_stats_per_symbol():
    """Return min/max/avg/count and % change from first to last price per symbol."""
    response = get_table().select("symbol,price,timestamp").order("timestamp", desc=False).execute()
    rows = response.data or []

    grouped = {}
    for row in rows:
        symbol = row["symbol"]
        grouped.setdefault(symbol, []).append(float(row["price"]))

    results = []
    for symbol in sorted(grouped.keys()):
        prices = grouped[symbol]
        first = prices[0]
        last = prices[-1]
        pct = round(((last - first) / first * 100), 2) if first else 0
        results.append(
            {
                "symbol": symbol,
                "min": round(min(prices), 2),
                "max": round(max(prices), 2),
                "avg": round(sum(prices) / len(prices), 2),
                "count": len(prices),
                "pct_change": pct,
            }
        )
    return results


def delete_old_records(days: int = 7):
    """Delete all rows older than `days` days to keep Supabase lean."""
    cutoff = datetime.utcnow() - timedelta(days=days)
    cutoff_iso = cutoff.isoformat() + "Z"

    old_rows = get_table().select("timestamp").lt("timestamp", cutoff_iso).execute().data or []
    if not old_rows:
        return 0

    get_table().delete().lt("timestamp", cutoff_iso).execute()
    return len(old_rows)
