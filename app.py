import json, os
from flask import Flask, jsonify, render_template, request
from flask_cors import CORS
from flask_socketio import SocketIO
from database import get_all_prices, get_latest_prices, get_stats_per_symbol
from scraper import start_scheduler
import yfinance as yf

app      = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

CONFIG_PATH  = os.path.join(os.path.dirname(__file__), "stocks_config.json")
DISPLAY_MAP  = {}   # ticker → display name, rebuilt on each watchlist call

def load_display_map():
    with open(CONFIG_PATH) as f:
        tickers = json.load(f)
    return {t: t.replace(".NS", "").replace(".BO", "") for t in tickers}

DISPLAY_MAP = load_display_map()

# Start background scraper, pass socketio for real-time push
scheduler = start_scheduler(socketio)


# ── PAGES ─────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


# ── STOCK DATA APIs ───────────────────────────────────────
@app.route("/api/stocks")
def api_stocks():
    return jsonify(get_all_prices())

@app.route("/api/stocks/latest")
def api_stocks_latest():
    return jsonify(get_latest_prices())

@app.route("/api/stocks/stats")
def api_stocks_stats():
    return jsonify(get_stats_per_symbol())

@app.route("/api/stocks/ohlc/<symbol>")
def api_ohlc(symbol):
    """Fetch today's 5-min OHLC for candlestick chart."""
    dm = load_display_map()
    reverse = {v: k for k, v in dm.items()}
    ticker  = reverse.get(symbol.upper())
    if not ticker:
        return jsonify({"error": "Unknown symbol"}), 404
    try:
        data = yf.download(ticker, period="1d", interval="5m", progress=False)
        if data.empty:
            return jsonify([])
        result = []
        for ts, row in data.iterrows():
            def _v(col):
                v = row[col]
                return float(v.iloc[0]) if hasattr(v, "iloc") else float(v)
            result.append({
                "x": int(ts.timestamp() * 1000),
                "o": round(_v("Open"), 2), "h": round(_v("High"), 2),
                "l": round(_v("Low"),  2), "c": round(_v("Close"), 2),
                "v": int(_v("Volume"))
            })
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── WATCHLIST APIs ────────────────────────────────────────
@app.route("/api/watchlist", methods=["GET"])
def api_watchlist_get():
    with open(CONFIG_PATH) as f:
        tickers = json.load(f)
    return jsonify(tickers)

@app.route("/api/watchlist/add", methods=["POST"])
def api_watchlist_add():
    ticker = request.json.get("ticker", "").upper().strip()
    if not ticker:
        return jsonify({"error": "No ticker provided"}), 400
    # Validate via yfinance
    try:
        info = yf.Ticker(ticker).fast_info
        if not info.last_price:
            return jsonify({"error": f"{ticker} returned no price — check the ticker symbol"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    with open(CONFIG_PATH) as f:
        tickers = json.load(f)
    if ticker not in tickers:
        tickers.append(ticker)
        with open(CONFIG_PATH, "w") as f:
            json.dump(tickers, f, indent=2)
    return jsonify({"ok": True, "tickers": tickers})

@app.route("/api/watchlist/remove", methods=["POST"])
def api_watchlist_remove():
    ticker = request.json.get("ticker", "").upper().strip()
    with open(CONFIG_PATH) as f:
        tickers = json.load(f)
    tickers = [t for t in tickers if t != ticker]
    with open(CONFIG_PATH, "w") as f:
        json.dump(tickers, f, indent=2)
    return jsonify({"ok": True, "tickers": tickers})


if __name__ == "__main__":
    socketio.run(app, debug=False, use_reloader=False, port=5000)
