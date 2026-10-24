/*
 * Carte Prix Carburant — prix d'une station-service pour Home Assistant : prix par carburant,
 * couleur selon des seuils, évolution depuis le dernier changement, historique 30 jours,
 * coût d'un plein et ruptures de stock.
 * Conçue pour l'intégration Prix Carburant (Aohzan/hass-prixcarburant) ; les capteurs peuvent aussi être choisis à la main.
 * Même style que la Carte Enedis Linky New, mais indépendante.
 *
 *   type: custom:prix-carburant-card
 *   station: "12345001"   (facultatif : la première station de l'intégration est prise par défaut)
 */

(() => {
const CARD_VERSION = "0.1.0";

/* ------------------------------------------------------------- affichage */

const fmt = (n, digits = 1) =>
  n === null || n === undefined
    ? "—"
    : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Classe de thème de la carte :
 *  v2   : style MyElectricalData, toujours bleu nuit ;
 *  auto : style MyElectricalData, bleu nuit si Home Assistant est en mode sombre, clair sinon ;
 *  ha   : couleurs du thème Home Assistant (clair ou sombre). */
const themeClass = (theme, hass) => {
  const light = hass?.themes?.darkMode === false;
  if (theme === "ha") return `th-ha${light ? " light" : ""}`;
  if (theme === "auto") return `th-v2${light ? " light" : ""}`;
  return "th-v2";
};

/** « il y a 3 h », « hier », « il y a 4 j ». */
const relTime = (t) => {
  const ms = Date.now() - t;
  if (!Number.isFinite(ms)) return "";
  const mn = Math.round(ms / 60000);
  if (mn < 1) return "à l'instant";
  if (mn < 60) return `il y a ${mn} min`;
  const h = Math.round(mn / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "hier" : `il y a ${d} j`;
};

const dayMonth = (t) => new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

/* ------------------------------------------------------------ carte carburant */

const FUEL_DEFAULTS = {
  title: "",
  station: "",
  fuels: [],
  threshold_orange: 1.5,
  threshold_red: 2.0,
  tank: 0,
  days: 30,
  show_chart: true,
  theme: "v2",
};

/** Carburants dans l'ordre d'affichage. key : valeur de l'attribut fuel_type (en minuscules). */
const FUELS = [
  { key: "gazole", label: "Gazole", short: "Gz", color: "#ffd700" },
  { key: "sp95", label: "SP95", short: "SP95", color: "#00bfff" },
  { key: "e10", label: "SP95-E10", short: "E10", color: "#2ecc40" },
  { key: "sp98", label: "SP98", short: "SP98", color: "#ff5a5a" },
  { key: "e85", label: "E85", short: "E85", color: "#ff8a1f" },
  { key: "gplc", label: "GPLc", short: "GPL", color: "#b07cff" },
];

const fuelOf = (st) => {
  const raw = String(st?.attributes?.fuel_type || st?.entity_id?.split("_").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return FUELS.find((f) => f.key === raw) || { key: raw, label: st?.attributes?.fuel_type || raw.toUpperCase(), short: raw.toUpperCase(), color: "#8fa0b8" };
};

/** Stations connues de l'intégration Prix Carburant, d'après l'attribut station_id des capteurs. */
const stationsOf = (hass) => {
  const out = new Map();
  for (const e of Object.values(hass?.entities || {})) {
    if (e.platform !== "prix_carburant" || !e.entity_id.startsWith("sensor.")) continue;
    const st = hass.states?.[e.entity_id];
    const id = st?.attributes?.station_id;
    if (!id) continue;
    if (!out.has(String(id))) out.set(String(id), { id: String(id), name: st.attributes.name || String(id), city: st.attributes.city || "", entities: [] });
    out.get(String(id)).entities.push(e.entity_id);
  }
  return [...out.values()];
};

class PrixCarburantCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("prix-carburant-card-editor");
  }

  static getStubConfig(hass) {
    const s = stationsOf(hass)[0];
    return s ? { station: s.id } : {};
  }

  setConfig(config) {
    this._config = { ...FUEL_DEFAULTS, ...(config || {}) };
    this._sig = null;
    this._sel = null;
    this._hist = null;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    if (!this._clicks) this.shadowRoot.addEventListener("click", (this._clicks = (ev) => {
      const pick = ev.target.closest?.("[data-pick]");
      if (pick) {
        this._sel = pick.dataset.pick;
        this._sig = null;
        this._render();
        return;
      }
      const el = ev.target.closest?.("[data-entity]");
      if (!el) return;
      const e = new Event("hass-more-info", { bubbles: true, composed: true });
      e.detail = { entityId: el.dataset.entity };
      this.dispatchEvent(e);
    }));
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 6;
  }

  /** Capteurs de la station : entities: s'il est donné, sinon ceux de la station choisie (ou de la première). */
  _entities() {
    const c = this._config;
    if (Array.isArray(c.entities) && c.entities.length) return c.entities.map((x) => (typeof x === "string" ? x : x.entity)).filter(Boolean);
    const all = stationsOf(this._hass);
    const s = (c.station && all.find((x) => x.id === String(c.station))) || all[0];
    return s ? s.entities : [];
  }

  _st(id) {
    return id ? this._hass?.states?.[id] : undefined;
  }

  _num(id) {
    const st = this._st(id);
    if (!st || st.state === "" || st.state === "unknown" || st.state === "unavailable") return null;
    const n = Number(st.state);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  _level(p) {
    const c = this._config;
    if (p === null) return "none";
    if (p >= Number(c.threshold_red)) return "red";
    if (p >= Number(c.threshold_orange)) return "orange";
    return "green";
  }

  /** Historique des prix (API history/period), rechargé toutes les 30 minutes. */
  async _loadHistory(ids) {
    if (!ids.length || !this._hass?.callApi || this._histBusy) return;
    this._histBusy = true;
    const days = Math.max(2, Math.min(90, Number(this._config.days) || 30));
    const end = Date.now();
    const start = end - days * 86400e3;
    try {
      const path = `history/period/${encodeURIComponent(new Date(start).toISOString())}?filter_entity_id=${encodeURIComponent(ids.join(","))}` +
        `&end_time=${encodeURIComponent(new Date(end).toISOString())}&minimal_response&no_attributes`;
      const payload = await this._hass.callApi("GET", path);
      const series = {};
      for (const rows of Array.isArray(payload) ? payload : []) {
        const id = rows?.[0]?.entity_id;
        if (!id) continue;
        series[id] = rows
          .map((r) => ({ t: new Date(r.last_changed || r.last_updated).getTime(), v: Number(r.state) }))
          .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.v) && r.v > 0)
          .sort((a, b) => a.t - b.t);
      }
      this._hist = { key: ids.join(","), start, end, series };
    } catch (err) {
      this._hist = { key: ids.join(","), error: err?.message || String(err), series: {} };
    } finally {
      this._histBusy = false;
      this._histAt = Date.now();
      this._sig = null;
      this._render();
    }
  }

  /** Prix précédent (dernière valeur différente de l'actuelle) d'après l'historique. */
  _previous(id, cur) {
    const s = this._hist?.series?.[id];
    if (!s || cur === null) return null;
    for (let i = s.length - 1; i >= 0; i--) if (Math.abs(s[i].v - cur) > 0.0005) return s[i];
    return null;
  }

  _chart(id, fuel) {
    const h = this._hist;
    const s = (h?.series?.[id] || []).slice();
    const cur = this._num(id);
    const head = `<div class="chart-h"><span>${esc(fuel.label)} · ${Math.round((h?.end - h?.start) / 86400e3) || this._config.days} jours</span>`;
    if (!h || h.error || !s.length) {
      return `<div class="chart">${head}<span></span></div><div class="ch-empty">${h?.error ? `Historique indisponible : ${esc(h.error)}` : h ? "Pas encore d'historique pour ce carburant." : "Chargement de l'historique…"}</div></div>`;
    }
    if (cur !== null) s.push({ t: h.end, v: cur });
    if (s[0].t > h.start) s.unshift({ t: h.start, v: s[0].v });
    const vals = s.map((p) => p.v);
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    const pad = Math.max((max - min) * 0.15, 0.01);
    const lo = min - pad;
    const hi = max + pad;
    const W = 300, H = 110;
    const x = (t) => ((t - h.start) / (h.end - h.start)) * W;
    const y = (v) => H - ((v - lo) / (hi - lo)) * H;
    // escalier : le prix reste valable jusqu'au changement suivant
    let d = `M${x(s[0].t).toFixed(1)},${y(s[0].v).toFixed(1)}`;
    for (let i = 1; i < s.length; i++) d += `H${x(s[i].t).toFixed(1)}V${y(s[i].v).toFixed(1)}`;
    d += `H${W}`;
    const area = `${d}V${H}H0Z`;
    const iMin = vals.indexOf(min);
    const iMax = vals.lastIndexOf(max);
    const lines = [
      [Number(this._config.threshold_orange), "orange"],
      [Number(this._config.threshold_red), "red"],
    ].filter(([v]) => v > lo && v < hi)
      .map(([v, k]) => `<line class="th th-${k}" x1="0" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`).join("");
    return `<div class="chart" data-entity="${esc(id)}">${head}<span class="legend">min <b>${fmt(min, 3)}</b> · max <b>${fmt(max, 3)}</b></span></div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Évolution du prix ${esc(fuel.label)}">
        <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${fuel.color}" stop-opacity=".35"/><stop offset="1" stop-color="${fuel.color}" stop-opacity="0"/></linearGradient></defs>
        ${lines}<path d="${area}" fill="url(#g)"/><path d="${d}" class="line" stroke="${fuel.color}"/>
        <circle cx="${x(s[iMin].t).toFixed(1)}" cy="${y(min).toFixed(1)}" r="3" class="pt-min"/>
        <circle cx="${x(s[iMax].t).toFixed(1)}" cy="${y(max).toFixed(1)}" r="3" class="pt-max"/>
      </svg>
      <div class="ch-x"><span>${dayMonth(h.start)}</span><span>${dayMonth((h.start + h.end) / 2)}</span><span>aujourd'hui</span></div></div>`;
  }

  _render() {
    if (!this._config || !this._hass || !this.shadowRoot) return;
    const c = this._config;
    const ids = this._entities();
    const order = (c.fuels || []).map((f) => String(f).toLowerCase());
    const rows = ids
      .map((id) => ({ id, st: this._st(id) }))
      .filter((r) => r.st)
      .map((r) => ({ ...r, fuel: fuelOf(r.st), price: this._num(r.id) }))
      .filter((r) => !order.length || order.includes(r.fuel.key))
      .sort((a, b) => {
        const ia = order.length ? order.indexOf(a.fuel.key) : FUELS.findIndex((f) => f.key === a.fuel.key);
        const ib = order.length ? order.indexOf(b.fuel.key) : FUELS.findIndex((f) => f.key === b.fuel.key);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });

    const hids = rows.map((r) => r.id);
    if (c.show_chart !== false && hids.length && (!this._hist || this._hist.key !== hids.join(",") || Date.now() - (this._histAt || 0) > 30 * 60e3)) this._loadHistory(hids);

    const sig = `${c.theme}|${this._hass.themes?.darkMode}|${this._sel}|${this._histAt}|` + rows.map((r) => `${r.st.state}/${r.st.attributes.shortage_since}`).join("|");
    if (sig === this._sig) return;
    this._sig = sig;

    const a = rows[0]?.st?.attributes || {};
    const title = c.title || a.name || "Prix carburant";
    const sub = [a.address, [a.postal_code, a.city].filter(Boolean).join(" "), a.distance !== undefined && a.distance !== null ? `${fmt(a.distance, 1)} km` : null]
      .filter(Boolean).map(esc).join(" · ");
    const logo = a.entity_picture
      ? `<img class="logo" src="${esc(a.entity_picture)}" alt="" referrerpolicy="no-referrer">`
      : `<svg viewBox="0 0 32 32" aria-hidden="true"><rect class="pump" x="6" y="5" width="13" height="23" rx="2.5"/><rect class="win" x="9" y="8.5" width="7" height="5" rx="1"/><path class="hose" d="M19 11h3.5l2.5 3v9a2 2 0 0 1-4 0v-5h-2"/></svg>`;
    const card = (body) => {
      this.shadowRoot.innerHTML = `${STYLE}${FUEL_STYLE}<ha-card class="${themeClass(c.theme, this._hass)}">${body}</ha-card>`;
    };

    const updated = a.updated_date ? new Date(a.updated_date).getTime() : null;
    const age = updated ? (Date.now() - updated) / 86400e3 : null;
    const pill = updated
      ? `<div class="pill ${age >= 3 ? "up-old" : "up-ok"}" data-entity="${esc(rows[0]?.id)}" title="Mise à jour des prix par la station : ${esc(new Date(updated).toLocaleString("fr-FR"))}"><span class="dot"></span><span class="pill-l">Prix</span><span class="pill-v">${relTime(updated)}</span></div>`
      : "";
    const header = `<header>
        <div class="brand">${logo}<div><div class="title">${esc(title)}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div></div>
        ${pill}
      </header>`;

    if (!rows.length) {
      card(header + `<div class="empty">Aucun prix trouvé<span>Installez l'intégration Prix Carburant et ajoutez une station, ou indiquez les capteurs dans entities: (voir le README).</span></div>`);
      return;
    }

    const avail = rows.filter((r) => r.price !== null && !r.st.attributes.shortage_since);
    const cheapest = avail.length ? avail.reduce((m, r) => (r.price < m.price ? r : m)) : null;
    const sel = rows.find((r) => r.fuel.key === this._sel) || rows.find((r) => r.price !== null) || rows[0];

    const tiles = rows.map((r) => {
      const short = r.st.attributes.shortage_since;
      const lvl = short ? "none" : this._level(r.price);
      const prev = this._previous(r.id, r.price);
      const diff = prev ? r.price - prev.v : null;
      const evo = diff === null
        ? ""
        : `<div class="evo ${diff > 0 ? "up" : "down"}" title="Avant : ${fmt(prev.v, 3)} € (${esc(new Date(prev.t).toLocaleString("fr-FR"))})">${diff > 0 ? "▲" : "▼"} ${fmt(Math.abs(diff) * 100, 1)} c</div>`;
      return `<button class="fuel lv-${lvl}${r === sel ? " on" : ""}" data-pick="${esc(r.fuel.key)}" style="--fc:${r.fuel.color}">
          <div class="f-h"><span class="f-tag">${esc(r.fuel.short)}</span><span class="dot"></span></div>
          <div class="f-v">${short ? `<em>Rupture</em>` : r.price !== null ? `${fmt(r.price, 3)}<span>€</span>` : "—"}</div>
          <div class="f-n">${short ? `depuis ${dayMonth(new Date(short).getTime())}` : evo || `<span>${esc(r.fuel.label)}</span>`}</div>
          ${r === cheapest && avail.length > 1 ? `<b class="best" title="Le moins cher de la station">€</b>` : ""}
        </button>`;
    }).join("");

    const tank = Number(c.tank) || 0;
    const full = tank > 0 && sel.price !== null && !sel.st.attributes.shortage_since
      ? `<div class="plein" data-entity="${esc(sel.id)}"><ha-icon icon="mdi:gas-station-outline"></ha-icon><span>Plein de ${fmt(tank, 0)} L en ${esc(sel.fuel.label)}</span><b>${fmt(sel.price * tank, 2)} €</b></div>`
      : "";

    const legend = `<div class="seuils"><span><i class="dot lv-green"></i>moins de ${fmt(c.threshold_orange, 2)} €</span><span><i class="dot lv-orange"></i>${fmt(c.threshold_orange, 2)} à ${fmt(c.threshold_red, 2)} €</span><span><i class="dot lv-red"></i>${fmt(c.threshold_red, 2)} € et plus</span></div>`;

    card(`${header}
      <div class="fuels">${tiles}</div>
      ${full}
      ${c.show_chart !== false ? this._chart(sel.id, sel.fuel) : ""}
      ${legend}`);
  }
}

const FUEL_STYLE = `<style>
ha-card { display: block; padding-bottom: 12px; }
.brand .logo { width: 34px; height: 34px; border-radius: 8px; background: #fff; padding: 3px; box-sizing: border-box; object-fit: contain; }
.brand .pump { fill: none; stroke: var(--med-green); stroke-width: 2.2; }
.brand .win { fill: var(--med-blue); }
.brand .hose { fill: none; stroke: var(--med-blue); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.pill.up-ok .dot { background: var(--med-down); }
.pill.up-old { border-color: #f0a33a; } .pill.up-old .dot { background: #f0a33a; }
.fuels { display: grid; grid-template-columns: repeat(auto-fit, minmax(104px, 1fr)); gap: 8px; margin: 6px 12px 0; }
.fuel { all: unset; box-sizing: border-box; position: relative; cursor: pointer; padding: 10px 12px; border-radius: 14px;
  background: var(--med-surface); border: 1px solid var(--med-line); border-top: 3px solid var(--fc); transition: border-color .15s, background .15s; }
.fuel.on { border-color: var(--fc); background: color-mix(in srgb, var(--fc) 10%, var(--med-surface)); }
.fuel:focus-visible { outline: 2px solid var(--med-blue); }
.f-h { display: flex; align-items: center; justify-content: space-between; }
.f-tag { font-size: .78rem; font-weight: 700; letter-spacing: .3px; color: var(--fc); }
ha-card.light .f-tag { color: color-mix(in srgb, var(--fc) 65%, #1a2434); }
.f-v { font-size: 1.55rem; font-weight: 700; line-height: 1.2; margin-top: 2px; white-space: nowrap; }
.f-v span { font-size: .85rem; font-weight: 500; color: var(--med-muted); margin-left: 2px; }
.f-v em { font-style: normal; font-size: 1.05rem; color: var(--t-red); }
.f-n { font-size: .74rem; color: var(--med-muted); min-height: 1.1em; }
.lv-green .dot, .dot.lv-green { background: var(--med-down); }
.lv-orange .dot, .dot.lv-orange { background: #f0a33a; }
.lv-red .dot, .dot.lv-red { background: var(--t-red); }
.lv-none .dot { background: var(--med-muted); }
.evo { font-size: .74rem; font-weight: 600; }
.evo.up { color: var(--med-up); } .evo.down { color: var(--med-down); }
.best { position: absolute; top: -7px; right: -5px; width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center;
  background: var(--med-green); color: #1a2434; font-size: .68rem; font-weight: 800; }
.plein { display: flex; align-items: center; gap: 10px; margin: 10px 12px 0; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--med-line); font-size: .86rem; cursor: pointer; }
.plein ha-icon { --mdc-icon-size: 20px; color: var(--med-muted); }
.plein span { flex: 1; color: var(--med-muted); }
.plein b { font-size: 1.1rem; color: var(--med-green); }
.chart { cursor: pointer; }
.chart .legend { font-size: .76rem; }
.chart .legend b { color: var(--med-text); font-weight: 600; }
.chart svg { height: 110px; }
.chart .line { fill: none; stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.chart .th { stroke-width: 1; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
.chart .th-orange { stroke: #f0a33a; opacity: .7; } .chart .th-red { stroke: var(--t-red); opacity: .7; }
.chart .pt-min { fill: var(--med-down); } .chart .pt-max { fill: var(--med-up); }
.ch-x { display: flex; justify-content: space-between; font-size: .68rem; color: var(--med-muted); margin: 3px 4px 0; }
.ch-empty { margin: 0 4px; padding: 18px 0; text-align: center; font-size: .8rem; color: var(--med-muted); border: 1px dashed var(--med-line); border-radius: 12px; }
.seuils { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 10px 16px 0; font-size: .72rem; color: var(--med-muted); }
.seuils span { display: inline-flex; align-items: center; gap: 5px; }
.seuils .dot { width: 7px; height: 7px; }
</style>`;

/* ------------------------------------------------------------------ style */

const STYLE = `<style>
:host {
  --med-bg: #1a2434; --med-surface: #212d40; --med-line: #2f3d55;
  --med-text: #e7edf5; --med-muted: #8fa0b8;
  --med-green: #96d21f; --med-blue: #1d93e3;
  --t-red: #ee4a4a;
  --med-up: #f08a4b; --med-down: #5fcf8a;
}
ha-card { background: var(--med-bg); color: var(--med-text); border: 1px solid var(--med-line);
  border-radius: 18px; overflow: hidden; font-variant-numeric: tabular-nums; container-type: inline-size; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px 8px; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.brand svg { width: 34px; height: 34px; fill: none; flex: none; }
.title { font-size: 1.15rem; font-weight: 700; letter-spacing: .2px; }
.sub { font-size: .78rem; color: var(--med-muted); }
.pill { display: flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; cursor: pointer;
  background: var(--med-surface); border: 1px solid var(--med-line); font-size: .78rem; }
.pill-l { color: var(--med-muted); }
.pill-v { font-weight: 600; }
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; background: var(--med-muted); flex: none; }
.chart { margin: 14px 12px 0; }
.chart-h { display: flex; justify-content: space-between; font-size: .82rem; color: var(--med-muted); margin: 0 4px 6px; }
.chart svg { width: 100%; display: block; }
.empty { padding: 18px; display: flex; flex-direction: column; gap: 6px; font-size: .9rem; }
.empty span { color: var(--med-muted); }
/* Thème Home Assistant : fond, textes et bordures suivent le thème clair ou sombre */
ha-card.th-ha {
  --med-bg: var(--ha-card-background, var(--card-background-color, #fff));
  --med-surface: color-mix(in srgb, var(--primary-text-color, #000) 5%, transparent);
  --med-line: var(--divider-color, rgba(127, 127, 127, .25));
  --med-text: var(--primary-text-color, #1f2937);
  --med-muted: var(--secondary-text-color, #6b7280);
  border-radius: var(--ha-card-border-radius, 12px);
  border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color, #e0e0e0));
}
ha-card.th-ha.light { --med-green: #4c8a0b; --med-up: #c2560f; --med-down: #1d8a4b; }
/* Style MyElectricalData en version claire (theme: auto quand Home Assistant est en mode clair) */
ha-card.th-v2.light {
  --med-bg: #ffffff; --med-surface: #f2f5f9; --med-line: #dbe2ec;
  --med-text: #1a2434; --med-muted: #5b6b82;
  --med-green: #4c8a0b; --med-blue: #1673b8; --med-up: #c2560f; --med-down: #1d8a4b;
  box-shadow: 0 1px 3px rgba(26, 36, 52, .08);
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>`;

/* ----------------------------------------------------------------- éditeur */

const THEME_SELECT = {
  name: "theme",
  selector: {
    select: {
      mode: "dropdown",
      options: [
        { value: "v2", label: "Style MyElectricalData (bleu nuit)" },
        { value: "auto", label: "Style MyElectricalData, clair ou sombre selon Home Assistant" },
        { value: "ha", label: "Thème Home Assistant (clair ou sombre)" },
      ],
    },
  },
};

const FUEL_SCHEMA = (hass) => {
  const stations = stationsOf(hass);
  return [
    stations.length
      ? { name: "station", selector: { select: { mode: "dropdown", options: stations.map((s) => ({ value: s.id, label: `${s.name}${s.city ? ` (${s.city})` : ""}` })) } } }
      : { name: "station", selector: { text: {} } },
    { name: "title", selector: { text: {} } },
    {
      name: "fuels",
      selector: { select: { multiple: true, mode: "list", options: FUELS.map((f) => ({ value: f.key, label: f.label })) } },
    },
    { name: "threshold_orange", selector: { number: { min: 0, max: 5, step: 0.01, mode: "box", unit_of_measurement: "€/L" } } },
    { name: "threshold_red", selector: { number: { min: 0, max: 5, step: 0.01, mode: "box", unit_of_measurement: "€/L" } } },
    { name: "tank", selector: { number: { min: 0, max: 200, step: 1, mode: "box", unit_of_measurement: "L" } } },
    { name: "days", selector: { number: { min: 2, max: 90, step: 1, mode: "box", unit_of_measurement: "j" } } },
    { name: "show_chart", selector: { boolean: {} } },
    THEME_SELECT,
  ];
};
const FUEL_LABELS = {
  station: "Station (intégration Prix Carburant)",
  title: "Titre (nom de la station par défaut)",
  fuels: "Carburants affichés (tous si aucun n'est coché)",
  threshold_orange: "Orange à partir de",
  threshold_red: "Rouge à partir de",
  tank: "Capacité du réservoir pour le coût d'un plein (0 = masqué)",
  days: "Historique (jours)",
  show_chart: "Afficher l'évolution du prix",
  theme: "Couleurs de la carte",
};

class PrixCarburantCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._draw();
  }

  set hass(hass) {
    this._hass = hass;
    this._draw();
  }

  _draw() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => FUEL_LABELS[s.name] || s.name;
      this._form.addEventListener("value-changed", (ev) => {
        const v = { ...ev.detail.value };
        if (Array.isArray(v.fuels) && !v.fuels.length) delete v.fuels;
        this._config = v;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: v }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = FUEL_SCHEMA(this._hass);
    this._form.data = { ...FUEL_DEFAULTS, ...this._config };
  }
}

/* ---------------------------------------------------------- enregistrement */

if (typeof customElements !== "undefined") {
  const define = (name, cls) => { if (!customElements.get(name)) customElements.define(name, cls); };
  define("prix-carburant-card", PrixCarburantCard);
  define("prix-carburant-card-editor", PrixCarburantCardEditor);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === "prix-carburant-card")) {
    window.customCards.push({
      type: "prix-carburant-card",
      name: "Carte Prix Carburant",
      description: "Prix d'une station-service (intégration Prix Carburant) : seuils de couleur, évolution, historique et coût d'un plein.",
      preview: true,
    });
  }
  console.info(`%c PRIX-CARBURANT-CARD %c ${CARD_VERSION} `, "background:#96d21f;color:#1a2434;font-weight:700", "background:#1d93e3;color:#fff");
}
})();
