/* ============================================================
   Indian Stock Dashboard — dashboard.js (Full Feature Edition)
   ============================================================ */

const REFRESH_INTERVAL = 60000;

const STOCK_META = {
  RELIANCE:   { name: "Reliance Industries", color: "#6c63ff" },
  TCS:        { name: "Tata Consultancy",    color: "#00d4aa" },
  INFY:       { name: "Infosys",             color: "#f7971e" },
  HDFCBANK:   { name: "HDFC Bank",           color: "#e040fb" },
  WIPRO:      { name: "Wipro",               color: "#00b0ff" },
  TATAMOTORS: { name: "Tata Motors",         color: "#ff5252" },
};

/* ── STATE ───────────────────────────────────────────────── */
let allHistory      = [];
let previousPrices  = {};
let chartInstances  = {};
let sparkInstances  = {};
let compareInstance = null;
let candleInstance  = null;
let volumeInstance  = null;
let activeAlerts    = JSON.parse(localStorage.getItem("stockAlerts") || "{}");
let portfolio       = JSON.parse(localStorage.getItem("portfolio")    || "{}");
let currentFilter   = 0;
let currentCandle   = "";
let showMA          = true;
let showTrend       = true;
let showRSI         = false;
let knownSymbols    = Object.keys(STOCK_META);

/* ── AUDIO – sound alert ─────────────────────────────────── */
const AudioCtx = window.AudioContext || window.webkitAudioContext;
function playAlertBeep() {
  try {
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "sine"; osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start(); osc.stop(ctx.currentTime + 0.6);
  } catch (_) {}
}

/* ── HELPERS ──────────────────────────────────────────────── */
function fmt(price) {
  return "₹" + Number(price).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts.endsWith("Z") ? ts : ts + "Z");
  return d.toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:true, timeZone:"Asia/Kolkata" });
}
function nowIST() {
  return new Date(new Date().toLocaleString("en-US", { timeZone:"Asia/Kolkata" }));
}
function metaFor(sym) {
  return STOCK_META[sym] || { name: sym, color: "#6c63ff" };
}

/* ── THEME TOGGLE ─────────────────────────────────────────── */
function setupTheme() {
  const btn  = document.getElementById("btn-theme");
  const html = document.documentElement;
  const saved = localStorage.getItem("theme") || "dark";
  html.setAttribute("data-theme", saved);
  btn.textContent = saved === "dark" ? "🌙" : "☀️";
  btn.addEventListener("click", () => {
    const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", next);
    btn.textContent = next === "dark" ? "🌙" : "☀️";
    localStorage.setItem("theme", next);
  });
}

/* ── MARKET STATUS ────────────────────────────────────────── */
function updateMarketStatus() {
  const now = nowIST();
  const day = now.getDay();
  const min = now.getHours() * 60 + now.getMinutes();
  const open = day >= 1 && day <= 5 && min >= 555 && min <= 930;
  const el   = document.getElementById("market-status");
  if (!el) return;
  el.innerHTML = open
    ? `<span class="dot dot-green"></span> NSE Open`
    : `<span class="dot dot-red"></span> NSE Closed`;
  el.className = `market-status ${open ? "open" : "closed"}`;
}

/* ── TICKER TAPE ──────────────────────────────────────────── */
function updateTickerTape(data) {
  const el = document.getElementById("ticker-content");
  if (!el || !data.length) return;
  const items = data.map(s => {
    const prev  = previousPrices[s.symbol];
    const dir   = prev == null ? "" : s.price >= prev ? "tick-up" : "tick-down";
    const arrow = dir === "tick-up" ? "▲" : dir === "tick-down" ? "▼" : "—";
    return `<span class="tick-item ${dir}">${s.symbol}&nbsp;${fmt(s.price)}&nbsp;${arrow}</span>`;
  }).join('<span class="tick-sep">&nbsp;|&nbsp;</span>');
  el.innerHTML = items + '<span class="tick-sep">&nbsp;&nbsp;&nbsp;</span>' + items;
}

/* ── PERFORMERS ───────────────────────────────────────────── */
function updatePerformers(stats) {
  const el = document.getElementById("performers-banner");
  if (!el || !stats.length) return;
  const sorted = [...stats].sort((a, b) => b.pct_change - a.pct_change);
  const best = sorted[0], worst = sorted[sorted.length - 1];
  el.innerHTML = `
    <div class="perf-card perf-best">
      <span class="perf-label">🏆 Best Performer</span>
      <span class="perf-symbol" style="color:${metaFor(best.symbol).color}">${best.symbol}</span>
      <span class="perf-change up">▲ ${best.pct_change}%</span>
    </div>
    <span class="perf-mid">vs</span>
    <div class="perf-card perf-worst">
      <span class="perf-label">📉 Worst Performer</span>
      <span class="perf-symbol" style="color:${metaFor(worst.symbol).color}">${worst.symbol}</span>
      <span class="perf-change down">▼ ${Math.abs(worst.pct_change)}%</span>
    </div>`;
}

/* ── HEATMAP ──────────────────────────────────────────────── */
function updateHeatmap(stats) {
  const grid = document.getElementById("heatmap-grid");
  if (!grid || !stats.length) return;
  grid.innerHTML = "";
  for (const s of stats) {
    const pct    = s.pct_change;
    const green  = Math.min(Math.floor(Math.abs(pct) * 30), 120);
    const bg     = pct >= 0 ? `rgba(0,${180 + green},80,0.25)` : `rgba(${180 + green},50,50,0.25)`;
    const border = pct >= 0 ? `rgba(0,230,118,0.4)` : `rgba(255,82,82,0.4)`;
    const sign   = pct >= 0 ? "▲" : "▼";
    const cell   = document.createElement("div");
    cell.className = "heat-cell";
    cell.style.cssText = `background:${bg}; border:1px solid ${border}; color:${pct >= 0 ? "#00e676" : "#ff5252"}`;
    cell.innerHTML = `<span class="heat-sym">${s.symbol}</span><span class="heat-pct">${sign} ${Math.abs(pct)}%</span>`;
    grid.appendChild(cell);
  }
}

/* ── ANIMATED COUNTER ─────────────────────────────────────── */
function animateCounter(el, from, to, dur = 700) {
  if (isNaN(from) || isNaN(to) || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const tick = now => {
    const p = Math.min((now - t0) / dur, 1);
    const e = p < .5 ? 2*p*p : -1+(4-2*p)*p;
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(tick); else el.textContent = fmt(to);
  };
  requestAnimationFrame(tick);
}

/* ── CARDS ────────────────────────────────────────────────── */
function renderCards(data) {
  const grid    = document.getElementById("cards-grid");
  const isFirst = !!grid.querySelector(".skeleton-card");
  if (isFirst) {
    grid.innerHTML = "";
    for (const s of data) {
      const meta = metaFor(s.symbol);
      const div  = document.createElement("div");
      div.className = "stock-card"; div.id = `card-${s.symbol}`;
      div.innerHTML = `
        <div class="card-top">
          <div>
            <div class="card-symbol" style="color:${meta.color}">${s.symbol}</div>
            <div class="card-name">${meta.name}</div>
          </div>
          <canvas class="sparkline-canvas" id="spark-${s.symbol}" width="84" height="38"></canvas>
        </div>
        <div class="card-price"  id="price-${s.symbol}">${fmt(s.price)}</div>
        <div class="card-change flat" id="change-${s.symbol}">— —</div>
        <div class="card-time"   id="time-${s.symbol}">Updated: ${fmtTime(s.time)}</div>
        <div class="alert-indicator" id="alert-ind-${s.symbol}"></div>`;
      grid.appendChild(div);
    }
  } else {
    for (const s of data) {
      const priceEl  = document.getElementById(`price-${s.symbol}`);
      const changeEl = document.getElementById(`change-${s.symbol}`);
      const timeEl   = document.getElementById(`time-${s.symbol}`);
      if (!priceEl) continue;
      const prev = previousPrices[s.symbol], curr = s.price;
      timeEl.textContent = "Updated: " + fmtTime(s.time);
      if (prev != null && prev !== curr) {
        animateCounter(priceEl, prev, curr);
        const diff = curr - prev, pct = ((diff/prev)*100).toFixed(2);
        const arrow = diff > 0 ? "▲" : "▼", cls = diff > 0 ? "up" : "down";
        changeEl.className   = `card-change ${cls}`;
        changeEl.textContent = `${arrow} ₹${Math.abs(diff).toFixed(2)} (${pct}%)`;
        const card = document.getElementById(`card-${s.symbol}`);
        if (card) { card.classList.add(diff>0?"flash-up":"flash-down"); setTimeout(()=>card.classList.remove("flash-up","flash-down"), 1200); }
      } else { priceEl.textContent = fmt(curr); }
      checkAlert(s.symbol, curr);
    }
  }
  for (const s of data) previousPrices[s.symbol] = s.price;
  // Refresh portfolio table with new prices
  renderPortfolioTable();
}

/* ── SPARKLINES ───────────────────────────────────────────── */
function updateSparklines(history) {
  const grouped = {};
  for (const r of history) { if (!grouped[r.symbol]) grouped[r.symbol]=[]; grouped[r.symbol].push(r.price); }
  for (const [sym, prices] of Object.entries(grouped)) {
    const canvas = document.getElementById(`spark-${sym}`); if (!canvas) continue;
    const last = prices.slice(-24), meta = metaFor(sym);
    if (sparkInstances[sym]) { sparkInstances[sym].data.datasets[0].data=last; sparkInstances[sym].update("none"); }
    else {
      sparkInstances[sym] = new Chart(canvas.getContext("2d"), {
        type:"line",
        data:{ labels:last.map((_,i)=>i), datasets:[{ data:last, borderColor:meta.color, borderWidth:1.5, pointRadius:0, fill:true, backgroundColor:meta.color+"22", tension:.4 }] },
        options:{ animation:false, responsive:false, plugins:{legend:{display:false},tooltip:{enabled:false}}, scales:{x:{display:false},y:{display:false}} }
      });
    }
  }
}

/* ── STATS ────────────────────────────────────────────────── */
function renderStats(stats) {
  const grid = document.getElementById("stats-grid"); if (!grid||!stats.length) return;
  grid.innerHTML = "";
  for (const s of stats) {
    const meta=metaFor(s.symbol), cls=s.pct_change>=0?"up":"down", arrow=s.pct_change>=0?"▲":"▼";
    const div=document.createElement("div"); div.className="stat-card";
    div.innerHTML=`
      <div class="stat-symbol" style="color:${meta.color}">${s.symbol}</div>
      <div class="stat-row"><span>High</span><span class="up">₹${s.max.toLocaleString("en-IN")}</span></div>
      <div class="stat-row"><span>Low</span><span class="down">₹${s.min.toLocaleString("en-IN")}</span></div>
      <div class="stat-row"><span>Avg</span><span>₹${Number(s.avg).toFixed(2)}</span></div>
      <div class="stat-row"><span>Data pts</span><span>${s.count}</span></div>
      <div class="stat-change ${cls}">${arrow} ${Math.abs(s.pct_change)}% since tracking</div>`;
    grid.appendChild(div);
  }
}

/* ── MATHS: MA / RSI / Trend ──────────────────────────────── */
function movingAvg(prices, period) {
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    const slice = prices.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}
function calcRSI(prices, period = 14) {
  return prices.map((_, i) => {
    if (i < period) return null;
    let g=0, l=0;
    for (let j = i-period+1; j <= i; j++) { const d=prices[j]-prices[j-1]; d>0?g+=d:l-=d; }
    const rs = l===0 ? 100 : g/period / (l/period);
    return parseFloat((100-100/(1+rs)).toFixed(2));
  });
}
function linearTrend(prices) {
  const n=prices.length; let sx=0,sy=0,sxy=0,sx2=0;
  prices.forEach((y,x)=>{sx+=x;sy+=y;sxy+=x*y;sx2+=x*x;});
  const slope=(n*sxy-sx*sy)/(n*sx2-sx*sx), intercept=(sy-slope*sx)/n;
  return prices.map((_,x)=>parseFloat((slope*x+intercept).toFixed(2)));
}

/* ── HISTORY CHARTS ───────────────────────────────────────── */
function filteredHistory() {
  if (currentFilter===0) return allHistory;
  const cutoff = Date.now()-currentFilter*60*1000;
  return allHistory.filter(r=>new Date(r.time.endsWith("Z")?r.time:r.time+"Z").getTime()>=cutoff);
}

function renderCharts(data) {
  const grid = document.getElementById("charts-grid");
  const grouped = {};
  for (const r of data) { if (!grouped[r.symbol])grouped[r.symbol]=[]; grouped[r.symbol].push(r); }

  for (const [sym, rows] of Object.entries(grouped)) {
    const meta   = metaFor(sym);
    const labels = rows.map(r=>fmtTime(r.time));
    const prices = rows.map(r=>r.price);
    const ma7    = showMA    ? movingAvg(prices, 7)    : [];
    const ma20   = showMA    ? movingAvg(prices, 20)   : [];
    const trend  = showTrend ? linearTrend(prices)     : [];
    const rsi    = showRSI   ? calcRSI(prices)         : [];

    const datasets = [
      { label:sym,  data:prices, borderColor:meta.color, backgroundColor:meta.color+"33", borderWidth:2, pointRadius:1.5, fill:true, tension:.4 },
    ];
    if (showMA && prices.length>7)  datasets.push({ label:"MA7",  data:ma7,  borderColor:"#ffd740", borderWidth:1.5, pointRadius:0, borderDash:[4,3], fill:false, tension:.4 });
    if (showMA && prices.length>20) datasets.push({ label:"MA20", data:ma20, borderColor:"#22d3ee", borderWidth:1.5, pointRadius:0, borderDash:[6,4], fill:false, tension:.4 });
    if (showTrend) datasets.push({ label:"Trend", data:trend, borderColor:"rgba(255,255,255,0.25)", borderWidth:1.5, pointRadius:0, borderDash:[2,4], fill:false, tension:0 });

    if (chartInstances[sym]) {
      chartInstances[sym].data.labels   = labels;
      chartInstances[sym].data.datasets = datasets;
      chartInstances[sym].update("active");
    } else {
      const card = document.createElement("div"); card.className="chart-card"; card.id=`chart-card-${sym}`;
      card.innerHTML = `
        <div class="chart-header">
          <span class="chart-symbol" style="color:${meta.color}">${sym}
            <span style="color:var(--text-muted);font-weight:400;font-size:.75rem">— ${meta.name}</span>
          </span>
          <span class="chart-points" id="pts-${sym}">${rows.length} pts</span>
        </div>
        <div class="chart-wrapper"><canvas id="chart-${sym}"></canvas></div>
        ${showRSI&&rsi.filter(v=>v!=null).length>0 ? `<div class="chart-wrapper" style="height:70px;margin-top:6px"><canvas id="rsi-${sym}"></canvas></div>` : ""}`;
      grid.appendChild(card);

      const ctx = document.getElementById(`chart-${sym}`).getContext("2d");
      chartInstances[sym] = new Chart(ctx, {
        type:"line", data:{ labels, datasets },
        options:{
          responsive:true, maintainAspectRatio:false, animation:{duration:500},
          plugins:{
            legend:{ display:showMA||showTrend, position:"top", labels:{ color:"#8892b0", boxWidth:24, font:{size:10} } },
            tooltip:{ backgroundColor:"rgba(11,15,26,.97)", borderColor:meta.color, borderWidth:1, titleColor:meta.color, bodyColor:"#f0f4ff",
              callbacks:{ label:ctx=>"  "+fmt(ctx.parsed.y) } }
          },
          scales:{
            x:{ ticks:{color:"#8892b0",maxTicksLimit:6,maxRotation:0,font:{size:10}}, grid:{color:"rgba(255,255,255,0.04)"} },
            y:{ ticks:{color:"#8892b0",font:{size:10},callback:v=>"₹"+v.toLocaleString("en-IN")}, grid:{color:"rgba(255,255,255,0.04)"} }
          }
        }
      });
      // RSI sub-chart
      if (showRSI && document.getElementById(`rsi-${sym}`)) {
        new Chart(document.getElementById(`rsi-${sym}`).getContext("2d"), {
          type:"line", data:{ labels, datasets:[{ label:"RSI", data:rsi, borderColor:"#e040fb", borderWidth:1.5, pointRadius:0, fill:false, tension:.4 }] },
          options:{
            responsive:true, maintainAspectRatio:false, animation:false,
            plugins:{ legend:{display:false}, tooltip:{enabled:false} },
            scales:{
              x:{display:false},
              y:{ min:0, max:100, ticks:{color:"#8892b0",font:{size:9},stepSize:50}, grid:{color:"rgba(255,255,255,0.04)"},
                afterDataLimits(scale){ scale.min=0; scale.max=100; } }
            }
          }
        });
      }
    }
    const pts=document.getElementById(`pts-${sym}`);
    if (pts) pts.textContent=rows.length+" pts";
  }
}

/* ── STOCK COMPARISON ─────────────────────────────────────── */
function setupComparison() {
  const selA = document.getElementById("cmp-a");
  const selB = document.getElementById("cmp-b");
  const syms = Object.keys(STOCK_META);
  [selA, selB].forEach((sel, i) => {
    sel.innerHTML = syms.map(s=>`<option value="${s}" ${i===1&&s===syms[1]?"selected":""}>${s}</option>`).join("");
  });
  document.getElementById("btn-compare").addEventListener("click", () => {
    const symA=selA.value, symB=selB.value;
    if (symA===symB) return;
    const dataA = allHistory.filter(r=>r.symbol===symA);
    const dataB = allHistory.filter(r=>r.symbol===symB);
    const card  = document.getElementById("compare-card");
    card.style.display = "block";
    const labels = dataA.map(r=>fmtTime(r.time));
    const metaA=metaFor(symA), metaB=metaFor(symB);
    if (compareInstance) { compareInstance.destroy(); compareInstance=null; }
    compareInstance = new Chart(document.getElementById("compare-chart").getContext("2d"), {
      type:"line",
      data:{
        labels,
        datasets:[
          { label:symA, data:dataA.map(r=>r.price), borderColor:metaA.color, backgroundColor:metaA.color+"22", borderWidth:2, pointRadius:1, fill:true, tension:.4 },
          { label:symB, data:dataB.map(r=>r.price), borderColor:metaB.color, backgroundColor:metaB.color+"22", borderWidth:2, pointRadius:1, fill:true, tension:.4 },
        ]
      },
      options:{
        responsive:true, maintainAspectRatio:false, animation:{duration:500},
        plugins:{
          legend:{display:true, position:"top", labels:{color:"#8892b0",boxWidth:24,font:{size:11}}},
          tooltip:{ backgroundColor:"rgba(11,15,26,.97)", titleColor:"#f0f4ff", bodyColor:"#f0f4ff",
            callbacks:{label:ctx=>`  ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`} }
        },
        scales:{
          x:{ ticks:{color:"#8892b0",maxTicksLimit:6,maxRotation:0,font:{size:10}}, grid:{color:"rgba(255,255,255,0.04)"} },
          y:{ ticks:{color:"#8892b0",font:{size:10},callback:v=>"₹"+v.toLocaleString("en-IN")}, grid:{color:"rgba(255,255,255,0.04)"} }
        }
      }
    });
  });
}

/* ── CANDLESTICK + VOLUME ─────────────────────────────────── */
async function loadCandlestick(symbol) {
  currentCandle = symbol;
  const loadEl=document.getElementById("candle-loading");
  if (loadEl){loadEl.textContent=`Loading OHLC for ${symbol}…`;loadEl.style.display="flex";}
  try {
    const res = await fetch(`/api/stocks/ohlc/${encodeURIComponent(symbol)}`);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : [];
    } catch (_) {
      throw new Error(`Server returned non-JSON response (${res.status})`);
    }

    if (!res.ok) {
      const msg = data && data.error ? data.error : `Request failed (${res.status})`;
      throw new Error(msg);
    }

    if (data && !Array.isArray(data) && data.error) {
      throw new Error(data.error);
    }

    if (!Array.isArray(data)||!data.length){if(loadEl)loadEl.textContent=`No OHLC data for ${symbol} (market may be closed)`;return;}
    if (loadEl) loadEl.style.display="none";
    const meta=metaFor(symbol);

    const ohlc   = data.map(d=>({x:d.x,o:d.o,h:d.h,l:d.l,c:d.c}));
    const labels = data.map(d=>d.x);
    const vols   = data.map(d=>d.v||0);

    if (candleInstance){candleInstance.destroy();candleInstance=null;}
    if (volumeInstance){volumeInstance.destroy();volumeInstance=null;}

    candleInstance = new Chart(document.getElementById("candle-chart").getContext("2d"),{
      type:"candlestick",
      data:{ datasets:[{ label:symbol+" OHLC", data:ohlc, color:{up:"#00e676",down:"#ff5252",unchanged:"#8892b0"} }] },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{legend:{display:false}, tooltip:{backgroundColor:"rgba(11,15,26,.97)",titleColor:meta.color,bodyColor:"#f0f4ff"}},
        scales:{
          x:{ type:"timeseries", time:{unit:"minute",displayFormats:{minute:"HH:mm"}}, ticks:{color:"#8892b0",maxTicksLimit:10}, grid:{color:"rgba(255,255,255,0.04)"} },
          y:{ ticks:{color:"#8892b0",callback:v=>"₹"+v.toLocaleString("en-IN")}, grid:{color:"rgba(255,255,255,0.04)"} }
        }
      }
    });

    volumeInstance = new Chart(document.getElementById("volume-chart").getContext("2d"),{
      type:"bar",
      data:{ labels, datasets:[{
        label:"Volume", data:vols,
        backgroundColor:data.map(d=>d.c>=d.o?"rgba(0,230,118,0.4)":"rgba(255,82,82,0.4)"),
        borderRadius:2
      }] },
      options:{
        responsive:true, maintainAspectRatio:false, animation:false,
        plugins:{legend:{display:false}, tooltip:{callbacks:{label:ctx=>"  Vol: "+ctx.parsed.y.toLocaleString("en-IN")}}},
        scales:{
          x:{ type:"timeseries", time:{unit:"minute"}, ticks:{display:false}, grid:{display:false} },
          y:{ ticks:{color:"#8892b0",font:{size:9},callback:v=>v>=1e6?(v/1e6).toFixed(1)+"M":v>=1e3?(v/1e3).toFixed(0)+"K":v}, grid:{color:"rgba(255,255,255,0.04)"} }
        }
      }
    });
  } catch(e) {
    console.error("Candle error:",e);
    if(loadEl)loadEl.textContent="Failed: "+e.message;
  }
}

function setupCandleSelector(symbols) {
  const sel=document.getElementById("candle-selector");
  sel.innerHTML = symbols.map((s,i)=>`<button class="candle-btn${i===0?" active":""}" data-symbol="${s}">${s}</button>`).join("");
  sel.querySelectorAll(".candle-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      sel.querySelectorAll(".candle-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      if(candleInstance){candleInstance.destroy();candleInstance=null;}
      if(volumeInstance){volumeInstance.destroy();volumeInstance=null;}
      loadCandlestick(btn.dataset.symbol);
    });
  });
}

/* ── PORTFOLIO TRACKER ────────────────────────────────────── */
function setupPortfolio(symbols) {
  const sel=document.getElementById("port-symbol");
  sel.innerHTML=symbols.map(s=>`<option value="${s}">${s}</option>`).join("");
  document.getElementById("btn-add-port").addEventListener("click",()=>{
    const sym=sel.value, shares=parseFloat(document.getElementById("port-shares").value), buy=parseFloat(document.getElementById("port-buyprice").value);
    if(!sym||isNaN(shares)||isNaN(buy)||shares<=0||buy<=0) return;
    portfolio[sym]={shares,buy};
    localStorage.setItem("portfolio",JSON.stringify(portfolio));
    document.getElementById("port-shares").value="";
    document.getElementById("port-buyprice").value="";
    renderPortfolioTable();
  });
}

function renderPortfolioTable() {
  const wrap=document.getElementById("portfolio-table-wrap");
  const sumWrap=document.getElementById("portfolio-summary");
  if(!wrap) return;
  const entries=Object.entries(portfolio);
  if(!entries.length){wrap.innerHTML='<p class="no-data">No holdings added yet.</p>';sumWrap.innerHTML="";return;}
  let totalInvested=0,totalCurrent=0;
  const rows=entries.map(([sym,h])=>{
    const curr=previousPrices[sym]||h.buy;
    const invested=h.shares*h.buy, current=h.shares*curr, pl=current-invested, plPct=((pl/invested)*100).toFixed(2);
    totalInvested+=invested; totalCurrent+=current;
    const cls=pl>=0?"pl-pos":"pl-neg";
    return `<tr>
      <td><strong style="color:${metaFor(sym).color}">${sym}</strong></td>
      <td>${h.shares}</td>
      <td>${fmt(h.buy)}</td>
      <td>${fmt(curr)}</td>
      <td>${fmt(current)}</td>
      <td class="${cls}">${pl>=0?"▲":"▼"} ${fmt(Math.abs(pl))} (${Math.abs(plPct)}%)</td>
      <td><button class="btn-rm" onclick="removeHolding('${sym}')">✕</button></td>
    </tr>`;
  }).join("");
  wrap.innerHTML=`<table class="portfolio-table">
    <thead><tr><th>Stock</th><th>Shares</th><th>Buy ₹</th><th>LTP ₹</th><th>Value</th><th>P&L</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  const totalPL=totalCurrent-totalInvested, totalPLPct=((totalPL/totalInvested)*100).toFixed(2);
  sumWrap.innerHTML=`
    <div class="port-sum-item"><span class="port-sum-label">Invested</span><span class="port-sum-value">${fmt(totalInvested)}</span></div>
    <div class="port-sum-item"><span class="port-sum-label">Current Value</span><span class="port-sum-value">${fmt(totalCurrent)}</span></div>
    <div class="port-sum-item"><span class="port-sum-label">Total P&L</span><span class="port-sum-value" style="color:${totalPL>=0?"var(--up)":"var(--down)"}">${totalPL>=0?"▲":"▼"} ${fmt(Math.abs(totalPL))} (${Math.abs(totalPLPct)}%)</span></div>`;
}
window.removeHolding = sym => { delete portfolio[sym]; localStorage.setItem("portfolio",JSON.stringify(portfolio)); renderPortfolioTable(); };

/* ── WATCHLIST MANAGER ────────────────────────────────────── */
async function loadWatchlist() {
  const res  = await fetch("/api/watchlist");
  const list = await res.json();
  const syms = list.map(t=>t.replace(".NS","").replace(".BO",""));
  renderWatchlistTags(list);
  return syms;
}

function renderWatchlistTags(tickers) {
  const el=document.getElementById("watchlist-tags");
  el.innerHTML=tickers.map(t=>`<div class="wl-tag">${t}<button class="wl-remove" onclick="removeFromWatchlist('${t}')">✕</button></div>`).join("");
}

window.removeFromWatchlist = async ticker => {
  await fetch("/api/watchlist/remove",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticker})});
  loadWatchlist();
};

function setupWatchlist() {
  document.getElementById("btn-wl-add").addEventListener("click", async () => {
    const inp=document.getElementById("wl-ticker");
    const ticker=inp.value.trim().toUpperCase();
    if(!ticker) return;
    const status=document.getElementById("wl-status");
    status.textContent="Validating…"; status.className="wl-status";
    const res=await fetch("/api/watchlist/add",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticker})});
    const data=await res.json();
    if(data.ok){inp.value="";status.textContent="✓ Added!";status.className="wl-status ok";renderWatchlistTags(data.tickers);}
    else{status.textContent="✗ "+data.error;status.className="wl-status err";}
    setTimeout(()=>{status.textContent="";},4000);
  });
}

/* ── PRICE ALERTS ─────────────────────────────────────────── */
function checkAlert(symbol, price) {
  const a=activeAlerts[symbol]; if(!a) return;
  const hit=(a.type==="above"&&price>=a.price)||(a.type==="below"&&price<=a.price);
  if(!hit) return;
  playAlertBeep();
  if(Notification.permission==="granted") new Notification(`🔔 ${symbol} Alert!`,{body:`${symbol} is ${a.type==="above"?"above":"below"} ₹${a.price} — Current: ${fmt(price)}`});
  const ind=document.getElementById(`alert-ind-${symbol}`);
  if(ind){ind.textContent=`🔔 ${a.type==="above"?"≥":"≤"} ₹${a.price} triggered!`;ind.className="alert-indicator triggered";}
}

function renderAlertList() {
  const el=document.getElementById("alert-list"); if(!el) return;
  const entries=Object.entries(activeAlerts);
  el.innerHTML=entries.length
    ?entries.map(([sym,a])=>`<div class="alert-tag"><span>${sym} ${a.type==="above"?"≥":"≤"} ₹${a.price}</span><button class="remove-alert" onclick="removeAlert('${sym}')">✕</button></div>`).join("")
    :`<span class="no-data">No alerts set</span>`;
}

function setupAlerts(symbols) {
  const sel=document.getElementById("alert-symbol");
  sel.innerHTML=symbols.map(s=>`<option value="${s}">${s}</option>`).join("");
  document.getElementById("alert-form").addEventListener("submit",async e=>{
    e.preventDefault();
    const sym=sel.value, type=document.getElementById("alert-type").value, price=parseFloat(document.getElementById("alert-price").value);
    if(isNaN(price)) return;
    if(Notification.permission!=="granted") await Notification.requestPermission();
    activeAlerts[sym]={type,price};
    localStorage.setItem("stockAlerts",JSON.stringify(activeAlerts));
    document.getElementById("alert-price").value="";
    renderAlertList();
  });
  renderAlertList();
}
window.removeAlert=sym=>{delete activeAlerts[sym];localStorage.setItem("stockAlerts",JSON.stringify(activeAlerts));renderAlertList();const ind=document.getElementById(`alert-ind-${sym}`);if(ind){ind.textContent="";ind.className="alert-indicator";}};

/* ── CSV EXPORT ───────────────────────────────────────────── */
function exportCSV() {
  if(!allHistory.length) return;
  const rows=[["Symbol","Price (₹)","Time"],...allHistory.map(r=>[r.symbol,r.price,r.time])];
  const blob=new Blob([rows.map(r=>r.join(",")).join("\n")],{type:"text/csv"});
  const a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(blob),download:`stocks_${new Date().toISOString().slice(0,10)}.csv`});
  a.click(); URL.revokeObjectURL(a.href);
}

/* ── OVERLAY TOGGLES ──────────────────────────────────────── */
function setupOverlayToggles() {
  document.getElementById("toggle-ma").addEventListener("change",e=>{showMA=e.target.checked;rebuildCharts();});
  document.getElementById("toggle-trend").addEventListener("change",e=>{showTrend=e.target.checked;rebuildCharts();});
  document.getElementById("toggle-rsi").addEventListener("change",e=>{showRSI=e.target.checked;rebuildCharts();});
}
function setupTimeFilters() {
  document.querySelectorAll(".time-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      document.querySelectorAll(".time-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active"); currentFilter=parseInt(btn.dataset.minutes);
      rebuildCharts();
    });
  });
}
function rebuildCharts(){
  Object.values(chartInstances).forEach(c=>c.destroy());
  chartInstances={};
  document.getElementById("charts-grid").innerHTML="";
  renderCharts(filteredHistory());
}

/* ── WEBSOCKET ────────────────────────────────────────────── */
function setupWebSocket() {
  const socket = io();
  socket.on("price_update", data => {
    // Instantly update just the affected card without waiting for full poll
    const priceEl=document.getElementById(`price-${data.symbol}`);
    const timeEl=document.getElementById(`time-${data.symbol}`);
    if(!priceEl) return;
    const prev=previousPrices[data.symbol], curr=data.price;
    if(prev!=null&&prev!==curr) animateCounter(priceEl,prev,curr);
    else priceEl.textContent=fmt(curr);
    if(timeEl) timeEl.textContent="Updated: "+fmtTime(data.time);
    previousPrices[data.symbol]=curr;
    checkAlert(data.symbol,curr);
    // Update last-updated label
    const lu=document.getElementById("last-updated");
    if(lu) lu.textContent="Last updated: "+new Date().toLocaleTimeString("en-IN",{timeZone:"Asia/Kolkata"})+" IST";
  });
}

/* ── PWA ──────────────────────────────────────────────────── */
function setupPWA() {
  if("serviceWorker" in navigator) navigator.serviceWorker.register("/static/sw.js");
  let deferredPrompt;
  window.addEventListener("beforeinstallprompt",e=>{
    e.preventDefault(); deferredPrompt=e;
    const btn=document.getElementById("pwa-install-btn");
    if(btn){btn.style.display="inline";btn.addEventListener("click",()=>{deferredPrompt.prompt();deferredPrompt=null;btn.style.display="none";});}
  });
}

/* ── DATA FETCH & REFRESH ─────────────────────────────────── */
async function refresh() {
  try {
    const [latest, history, stats] = await Promise.all([
      fetch("/api/stocks/latest").then(r=>r.json()),
      fetch("/api/stocks").then(r=>r.json()),
      fetch("/api/stocks/stats").then(r=>r.json()),
    ]);
    allHistory = history;
    updateMarketStatus();
    updateTickerTape(latest);
    renderCards(latest);
    updateSparklines(history);
    updatePerformers(stats);
    updateHeatmap(stats);
    renderStats(stats);
    renderCharts(filteredHistory());
    const lu=document.getElementById("last-updated");
    if(lu) lu.textContent="Last updated: "+new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true,timeZone:"Asia/Kolkata"})+" IST";
  } catch(e) { console.error("Refresh error:",e); }
}

/* ── INIT ─────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
  setupTheme();
  setupPWA();
  setupWebSocket();
  setupOverlayToggles();
  setupTimeFilters();
  setupWatchlist();

  // Load dynamic symbol list from backend
  const symbols = await loadWatchlist();
  const firstSym = symbols[0] || "RELIANCE";

  setupComparison();
  setupCandleSelector(symbols);
  setupAlerts(symbols);
  setupPortfolio(symbols);

  // Setup port symbol select
  const portSel=document.getElementById("port-symbol");
  portSel.innerHTML=symbols.map(s=>`<option value="${s}">${s}</option>`).join("");

  // Comparison dropdowns
  const fill = id => {
    const s=document.getElementById(id);
    if(s) s.innerHTML=symbols.map((sym,i)=>`<option value="${sym}" ${i===1&&id==="cmp-b"?"selected":""}>${sym}</option>`).join("");
  };
  fill("cmp-a"); fill("cmp-b");

  document.getElementById("btn-export").addEventListener("click", exportCSV);

  await refresh();
  setInterval(refresh, REFRESH_INTERVAL);
  loadCandlestick(firstSym);
});
