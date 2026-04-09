import yfinance as yf

tickers = ["TATAMOTORS.NS", "TATAMOTORS.BO", "TATAMOTOR.NS"]
for t in tickers:
    try:
        info = yf.Ticker(t).fast_info
        price = info.last_price
        print(f"{t}: {price}")
    except Exception as e:
        print(f"{t}: ERROR - {e}")
