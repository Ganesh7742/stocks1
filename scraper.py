import json
import logging
import os
import time
import yfinance as yf
from apscheduler.schedulers.background import BackgroundScheduler
from database import insert_price, delete_old_records

logging.basicConfig(level=logging.INFO, format="%(asctime)s [SCRAPER] %(message)s")

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "stocks_config.json")
FETCH_INTERVAL_SECONDS = int(os.getenv("FETCH_INTERVAL_SECONDS", "180"))
REQUEST_DELAY_SECONDS = float(os.getenv("YF_REQUEST_DELAY_SECONDS", "1.5"))
MAX_RETRIES = int(os.getenv("YF_MAX_RETRIES", "2"))
RETRY_BACKOFF_SECONDS = float(os.getenv("YF_RETRY_BACKOFF_SECONDS", "2.0"))

DISPLAY_NAMES = {}   # ticker → short name, populated on load
_socketio = None     # set by start_scheduler


def load_stocks():
    """Load tickers from stocks_config.json and build display name map."""
    global DISPLAY_NAMES
    with open(CONFIG_PATH) as f:
        tickers = json.load(f)
    DISPLAY_NAMES = {t: t.replace(".NS", "").replace(".BO", "") for t in tickers}
    return tickers


def fetch_price_with_retry(ticker: str):
    """Fetch price with small retry/backoff on transient/rate-limit failures."""
    for attempt in range(MAX_RETRIES + 1):
        try:
            info = yf.Ticker(ticker).fast_info
            price = info.last_price
            if price:
                return float(price)
            logging.warning(f"No price for {ticker}, skipping.")
            return None
        except Exception as e:
            msg = str(e)
            rate_limited = "Too Many Requests" in msg or "Rate limited" in msg or "429" in msg
            if rate_limited and attempt < MAX_RETRIES:
                wait = RETRY_BACKOFF_SECONDS * (attempt + 1)
                logging.warning(
                    f"Rate limited for {ticker}. Retrying in {wait:.1f}s "
                    f"({attempt + 1}/{MAX_RETRIES})"
                )
                time.sleep(wait)
                continue

            logging.error(f"Error fetching {ticker}: {e}")
            return None

    return None


def fetch_and_store():
    """Fetch latest price for each configured stock and store in Supabase."""
    tickers = load_stocks()
    for index, ticker in enumerate(tickers):
        # Small spacing between calls helps avoid burst throttling.
        if index > 0 and REQUEST_DELAY_SECONDS > 0:
            time.sleep(REQUEST_DELAY_SECONDS)

        price = fetch_price_with_retry(ticker)
        if not price:
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


def cleanup_old_data():
    """Run daily to delete records older than 7 days."""
    deleted = delete_old_records(days=7)
    logging.info(f"Cleanup: removed {deleted} old records.")


def start_scheduler(socketio=None):
    """Start APScheduler — pass socketio instance for real-time push."""
    global _socketio
    _socketio = socketio
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        fetch_and_store,
        "interval",
        seconds=FETCH_INTERVAL_SECONDS,
        id="stock_fetch",
        replace_existing=True,
    )
    scheduler.add_job(cleanup_old_data, "interval", hours=24,  id="cleanup",     replace_existing=True)
    scheduler.start()
    logging.info(f"Scheduler started — fetching every {FETCH_INTERVAL_SECONDS} seconds.")
    fetch_and_store()   # Run immediately on startup
    return scheduler
