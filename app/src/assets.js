// Hoja de estilos servida desde /static/app.css. Se sirve como recurso propio (no inline)
// para poder mantener una CSP estricta: style-src 'self' sin 'unsafe-inline'.

export const STYLESHEET = `
:root{--bg:#f6f7f9;--card:#fff;--text:#14171c;--muted:#5b6472;--line:#e3e6eb;--accent:#0b6bcb;--ok:#137a3f;--ok-bg:#e5f5ec;--code:#eef1f5;--fail:#b42318;--fail-bg:#fde8e7;--run:#9a5b00;--run-bg:#fff4dc;--fin:#6b3fd1;--fin-bg:#efe9fc}
@media (prefers-color-scheme:dark){:root{--bg:#0e1116;--card:#161b22;--text:#e6e9ee;--muted:#9aa4b2;--line:#262d37;--accent:#58a6ff;--ok:#56d364;--ok-bg:#12261b;--code:#1d232c;--fail:#ff7b72;--fail-bg:#2d1416;--run:#e3b341;--run-bg:#2b2211;--fin:#b7a2ff;--fin-bg:#221b38}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:960px;margin:0 auto;padding:32px 16px 48px}
header h1{margin:0 0 4px;font-size:28px;letter-spacing:-.01em}
header p{margin:0;color:var(--muted)}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;background:var(--ok-bg);color:var(--ok);font-weight:600;font-size:13px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-top:20px}
h2{margin:0 0 12px;font-size:17px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0}
dt{color:var(--muted)}
dd{margin:0;overflow-wrap:anywhere}
code{background:var(--code);padding:1px 6px;border-radius:6px;font:13px ui-monospace,SFMono-Regular,Consolas,monospace}
a{color:var(--accent)}
ol{margin:0;padding-left:22px}
ol li{margin:4px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.grid div{border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.grid strong{display:block}
.grid span{color:var(--muted);font-size:13px}
footer{margin-top:24px;color:var(--muted);font-size:13px}
.cta{margin-top:10px!important}
.cta a{font-weight:600}
h3{font-size:15px;margin:18px 0 8px}
.muted{color:var(--muted)}
.warn{color:var(--run)}
ol.flow{list-style:none;padding:0;display:grid;gap:8px}
.stage{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:0}
.stage.finops{border-color:var(--fin)}
.stage .num{flex:none;width:28px;height:28px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:700;font-size:14px}
.stage.finops .num{background:var(--fin)}
.stage p{margin:2px 0 0}
.stage .tools{font-size:13px}
.stage .why{font-size:13px;color:var(--muted)}
.tag{font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px;background:var(--fin-bg);color:var(--fin)}
.run{border-top:1px solid var(--line);padding:10px 0}
.run-head{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font-size:12px;padding:2px 9px;border-radius:999px;border:1px solid var(--line);white-space:nowrap}
.chip.ok{background:var(--ok-bg);color:var(--ok);border-color:transparent}
.chip.fail{background:var(--fail-bg);color:var(--fail);border-color:transparent}
.chip.run{background:var(--run-bg);color:var(--run);border-color:transparent}
.chip.skip,.chip.pend{color:var(--muted)}
@media (max-width:560px){dl{grid-template-columns:1fr}dt{margin-top:8px}}
`;
