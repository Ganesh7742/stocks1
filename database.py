from pymongo import MongoClient
from datetime import datetime, timedelta

MONGO_URI = "mongodb://localhost:27017/"
DB_NAME = "stock_db"
COLLECTION_NAME = "stock_prices"

_client = None


def get_collection():
    global _client
    if _client is None:
        _client = MongoClient(MONGO_URI)
    db = _client[DB_NAME]
    return db[COLLECTION_NAME]


def insert_price(symbol: str, price: float):
    """Insert a new stock price document."""
    collection = get_collection()
    doc = {
        "symbol": symbol,
        "price": round(price, 2),
        "timestamp": datetime.utcnow()
    }
    collection.insert_one(doc)


def get_all_prices():
    """Return all historical records sorted by timestamp ascending."""
    collection = get_collection()
    cursor = collection.find({}, {"_id": 0}).sort("timestamp", 1)
    results = []
    for doc in cursor:
        results.append({
            "symbol": doc["symbol"],
            "price": doc["price"],
            "time": doc["timestamp"].strftime("%Y-%m-%d %H:%M:%S")
        })
    return results


def get_latest_prices():
    """Return only the latest price document for each stock symbol."""
    collection = get_collection()
    pipeline = [
        {"$sort": {"timestamp": -1}},
        {
            "$group": {
                "_id": "$symbol",
                "symbol": {"$first": "$symbol"},
                "price": {"$first": "$price"},
                "time": {"$first": "$timestamp"}
            }
        },
        {"$project": {"_id": 0, "symbol": 1, "price": 1, "time": 1}}
    ]
    results = []
    for doc in collection.aggregate(pipeline):
        doc["time"] = doc["time"].strftime("%Y-%m-%d %H:%M:%S")
        results.append(doc)
    return results


def get_stats_per_symbol():
    """Return min/max/avg/count and % change from first to last price per symbol."""
    collection = get_collection()
    pipeline = [
        {"$sort": {"timestamp": 1}},
        {
            "$group": {
                "_id": "$symbol",
                "min_price":   {"$min": "$price"},
                "max_price":   {"$max": "$price"},
                "avg_price":   {"$avg": "$price"},
                "count":       {"$sum": 1},
                "first_price": {"$first": "$price"},
                "last_price":  {"$last": "$price"},
            }
        },
        {"$sort": {"_id": 1}}
    ]
    results = []
    for doc in collection.aggregate(pipeline):
        first = doc["first_price"]
        last  = doc["last_price"]
        pct   = round(((last - first) / first * 100), 2) if first else 0
        results.append({
            "symbol":     doc["_id"],
            "min":        round(doc["min_price"], 2),
            "max":        round(doc["max_price"], 2),
            "avg":        round(doc["avg_price"], 2),
            "count":      doc["count"],
            "pct_change": pct,
        })
    return results


def delete_old_records(days: int = 7):
    """Delete all records older than `days` days to keep MongoDB lean."""
    collection = get_collection()
    cutoff = datetime.utcnow() - timedelta(days=days)
    result = collection.delete_many({"timestamp": {"$lt": cutoff}})
    return result.deleted_count
