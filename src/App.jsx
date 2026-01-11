import { useEffect, useMemo, useRef, useState } from "react";
import pako from "pako";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

const PROJECTS = [
  { key: "border", display: "Border Solar" },
  { key: "dds", display: "Don Diego Solar" },
  { key: "pima", display: "PIMA Solar" },
  { key: "rum", display: "Rumorosa Solar" },
  { key: "tep", display: "Tepezalá Solar" },
  { key: "ventika", display: "Ventika" },
];

const BASE = import.meta.env.VITE_DATA_BASE_URL;

// Cache-buster helper (useful for index.json and anything you want to hard-refresh)
function withBuster(url, buster = Date.now()) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${buster}`;
}

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, { cache: "no-store", ...opts });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} - ${url}`);
  return await r.json();
}

async function fetchMaybeGzJson(url, opts = {}) {
  // NOTE: Browsers may auto-decompress if server returns Content-Encoding: gzip.
  // This function detects gzip magic bytes (1F 8B). If not gzip, treats as plain JSON.
  const r = await fetch(url, { cache: "no-store", ...opts });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} - ${url}`);

  const buf = await r.arrayBuffer();
  const u8 = new Uint8Array(buf);

  const isGz = u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b;

  const text = isGz
    ? pako.ungzip(u8, { to: "string" })
    : new TextDecoder().decode(u8);

  return JSON.parse(text);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function monthKeyFromDate(dateStr) {
  // "YYYY-MM-DD" -> "YYYY_MM"
  return `${dateStr.slice(0, 4)}_${dateStr.slice(5, 7)}`;
}

function isDesktop() {
  return window.matchMedia && window.matchMedia("(min-width: 1024px)").matches;
}

function Card({ children, style }) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 14,
        boxShadow: "0 1px 0 rgba(0,0,0,0.03)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionHeader({ title, subtitle, right }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div>
        <div style={{ fontWeight: 800, fontSize: 14 }}>{title}</div>
        {subtitle ? (
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
            {subtitle}
          </div>
        ) : null}
      </div>
      {right}
    </div>
  );
}

function Pill({ children }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid #e5e7eb",
        background: "#f9fafb",
        fontSize: 12,
        color: "#374151",
      }}
    >
      {children}
    </span>
  );
}

function StatCard({ label, value, hint }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 14,
        padding: 12,
        minWidth: 150,
        background: "white",
      }}
    >
      <div style={{ fontSize: 12, color: "#6b7280" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>
        {value ?? "—"}
      </div>
      {hint ? (
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function LoadingInline({ text = "Cargando…" }) {
  return <div style={{ fontSize: 12, color: "#6b7280" }}>{text}</div>;
}

function formatMoney(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return null;
  const x = Number(n);
  return x.toLocaleString("es-MX", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

function computeStats(values) {
  if (!values || values.length === 0)
    return { min: null, max: null, avg: null, n: 0 };
  let min = Infinity,
    max = -Infinity,
    sum = 0,
    count = 0;
  for (const v of values) {
    const x = Number(v);
    if (Number.isNaN(x)) continue;
    if (x < min) min = x;
    if (x > max) max = x;
    sum += x;
    count++;
  }
  if (count === 0) return { min: null, max: null, avg: null, n: 0 };
  return {
    min: formatMoney(min),
    max: formatMoney(max),
    avg: formatMoney(sum / count),
    n: count,
  };
}

export default function App() {
  const [projectKey, setProjectKey] = useState(PROJECTS[0].key);

  const [indexData, setIndexData] = useState(null);
  const [node, setNode] = useState("");

  const [year, setYear] = useState("2024");
  const [month, setMonth] = useState(""); // "YYYY_MM"
  const [day, setDay] = useState(""); // "YYYY-MM-DD"

  const [dailyMeta, setDailyMeta] = useState({ tz: "America/Mexico_City" });
  const [dailySeries, setDailySeries] = useState([]); // [{d, avg, min, max, n}]

  const [monthlyMeta, setMonthlyMeta] = useState(null);
  const [monthlySeries, setMonthlySeries] = useState([]); // [{d,h,t,pml}]

  const [error, setError] = useState("");
  const [loading, setLoading] = useState({ idx: false, daily: false, month: false });

  const annualRef = useRef(null);
  const monthRef = useRef(null);
  const dayRef = useRef(null);

  // --------- Load index.json ----------
  useEffect(() => {
    let cancel = false;
    (async () => {
      setError("");
      setLoading((s) => ({ ...s, idx: true }));
      setIndexData(null);
      setNode("");
      setMonth("");
      setDay("");
      setDailySeries([]);
      setMonthlySeries([]);
      setMonthlyMeta(null);

      try {
        // Cache-buster here is the most important one (index controls years/months)
        const buster = Date.now();
        const idxUrl = withBuster(`${BASE}/pml-mda/${projectKey}/index.json`, buster);
        const idx = await fetchJson(idxUrl);
        if (cancel) return;

        setIndexData(idx);

        const defaultNode = idx.defaultNode || idx.nodes?.[0]?.node || "";
        setNode(defaultNode);

        const nodeObj =
          (idx.nodes || []).find((n) => n.node === defaultNode) || idx.nodes?.[0];
        const months = (nodeObj?.months || []).slice().sort();
        const lastMonth = months.length ? months[months.length - 1] : "";
        setMonth(lastMonth);

        if (lastMonth) setYear(lastMonth.slice(0, 4));
      } catch (e) {
        if (!cancel) setError(String(e.message || e));
      } finally {
        if (!cancel) setLoading((s) => ({ ...s, idx: false }));
      }
    })();

    return () => {
      cancel = true;
    };
  }, [projectKey]);

  const nodeOptions = useMemo(() => {
    if (!indexData?.nodes) return [];
    return indexData.nodes.map((n) => ({ node: n.node, system: n.system }));
  }, [indexData]);

  const monthOptions = useMemo(() => {
    if (!indexData?.nodes || !node) return [];
    const nodeObj = indexData.nodes.find((n) => n.node === node);
    return (nodeObj?.months || []).slice().sort();
  }, [indexData, node]);

  // --------- Load daily series ----------
  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!projectKey || !node) return;

      setError("");
      setLoading((s) => ({ ...s, daily: true }));
      setDailySeries([]);

      try {
        // You can optionally buster daily too. Usually not needed if Cache-Control is right,
        // but it's handy while you're iterating.
        const url = `${BASE}/pml-mda/${projectKey}/nodes/${node}/daily/series.json.gz`;
        const data = await fetchMaybeGzJson(url);
        if (cancel) return;

        // IMPORTANT FIX:
        // Your daily JSON is: { ..., "rows":[["YYYY-MM-DD", n, avg, min, max], ...] }
        // (we also tolerate older shape just in case)
        const rows = data.rows || data.daily || [];
        const daily = rows.map((row) => ({
          d: row[0],
          n: Number(row[1] ?? 0),
          avg: Number(row[2]),
          min: Number(row[3]),
          max: Number(row[4]),
        }));

        setDailyMeta({ tz: data.tz || "America/Mexico_City" });
        setDailySeries(daily);

        if (daily.length) {
          const lastDate = daily[daily.length - 1].d;
          setYear(lastDate.slice(0, 4));
        }
      } catch (e) {
        if (!cancel) setError(String(e.message || e));
      } finally {
        if (!cancel) setLoading((s) => ({ ...s, daily: false }));
      }
    })();

    return () => {
      cancel = true;
    };
  }, [projectKey, node]);

  const yearOptions = useMemo(() => {
    const set = new Set();
    for (const r of dailySeries) set.add(r.d.slice(0, 4));
    return Array.from(set).sort();
  }, [dailySeries]);

  // --------- Historical chart (monthly downsample from daily) ----------
  const histChart = useMemo(() => {
    const byMonth = new Map();
    for (const r of dailySeries) {
      const ym = r.d.slice(0, 7); // YYYY-MM
      const cur =
        byMonth.get(ym) || { sumAvg: 0, n: 0, min: Infinity, max: -Infinity };
      cur.sumAvg += r.avg;
      cur.n += 1;
      if (r.min < cur.min) cur.min = r.min;
      if (r.max > cur.max) cur.max = r.max;
      byMonth.set(ym, cur);
    }

    const out = [];
    for (const [ym, a] of Array.from(byMonth.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      out.push({
        t: ym,
        avg: a.sumAvg / a.n,
        min: a.min,
        max: a.max,
        year: ym.slice(0, 4),
      });
    }
    return out;
  }, [dailySeries]);

  // --------- Annual chart (daily filtered) ----------
  const annualChart = useMemo(() => {
    return dailySeries
      .filter((r) => r.d.startsWith(year + "-"))
      .map((r) => ({ t: r.d, avg: r.avg, min: r.min, max: r.max, n: r.n }));
  }, [dailySeries, year]);

  const annualStats = useMemo(() => {
    const vals = annualChart.map((r) => r.avg);
    return computeStats(vals);
  }, [annualChart]);

  // --------- Load monthly hourly ----------
  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!projectKey || !node || !month) return;

      setError("");
      setLoading((s) => ({ ...s, month: true }));
      setMonthlySeries([]);
      setMonthlyMeta(null);

      try {
        const url = `${BASE}/pml-mda/${projectKey}/nodes/${node}/hourly/${month}.json.gz`;
        const data = await fetchMaybeGzJson(url);
        if (cancel) return;

        const rows = data.rows || [];
        const pts = rows.map((r) => {
          const d = r[0];
          const h = Number(r[1]);
          const p = Number(r[2]);
          return {
            d,
            h,
            t: `${d} ${pad2(h)}:00`,
            pml: p,
          };
        });

        setMonthlyMeta({
          project: data.project,
          displayName: data.displayName,
          node: data.node,
          rawNode: data.rawNode,
          system: data.system,
          month: data.month,
        });

        setMonthlySeries(pts);

        const days = Array.from(new Set(pts.map((p) => p.d))).sort();
        if (!day || !days.includes(day)) {
          setDay(days[0] || "");
        }
      } catch (e) {
        if (!cancel) setError(String(e.message || e));
      } finally {
        if (!cancel) setLoading((s) => ({ ...s, month: false }));
      }
    })();

    return () => {
      cancel = true;
    };
  }, [projectKey, node, month]);

  const dayOptions = useMemo(() => {
    const set = new Set();
    for (const r of monthlySeries) set.add(r.d);
    return Array.from(set).sort();
  }, [monthlySeries]);

  const monthStats = useMemo(
    () => computeStats(monthlySeries.map((r) => r.pml)),
    [monthlySeries]
  );

  const daySeries = useMemo(() => {
    if (!day) return [];
    return monthlySeries
      .filter((r) => r.d === day)
      .slice()
      .sort((a, b) => a.h - b.h)
      .map((r) => ({ t: `${pad2(r.h)}:00`, pml: r.pml, hour: r.h }));
  }, [monthlySeries, day]);

  const dayStats = useMemo(
    () => computeStats(daySeries.map((r) => r.pml)),
    [daySeries]
  );

  // --------- Zoom interactions ----------
  const scrollToRef = (ref) => {
    const el = ref.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const onHistClick = (e) => {
    const p = e?.activePayload?.[0]?.payload;
    if (!p?.year) return;
    setYear(p.year);
    setTimeout(() => scrollToRef(annualRef), 50);
  };

  const onAnnualClick = (e) => {
    const p = e?.activePayload?.[0]?.payload;
    if (!p?.t) return;
    const clickedDay = p.t;
    const mk = monthKeyFromDate(clickedDay);

    if (monthOptions.includes(mk)) {
      setMonth(mk);
    }
    setDay(clickedDay);
    setTimeout(() => scrollToRef(monthRef), 50);
  };

  const onMonthClick = (e) => {
    const p = e?.activePayload?.[0]?.payload;
    if (!p?.d) return;
    setDay(p.d);
    setTimeout(() => scrollToRef(dayRef), 50);
  };

  // --------- UI labels ----------
  const projectLabel =
    PROJECTS.find((p) => p.key === projectKey)?.display ||
    indexData?.displayName ||
    projectKey;

  const subtitleBits = useMemo(() => {
    const sys = (indexData?.nodes || []).find((n) => n.node === node)?.system;
    return { sys };
  }, [indexData, node]);

  const lastUpdated = useMemo(() => null, []);

  // --------- Responsive layout ----------
  const [desktop, setDesktop] = useState(isDesktop());
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const handler = () => setDesktop(mq.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);

  // --------- Controls ----------
  const Control = ({ value, onChange, options, disabled, width = 170 }) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid #e5e7eb",
        background: disabled ? "#f3f4f6" : "white",
        minWidth: width,
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );

  const TopBar = (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          PML MDA · TZ: {dailyMeta.tz || "America/Mexico_City"}
          {subtitleBits.sys ? ` · Sistema: ${subtitleBits.sys}` : ""}
        </div>
        <h1 style={{ margin: "6px 0 0", fontSize: 26, letterSpacing: -0.2 }}>
          {projectLabel} — {node || "—"}
        </h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <Pill>Zoom: histórico → anual → mensual → diario</Pill>
          {monthlyMeta?.month ? <Pill>Mes activo: {monthlyMeta.month}</Pill> : null}
          {day ? <Pill>Día activo: {day}</Pill> : null}
          {lastUpdated ? <Pill>Actualizado: {lastUpdated}</Pill> : null}
        </div>
      </div>

      <div
        style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}
      >
        <Control
          value={projectKey}
          onChange={(v) => setProjectKey(v)}
          disabled={loading.idx}
          width={180}
          options={PROJECTS.map((p) => ({ value: p.key, label: p.display }))}
        />
        <Control
          value={node}
          onChange={(v) => setNode(v)}
          disabled={loading.idx || !nodeOptions.length}
          width={170}
          options={nodeOptions.map((n) => ({
            value: n.node,
            label: `${n.node} (${n.system})`,
          }))}
        />
        <Control
          value={year}
          onChange={(v) => setYear(v)}
          disabled={loading.daily || !yearOptions.length}
          width={120}
          options={yearOptions.map((y) => ({ value: y, label: y }))}
        />
        <Control
          value={month}
          onChange={(v) => setMonth(v)}
          disabled={loading.idx || !monthOptions.length}
          width={130}
          options={monthOptions.map((m) => ({ value: m, label: m }))}
        />
        <Control
          value={day}
          onChange={(v) => setDay(v)}
          disabled={loading.month || !dayOptions.length}
          width={150}
          options={dayOptions.map((d) => ({ value: d, label: d }))}
        />
      </div>
    </div>
  );

  const ErrorBanner = error ? (
    <div
      style={{
        marginTop: 14,
        padding: 12,
        borderRadius: 14,
        border: "1px solid #fecaca",
        background: "#fff1f2",
        color: "#991b1b",
      }}
    >
      <b>Error:</b> {error}
    </div>
  ) : null;

  const moneyTooltip = (value) => [`${formatMoney(value)} $/MWh`, ""];
  const TooltipLabel = ({ label }) => <span style={{ fontSize: 12 }}>{label}</span>;

  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
        background: "#f9fafb",
        minHeight: "100vh",
      }}
    >
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: 20 }}>
        {TopBar}
        {ErrorBanner}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: desktop ? "1fr 1fr" : "1fr",
            gap: 14,
            marginTop: 14,
          }}
        >
          <Card>
            <SectionHeader
              title="1) Histórico (resumen mensual)"
              subtitle="Click en un punto para saltar al año correspondiente."
              right={
                loading.daily ? (
                  <LoadingInline text="Cargando daily…" />
                ) : (
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    {histChart.length} meses
                  </div>
                )
              }
            />
            <div style={{ height: 260, marginTop: 10 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={histChart} onClick={onHistClick}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="t" minTickGap={40} />
                  <YAxis />
                  <Tooltip label={<TooltipLabel />} formatter={(v) => moneyTooltip(v)} />
                  <Line type="monotone" dataKey="avg" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
              Fuente: agregado diario → mensual (promedio de promedios diarios).
            </div>
          </Card>

          <Card>
            <div ref={annualRef} />
            <SectionHeader
              title={`2) Anual (diario) — ${year}`}
              subtitle="Click en un día para abrir el mes y el detalle diario."
              right={
                loading.daily ? (
                  <LoadingInline text="…" />
                ) : (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <StatCard label="Min (avg diario)" value={annualStats.min} />
                    <StatCard label="Avg (avg diario)" value={annualStats.avg} />
                    <StatCard label="Max (avg diario)" value={annualStats.max} />
                  </div>
                )
              }
            />
            <div style={{ height: 260, marginTop: 10 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={annualChart} onClick={onAnnualClick}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="t" minTickGap={45} />
                  <YAxis />
                  <Tooltip label={<TooltipLabel />} formatter={(v) => moneyTooltip(v)} />
                  <Line type="monotone" dataKey="avg" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
              Tip: días con 23/25 horas (DST) se reflejan en el conteo “n” del agregado
              diario.
            </div>
          </Card>
        </div>

        <div style={{ marginTop: 14 }}>
          <Card>
            <div ref={monthRef} />
            <SectionHeader
              title={`3) Mensual (horario) — ${month || "—"}`}
              subtitle="Click en un punto para seleccionar el día y ver el detalle horario abajo."
              right={
                loading.month ? (
                  <LoadingInline text="Cargando mes…" />
                ) : (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <StatCard label="Mínimo" value={monthStats.min} hint={`${monthStats.n} pts`} />
                    <StatCard label="Promedio" value={monthStats.avg} />
                    <StatCard label="Máximo" value={monthStats.max} />
                  </div>
                )
              }
            />

            <div style={{ height: 340, marginTop: 10 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlySeries} onClick={onMonthClick}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="t" minTickGap={60} />
                  <YAxis />
                  <Tooltip label={<TooltipLabel />} formatter={(v) => moneyTooltip(v)} />
                  <Line type="monotone" dataKey="pml" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                color: "#6b7280",
                display: "flex",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              <span>
                {monthlyMeta?.system ? `Sistema: ${monthlyMeta.system} · ` : ""}
                {monthlyMeta?.rawNode ? `RawNode: ${monthlyMeta.rawNode}` : ""}
              </span>
              <span>{loading.month ? "" : `${monthStats.n} puntos horarios`}</span>
            </div>
          </Card>
        </div>

        <div style={{ marginTop: 14 }}>
          <Card>
            <div ref={dayRef} />
            <SectionHeader
              title={`4) Diario (horario) — ${day || "—"}`}
              subtitle="Derivado del mes seleccionado. Días con 23/25 horas se muestran tal cual."
              right={
                daySeries.length ? (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <StatCard
                      label="Mínimo"
                      value={dayStats.min}
                      hint={`${daySeries.length} horas`}
                    />
                    <StatCard label="Promedio" value={dayStats.avg} />
                    <StatCard label="Máximo" value={dayStats.max} />
                  </div>
                ) : (
                  <LoadingInline text={loading.month ? "Cargando…" : "Sin datos"} />
                )
              }
            />

            <div style={{ height: 240, marginTop: 10 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={daySeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="t" />
                  <YAxis />
                  <Tooltip label={<TooltipLabel />} formatter={(v) => moneyTooltip(v)} />
                  <Line type="monotone" dataKey="pml" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
              Nota: este panel no descarga más data. Solo filtra el mes ya cargado.
            </div>
          </Card>
        </div>

        <div style={{ marginTop: 14, fontSize: 12, color: "#6b7280" }}>
          Fuente: CENACE (PML MDA). Datos en S3 ({BASE}). App en Amplify.
        </div>
      </div>
    </div>
  );
}
