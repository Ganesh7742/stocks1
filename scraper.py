import json
import logging
import os
import yfinance as yf
from apscheduler.schedulers.background import BackgroundScheduler
from database import insert_price, delete_old_records

logging.basicConfig(level=logging.INFO, format="%(asctime)s [SCRAPER] %(message)s")

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "stocks_config.json")

DISPLAY_NAMES = {}   # ticker → short name, populated on load
_socketio = None     # set by start_scheduler


def load_stocks():
    """Load tickers from stocks_config.json and build display name map."""
    global DISPLAY_NAMES
    with open(CONFIG_PATH) as f:
        tickers = json.load(f)
    DISPLAY_NAMES = {t: t.replace(".NS", "").replace(".BO", "") for t in tickers}
    return tickers


def fetch_and_store():
    """Fetch latest price for each configured stock and store in MongoDB."""
    tickers = load_stocks()
    for ticker in tickers:
        try:
            info  = yf.Ticker(ticker).fast_info
            price = info.last_price
            if not price:
                logging.warning(f"No price for {ticker}, skipping.")
                continue
            symbol = DISPLAY_NAMES[ticker]
            insert_price(symbol, price)
            logging.info(f"{symbol}: ₹{price:.2f}")
            # Emit real-time update via WebSocket
            if _socketio:
                from datetime import datetime
                _socketio.emit("price_update", {
                    "symbol": symbol,
                    "price":  round(price, 2),
                    "time":   datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
                })
        except Exception as e:
            logging.error(f"Error fetching {ticker}: {e}")


def cleanup_old_data():
    """Run daily to delete records older than 7 days."""
    deleted = delete_old_records(days=7)
    logging.info(f"Cleanup: removed {deleted} old records.")


def start_scheduler(socketio=None):
    """Start APScheduler — pass socketio instance for real-time push."""
    global _socketio
    _socketio = socketio
    scheduler = BackgroundScheduler()
    scheduler.add_job(fetch_and_store, "interval", seconds=60, id="stock_fetch", replace_existing=True)
    scheduler.add_job(cleanup_old_data, "interval", hours=24,  id="cleanup",     replace_existing=True)
    scheduler.start()
    logging.info("Scheduler started — fetching every 60 seconds.")
    fetch_and_store()   # Run immediately on startup
    return scheduler
