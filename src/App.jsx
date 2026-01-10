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
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} - ${url}`);
  return await r.json();
}

async function fetchGzJson(url) {
  const r = await fetch(url, { cache: "no-store" });
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
      minWidth: 120, background: "white"
    }}>
      <div style={{ fontSize: 12, color: "#6b7280" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>
        {value ?? "—"}
      </div>
    </div>
  );
}

export default function App() {
  const [projectKey, setProjectKey] = useState(PROJECTS[0].key);
  const [indexData, setIndexData] = useState(null);

  const [node, setNode] = useState("");
  const [month, setMonth] = useState(""); // "YYYY_MM"

  const [series, setSeries] = useState([]);
  const [stats, setStats] = useState({ min: null, max: null, avg: null });

  const [loadingIndex, setLoadingIndex] = useState(false);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [error, setError] = useState("");

  // Cargar index al cambiar proyecto
  useEffect(() => {
    let cancel = false;
    async function run() {
      setError("");
      setLoadingIndex(true);
      setIndexData(null);
      setSeries([]);
      setStats({ min: null, max: null, avg: null });
      try {
        const url = `${BASE}/pml-mda/${projectKey}/index.json`;
        const idx = await fetchJson(url);
        if (cancel) return;
        setIndexData(idx);

        // default node
        const defaultNode = idx.defaultNode || (idx.nodes?.[0]?.node ?? "");
        setNode(defaultNode);

        // default month: último mes disponible del default node
        const nodeObj = (idx.nodes || []).find(n => n.node === defaultNode) || idx.nodes?.[0];
        const months = (nodeObj?.months || []).slice().sort();
        const last = months.length ? months[months.length - 1] : "";
        setMonth(last);
      } catch (e) {
        if (!cancel) setError(String(e.message || e));
      } finally {
        if (!cancel) setLoadingIndex(false);
      }
    }
    run();
    return () => { cancel = true; };
  }, [projectKey]);

  // Lista de nodos/meses
  const nodeOptions = useMemo(() => {
    if (!indexData?.nodes) return [];
    return indexData.nodes.map(n => ({ node: n.node, system: n.system }));
  }, [indexData]);

  const monthOptions = useMemo(() => {
    if (!indexData?.nodes) return [];
    const nodeObj = indexData.nodes.find(n => n.node === node);
    return (nodeObj?.months || []).slice().sort();
  }, [indexData, node]);

  // Cargar mes al cambiar node o month
  useEffect(() => {
    let cancel = false;
    async function run() {
      if (!projectKey || !node || !month) return;
      setError("");
      setLoadingMonth(true);
      setSeries([]);
      setStats({ min: null, max: null, avg: null });

      try {
        const url = `${BASE}/pml-mda/${projectKey}/nodes/${node}/hourly/${month}.json.gz`;
        const data = await fetchGzJson(url);
        if (cancel) return;

        // rows: ["YYYY-MM-DD", hour, pml]
        const rows = data.rows || [];
        const points = rows.map((r, i) => {
          const d = r[0];
          const h = Number(r[1]);
          const p = Number(r[2]);
          return {
            i,
            t: `${d} ${fmt2(h)}:00`,
            pml: p,
          };
        });

        setSeries(points);

        if (points.length) {
          let min = points[0].pml, max = points[0].pml, sum = 0;
          for (const pt of points) {
            const v = pt.pml;
            if (v < min) min = v;
            if (v > max) max = v;
            sum += v;
          }
          const avg = sum / points.length;
          setStats({
            min: min.toFixed(2),
            max: max.toFixed(2),
            avg: avg.toFixed(2),
          });
        }
      } catch (e) {
        if (!cancel) setError(String(e.message || e));
      } finally {
        if (!cancel) setLoadingMonth(false);
      }
    }
    run();
    return () => { cancel = true; };
  }, [projectKey, node, month]);

  const title = PROJECTS.find(p => p.key === projectKey)?.name ?? projectKey;

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial", background: "#f9fafb", minHeight: "100vh" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Sempra Infraestructura · PML MDA</div>
            <h1 style={{ margin: "6px 0 0", fontSize: 26 }}>{title}</h1>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <select value={projectKey} onChange={(e) => setProjectKey(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb" }}>
              {PROJECTS.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>

            <select value={node} onChange={(e) => setNode(e.target.value)}
              disabled={!nodeOptions.length || loadingIndex}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", minWidth: 140 }}>
              {nodeOptions.map(n => <option key={n.node} value={n.node}>{n.node} ({n.system})</option>)}
            </select>

            <select value={month} onChange={(e) => setMonth(e.target.value)}
              disabled={!monthOptions.length || loadingIndex}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", minWidth: 120 }}>
              {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <StatCard label="Mínimo ($/MWh)" value={stats.min} />
          <StatCard label="Promedio ($/MWh)" value={stats.avg} />
          <StatCard label="Máximo ($/MWh)" value={stats.max} />
          <div style={{ marginLeft: "auto", color: "#6b7280", fontSize: 12, display: "flex", alignItems: "center" }}>
            {(loadingIndex || loadingMonth) ? "Cargando…" : (series.length ? `${series.length} puntos` : "—")}
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

        <div style={{
          marginTop: 14, background: "white", border: "1px solid #e5e7eb",
          borderRadius: 16, padding: 14
        }}>
          <div style={{ height: 440 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="t" minTickGap={40} />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="pml" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
            Fuente: CENACE (PML MDA). Datos servidos desde S3.
          </div>
        </div>
      </div>
    </div>
  );
}
