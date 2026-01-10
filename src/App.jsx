import { useEffect, useMemo, useState } from "react";
import pako from "pako";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from "recharts";

const PROJECTS = [
  { key: "border",  name: "Border Solar" },
  { key: "dds",     name: "Don Diego Solar" },
  { key: "pima",    name: "PIMA Solar" },
  { key: "rum",     name: "Rumorosa Solar" },
  { key: "tep",     name: "Tepezalá Solar" },
  { key: "ventika", name: "Ventika" },
];

const BASE = import.meta.env.VITE_DATA_BASE_URL;

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} - ${url}`);
  return await r.json();
}

async function fetchGzJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} - ${url}`);
  const buf = await r.arrayBuffer();
  const inflated = pako.ungzip(new Uint8Array(buf), { to: "string" });
  return JSON.parse(inflated);
}

function fmt2(n) {
  return String(n).padStart(2, "0");
}

function StatCard({ label, value }) {
  return (
    <div style={{
      border: "1px solid #e5e7eb", borderRadius: 12, padding: 12,
      minWidth: 140, background: "white"
    }}>
      <div style={{ fontSize: 12, color: "#6b7280" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>
        {value ?? "—"}
      </div>
    </div>
  );
}

function Section({ title, subtitle, children, right }) {
  return (
    <div style={{
      marginTop: 14, background: "white",
      border: "1px solid #e5e7eb", borderRadius: 16, padding: 14
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{subtitle}</div>}
        </div>
        {right}
      </div>
      <div style={{ marginTop: 10 }}>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [projectKey, setProjectKey] = useState(PROJECTS[0].key);

  const [indexData, setIndexData] = useState(null);
  const [node, setNode] = useState("");
  const [month, setMonth] = useState("");     // "YYYY_MM"
  const [year, setYear] = useState("2024");   // "YYYY"
  const [day, setDay] = useState("");         // "YYYY-MM-DD"

  const [dailySeries, setDailySeries] = useState([]);     // [{d, avg, min, max, n}]
  const [monthlySeries, setMonthlySeries] = useState([]); // [{t, d, h, pml}]
  const [error, setError] = useState("");
  const [loading, setLoading] = useState({ idx: false, daily: false, month: false });

  // 1) Load index.json
  useEffect(() => {
    let cancel = false;
    (async () => {
      setError("");
      setLoading(s => ({ ...s, idx: true }));
      setIndexData(null);
      setDailySeries([]);
      setMonthlySeries([]);
      try {
        const url = `${BASE}/pml-mda/${projectKey}/index.json`;
        const idx = await fetchJson(url);
        if (cancel) return;

        setIndexData(idx);

        const defaultNode = idx.defaultNode || idx.nodes?.[0]?.node || "";
        setNode(defaultNode);

        // default month: last available for default node
        const nodeObj = (idx.nodes || []).find(n => n.node === defaultNode) || idx.nodes?.[0];
        const months = (nodeObj?.months || []).slice().sort();
        const lastMonth = months.length ? months[months.length - 1] : "";
        setMonth(lastMonth);

        // default year: from lastMonth if exists
        if (lastMonth?.length >= 4) setYear(String(lastMonth).slice(0, 4));
      } catch (e) {
        if (!cancel) setError(String(e.message || e));
      } finally {
        if (!cancel) setLoading(s => ({ ...s, idx: false }));
      }
    })();
    return () => { cancel = true; };
  }, [projectKey]);

  const nodeOptions = useMemo(() => {
    if (!indexData?.nodes) return [];
    return indexData.nodes.map(n => ({ node: n.node, system: n.system }));
  }, [indexData]);

  const monthOptions = useMemo(() => {
    if (!indexData?.nodes || !node) return [];
    const nodeObj = indexData.nodes.find(n => n.node === node);
    return (nodeObj?.months || []).slice().sort();
  }, [indexData, node]);

  // 2) Load daily series (historical) whenever project/node changes
  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!projectKey || !node) return;
      setError("");
      setLoading(s => ({ ...s, daily: true }));
      setDailySeries([]);
      try {
        const url = `${BASE}/pml-mda/${projectKey}/nodes/${node}/daily/series.json.gz`;
        const data = await fetchGzJson(url);
        if (cancel) return;

        const daily = (data.daily || []).map(row => ({
          d: row[0],          // YYYY-MM-DD
          avg: Number(row[1]),
          min: Number(row[2]),
          max: Number(row[3]),
          n: Number(row[4] ?? 0),
        }));

        setDailySeries(daily);

        // default year: last date’s year if available
        if (daily.length) {
          const last = daily[daily.length - 1].d;
          setYear(last.slice(0, 4));
        }
      } catch (e) {
        if (!cancel) setError(String(e.message || e));
      } finally {
        if (!cancel) setLoading(s => ({ ...s, daily: false }));
      }
    })();
    return () => { cancel = true; };
  }, [projectKey, node]);

  // years available from dailySeries
  const yearOptions = useMemo(() => {
    const set = new Set();
    for (const r of dailySeries) set.add(r.d.slice(0, 4));
    return Array.from(set).sort();
  }, [dailySeries]);

  // historical chart data (avg)
  const histChart = useMemo(() => {
    // downsample by month for the TOP chart (very light): keep one point per month (avg of daily avg)
    // If you prefer daily, just return dailySeries directly.
    const byMonth = new Map(); // YYYY-MM -> {sum, n, min, max}
    for (const r of dailySeries) {
      const ym = r.d.slice(0, 7);
      const cur = byMonth.get(ym) || { sum: 0, n: 0, min: Infinity, max: -Infinity };
      cur.sum += r.avg;
      cur.n += 1;
      if (r.min < cur.min) cur.min = r.min;
      if (r.max > cur.max) cur.max = r.max;
      byMonth.set(ym, cur);
    }
    const out = [];
    for (const [ym, a] of Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push({ t: ym, avg: a.sum / a.n, min: a.min, max: a.max });
    }
    return out;
  }, [dailySeries]);

  // annual chart data (daily)
  const annualChart = useMemo(() => {
    return dailySeries
      .filter(r => r.d.startsWith(year + "-"))
      .map(r => ({ t: r.d, avg: r.avg, min: r.min, max: r.max }));
  }, [dailySeries, year]);

  // 3) Load monthly hourly whenever project/node/month changes
  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!projectKey || !node || !month) return;
      setError("");
      setLoading(s => ({ ...s, month: true }));
      setMonthlySeries([]);
      try {
        const url = `${BASE}/pml-mda/${projectKey}/nodes/${node}/hourly/${month}.json.gz`;
        const data = await fetchGzJson(url);
        if (cancel) return;

        // EXPECTED: data.rows = [ [YYYY-MM-DD, hour, pml], ... ]
        const rows = data.rows || data.data || [];
        const pts = rows.map((r) => {
          const d = r[0];
          const h = Number(r[1]);
          const p = Number(r[2]);
          return {
            d,
            h,
            t: `${d} ${fmt2(h)}:00`,
            pml: p,
          };
        });

        setMonthlySeries(pts);

        // default day: first day of month (or last if you prefer)
        if (pts.length) {
          const firstDay = pts[0].d;
          setDay(firstDay);
        }
      } catch (e) {
        if (!cancel) setError(String(e.message || e));
      } finally {
        if (!cancel) setLoading(s => ({ ...s, month: false }));
      }
    })();
    return () => { cancel = true; };
  }, [projectKey, node, month]);

  // days available within the selected month (from monthlySeries)
  const dayOptions = useMemo(() => {
    const set = new Set();
    for (const r of monthlySeries) set.add(r.d);
    return Array.from(set).sort();
  }, [monthlySeries]);

  // monthly stats
  const monthStats = useMemo(() => {
    if (!monthlySeries.length) return { min: null, max: null, avg: null, n: 0 };
    let min = Infinity, max = -Infinity, sum = 0;
    for (const r of monthlySeries) {
      min = Math.min(min, r.pml);
      max = Math.max(max, r.pml);
      sum += r.pml;
    }
    return { min: min.toFixed(2), max: max.toFixed(2), avg: (sum / monthlySeries.length).toFixed(2), n: monthlySeries.length };
  }, [monthlySeries]);

  // daily (24h) derived from monthlySeries
  const daySeries = useMemo(() => {
    if (!day) return [];
    const pts = monthlySeries
      .filter(r => r.d === day)
      .slice()
      .sort((a, b) => a.h - b.h)
      .map(r => ({ t: `${fmt2(r.h)}:00`, pml: r.pml }));
    return pts;
  }, [monthlySeries, day]);

  const dayStats = useMemo(() => {
    if (!daySeries.length) return { min: null, max: null, avg: null, n: 0 };
    let min = Infinity, max = -Infinity, sum = 0;
    for (const r of daySeries) {
      min = Math.min(min, r.pml);
      max = Math.max(max, r.pml);
      sum += r.pml;
    }
    return { min: min.toFixed(2), max: max.toFixed(2), avg: (sum / daySeries.length).toFixed(2), n: daySeries.length };
  }, [daySeries]);

  const title = PROJECTS.find(p => p.key === projectKey)?.name ?? projectKey;

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial", background: "#f9fafb", minHeight: "100vh" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Sempra Infraestructura · PML MDA · TZ: America/Mexico_City</div>
            <h1 style={{ margin: "6px 0 0", fontSize: 26 }}>{title}</h1>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <select value={projectKey} onChange={(e) => setProjectKey(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb" }}>
              {PROJECTS.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>

            <select value={node} onChange={(e) => setNode(e.target.value)}
              disabled={!nodeOptions.length || loading.idx}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", minWidth: 160 }}>
              {nodeOptions.map(n => <option key={n.node} value={n.node}>{n.node} ({n.system})</option>)}
            </select>

            <select value={year} onChange={(e) => setYear(e.target.value)}
              disabled={!yearOptions.length || loading.daily}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", minWidth: 110 }}>
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>

            <select value={month} onChange={(e) => setMonth(e.target.value)}
              disabled={!monthOptions.length || loading.idx}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", minWidth: 120 }}>
              {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>

            <select value={day} onChange={(e) => setDay(e.target.value)}
              disabled={!dayOptions.length || loading.month}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", minWidth: 130 }}>
              {dayOptions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        {error && (
          <div style={{
            marginTop: 14, padding: 12, borderRadius: 12,
            border: "1px solid #fecaca", background: "#fff1f2", color: "#991b1b"
          }}>
            <b>Error:</b> {error}
          </div>
        )}

        {/* 1) Historical (compact) */}
        <Section
          title="Histórico (resumen mensual)"
          subtitle="Promedio mensual (derivado de agregados diarios). Útil para panorama general sin saturar."
          right={<div style={{ fontSize: 12, color: "#6b7280" }}>{loading.daily ? "Cargando daily…" : `${histChart.length} meses`}</div>}
        >
          <div style={{ height: 240, minHeight: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={histChart}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="t" minTickGap={40} />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="avg" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section>

        {/* 2) Annual */}
        <Section
          title={`Anual (diario) — ${year}`}
          subtitle="Promedio diario con banda min/max (si quieres, la activamos)."
          right={<div style={{ fontSize: 12, color: "#6b7280" }}>{loading.daily ? "…" : `${annualChart.length} días`}</div>}
        >
          <div style={{ height: 260, minHeight: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={annualChart}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="t" minTickGap={40} />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="avg" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section>

        {/* 3) Monthly */}
        <Section
          title={`Mensual (horario) — ${month}`}
          subtitle="Detalle horario del mes."
          right={
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <StatCard label="Mínimo ($/MWh)" value={monthStats.min} />
              <StatCard label="Promedio ($/MWh)" value={monthStats.avg} />
              <StatCard label="Máximo ($/MWh)" value={monthStats.max} />
            </div>
          }
        >
          <div style={{ height: 320, minHeight: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlySeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="t" minTickGap={50} />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="pml" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>
            {loading.month ? "Cargando…" : `${monthStats.n} puntos horarios`}
          </div>
        </Section>

        {/* 4) Daily */}
        <Section
          title={`Diario (horario) — ${day || "—"}`}
          subtitle="Derivado del mes seleccionado. Días con 23/25 horas se muestran tal cual."
          right={
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <StatCard label="Mínimo ($/MWh)" value={dayStats.min} />
              <StatCard label="Promedio ($/MWh)" value={dayStats.avg} />
              <StatCard label="Máximo ($/MWh)" value={dayStats.max} />
            </div>
          }
        >
          <div style={{ height: 220, minHeight: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={daySeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="t" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="pml" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>
            {daySeries.length ? `${daySeries.length} horas` : "—"}
          </div>
        </Section>

        <div style={{ marginTop: 14, fontSize: 12, color: "#6b7280" }}>
          Fuente: CENACE (PML MDA). Datos en S3. App en Amplify.
        </div>
      </div>
    </div>
  );
}
