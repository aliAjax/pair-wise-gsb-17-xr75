import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import "./styles.css";

const project = {
  id: "hxwl-03",
  port: 5103,
  title: "岩土钻孔编录",
  subtitle: "钻孔分层、标贯与地下水位的现场记录面板，台账保存在本机浏览器，重开不丢。",
  stack: "React + Vite + TypeScript + CSS",
  domain: "岩土工程",
  users: ["岩土工程师", "现场编录员", "项目负责人"],
};

const STORAGE_KEY = "hxwl-03-ledger-v1";

interface LayerRecord {
  id: string;
  holeId: string; // 钻孔编号
  layerBottom: number; // 层底深度 m
  lithology: string; // 岩性描述
  soilColor: string; // 土色
  density: string; // 密实度 / 状态
  spt: number | null; // 标贯击数
  waterLevel: number | null; // 地下水位 m
  note: string;
  updatedAt: number;
}

type Draft = Omit<LayerRecord, "id" | "updatedAt">;

interface HoleGroup {
  holeId: string;
  layers: LayerRecord[]; // 按层底深度升序
  depth: number; // 孔深 = 最深层底
  lastActivity: number;
  waterLevel: number | null; // 该孔最近一次水位
}

const statusColors = ["status-ok", "status-watch", "status-danger"];

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const fmt1 = (n: number) => String(Math.round(n * 10) / 10);

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function seedRecords(): LayerRecord[] {
  const now = Date.now();
  return [
    { id: uid(), holeId: "ZK-24", layerBottom: 18.4, lithology: "强风化泥岩", soilColor: "", density: "硬塑", spt: null, waterLevel: null, note: "芯样完整率62%", updatedAt: now - 3 * 60000 },
    { id: uid(), holeId: "ZK-21", layerBottom: 31.2, lithology: "卵石层", soilColor: "", density: "稍密", spt: null, waterLevel: null, note: "夹中粗砂，取样困难", updatedAt: now - 2 * 60000 },
    { id: uid(), holeId: "ZK-18", layerBottom: 22.6, lithology: "粉质黏土", soilColor: "", density: "中密", spt: 12, waterLevel: 3.4, note: "", updatedAt: now - 1 * 60000 },
  ];
}

function isRecord(x: unknown): x is LayerRecord {
  if (!x || typeof x !== "object") return false;
  const r = x as Partial<LayerRecord>;
  return typeof r.id === "string" && typeof r.holeId === "string" && typeof r.layerBottom === "number";
}

function loadRecords(): LayerRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedRecords();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return seedRecords();
    const valid = parsed.filter(isRecord);
    return valid.length ? valid : seedRecords();
  } catch {
    return seedRecords();
  }
}

function groupByHole(records: LayerRecord[]): HoleGroup[] {
  const map = new Map<string, LayerRecord[]>();
  for (const r of records) {
    const list = map.get(r.holeId) ?? [];
    list.push(r);
    map.set(r.holeId, list);
  }
  return [...map.entries()]
    .map(([holeId, layers]) => {
      const sorted = [...layers].sort((a, b) => a.layerBottom - b.layerBottom);
      const lastActivity = Math.max(...sorted.map((r) => r.updatedAt));
      const latestWater = [...sorted].filter((r) => r.waterLevel != null).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      return {
        holeId,
        layers: sorted,
        depth: Math.max(...sorted.map((r) => r.layerBottom)),
        lastActivity,
        waterLevel: latestWater ? latestWater.waterLevel : null,
      };
    })
    .sort((a, b) => b.lastActivity - a.lastActivity);
}

function summarize(r: Draft): string {
  const parts = [r.lithology || "（未填岩性）"];
  if (r.soilColor) parts.push(r.soilColor);
  if (r.density) parts.push(r.density);
  if (r.spt != null) parts.push(`标贯 ${fmt(r.spt)} 击`);
  if (r.waterLevel != null) parts.push(`水位 ${fmt(r.waterLevel)} m`);
  if (r.note) parts.push(r.note);
  return parts.join("｜");
}

function timeText(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const emptyForm = {
  holeId: "",
  layerBottom: "",
  lithology: "",
  soilColor: "",
  density: "",
  spt: "",
  waterLevel: "",
  note: "",
};

type FormState = typeof emptyForm;

function MetricCard({ label, value, hint, index }: { label: string; value: string; hint: string; index: number }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
      <i className={statusColors[index % statusColors.length]} />
    </article>
  );
}

function App() {
  const [records, setRecords] = useState<LayerRecord[]>(loadRecords);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<{ existing: LayerRecord; incoming: Draft } | null>(null);
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch {
      // 存储不可用时仅保留内存台账
    }
  }, [records]);

  const holes = useMemo(() => groupByHole(records), [records]);

  const metrics = useMemo(() => {
    const totalDepth = holes.reduce((s, h) => s + h.depth, 0);
    let maxSpt: { value: number; record: LayerRecord } | null = null;
    let latestWater: { value: number; record: LayerRecord } | null = null;
    for (const r of records) {
      if (r.spt != null && (maxSpt == null || r.spt > maxSpt.value)) maxSpt = { value: r.spt, record: r };
      if (r.waterLevel != null && (latestWater == null || r.updatedAt > latestWater.record.updatedAt))
        latestWater = { value: r.waterLevel, record: r };
    }
    return { totalDepth, layerCount: records.length, holeCount: holes.length, maxSpt, latestWater };
  }, [holes, records]);

  const filterOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of records) {
      if (r.lithology) counts.set(r.lithology, (counts.get(r.lithology) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"));
  }, [records]);

  const activeFilter = filter && filterOptions.some(([name]) => name === filter) ? filter : null;

  const visibleHoles = useMemo(() => {
    if (!activeFilter) return holes;
    return holes
      .map((h) => ({ ...h, layers: h.layers.filter((r) => r.lithology === activeFilter) }))
      .filter((h) => h.layers.length > 0);
  }, [holes, activeFilter]);

  const visibleLayerCount = visibleHoles.reduce((s, h) => s + h.layers.length, 0);

  const setField = (key: keyof FormState) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function commit(next: LayerRecord[], message: string, keepHole: string) {
    setRecords(next);
    setPending(null);
    setFormError(null);
    setNotice(message);
    setForm({ ...emptyForm, holeId: keepHole });
  }

  function handleSave() {
    setNotice(null);
    const holeId = form.holeId.trim();
    const lithology = form.lithology.trim();
    const errors: string[] = [];
    if (!holeId) errors.push("钻孔编号必填");
    const layerBottom = Number(form.layerBottom);
    if (!form.layerBottom.trim() || !Number.isFinite(layerBottom) || layerBottom <= 0)
      errors.push("层底深度需为大于 0 的数字");
    if (!lithology) errors.push("岩性描述必填（台账筛选按岩性统计）");
    let spt: number | null = null;
    if (form.spt.trim()) {
      const n = Number(form.spt);
      if (!Number.isFinite(n) || n < 0) errors.push("标贯击数需为不小于 0 的数字");
      else spt = n;
    }
    let waterLevel: number | null = null;
    if (form.waterLevel.trim()) {
      const n = Number(form.waterLevel);
      if (!Number.isFinite(n) || n < 0) errors.push("地下水位需为不小于 0 的数字");
      else waterLevel = n;
    }
    if (errors.length) {
      setFormError(errors.join("；"));
      return;
    }

    if (waterLevel != null) {
      const bottoms = records.filter((r) => r.holeId === holeId).map((r) => r.layerBottom);
      const deepest = Math.max(layerBottom, ...bottoms);
      if (waterLevel > deepest) {
        setFormError(
          `已拦住保存：地下水位 ${fmt(waterLevel)} m 深于 ${holeId} 当前最深层底 ${fmt(deepest)} m，水位不可能超过孔底，请核对数值后再存。`
        );
        return;
      }
    }

    const incoming: Draft = {
      holeId,
      layerBottom,
      lithology,
      soilColor: form.soilColor.trim(),
      density: form.density.trim(),
      spt,
      waterLevel,
      note: form.note.trim(),
    };

    const existing = records.find((r) => r.holeId === holeId && Math.abs(r.layerBottom - layerBottom) < 1e-9);
    if (existing) {
      setPending({ existing, incoming });
      setFormError(null);
      return;
    }
    commit([...records, { ...incoming, id: uid(), updatedAt: Date.now() }], `已保存 ${holeId} 层底 ${fmt(layerBottom)} m，可继续录入下一层。`, holeId);
  }

  function confirmOverwrite() {
    if (!pending) return;
    const next = records.map((r) =>
      r.id === pending.existing.id ? { ...pending.incoming, id: r.id, updatedAt: Date.now() } : r
    );
    commit(next, `已覆盖 ${pending.existing.holeId} 层底 ${fmt(pending.existing.layerBottom)} m 的旧记录。`, pending.incoming.holeId);
  }

  function cancelOverwrite() {
    if (!pending) return;
    setPending(null);
    setNotice(`已取消覆盖，${pending.existing.holeId} 层底 ${fmt(pending.existing.layerBottom)} m 的原记录照旧保留。`);
  }

  function exportSummary() {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const lines: string[] = [
      "岩土钻孔编录 · 连续作业台账摘要",
      `导出时间：${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      "台账口径：与页面看板同源的本机台账记录",
      "",
      `累计孔深：${fmt1(metrics.totalDepth)} m（${metrics.holeCount} 孔）`,
      `地层数量：${metrics.layerCount} 层`,
      `最高标贯：${metrics.maxSpt ? `${fmt(metrics.maxSpt.value)} 击（${metrics.maxSpt.record.holeId} 层底 ${fmt(metrics.maxSpt.record.layerBottom)} m）` : "—"}`,
      `地下水位：${metrics.latestWater ? `${fmt(metrics.latestWater.value)} m（最近一次：${metrics.latestWater.record.holeId}，记于 ${timeText(metrics.latestWater.record.updatedAt)}）` : "—"}`,
      "",
    ];
    for (const h of holes) {
      lines.push(
        `【${h.holeId}】孔深 ${fmt(h.depth)} m · ${h.layers.length} 层${h.waterLevel != null ? ` · 水位 ${fmt(h.waterLevel)} m` : ""}`
      );
      h.layers.forEach((r, i) => {
        lines.push(`  ${i + 1}. 层底 ${fmt(r.layerBottom)} m｜${summarize(r)}｜记于 ${timeText(r.updatedAt)}`);
      });
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `钻孔台账摘要-${stamp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const metricCards = [
    { label: "累计孔深", value: `${fmt1(metrics.totalDepth)} m`, hint: `${metrics.holeCount} 孔在册` },
    { label: "地层数量", value: `${metrics.layerCount} 层`, hint: metrics.holeCount ? `覆盖 ${metrics.holeCount} 孔` : "暂无记录" },
    {
      label: "最高标贯",
      value: metrics.maxSpt ? `${fmt(metrics.maxSpt.value)} 击` : "—",
      hint: metrics.maxSpt ? `${metrics.maxSpt.record.holeId} · 层底 ${fmt(metrics.maxSpt.record.layerBottom)} m` : "暂无标贯记录",
    },
    {
      label: "地下水位",
      value: metrics.latestWater ? `${fmt(metrics.latestWater.value)} m` : "—",
      hint: metrics.latestWater ? `最近一次 · ${metrics.latestWater.record.holeId}` : "暂无水位记录",
    },
  ];

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">
            {project.id} · port {project.port}
          </p>
          <h1>{project.title}</h1>
          <p className="subtitle">{project.subtitle}</p>
        </div>
        <div className="stack-card">
          <span>技术栈</span>
          <strong>{project.stack}</strong>
        </div>
      </section>

      <section className="metrics-grid">
        {metricCards.map((card, index) => (
          <MetricCard key={card.label} label={card.label} value={card.value} hint={card.hint} index={index} />
        ))}
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>角色</h2>
          <div className="chips">
            {project.users.map((user) => (
              <span key={user}>{user}</span>
            ))}
          </div>
          <h2>筛选（按岩性）</h2>
          <div className="chips muted">
            <button type="button" className={activeFilter == null ? "active" : ""} onClick={() => setFilter(null)}>
              全部
            </button>
            {filterOptions.map(([name, count]) => (
              <button
                type="button"
                key={name}
                className={activeFilter === name ? "active" : ""}
                onClick={() => setFilter(activeFilter === name ? null : name)}
              >
                {name}（{count}）
              </button>
            ))}
          </div>
          <p className="aside-note">筛选项由台账记录自动统计，当前 {filterOptions.length} 类岩性。</p>
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>{project.domain}</p>
              <h2>录入地层</h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setForm(emptyForm);
                setPending(null);
                setFormError(null);
                setNotice(null);
              }}
            >
              清空表单
            </button>
          </div>
          <div className="field-grid">
            <label>
              <span>钻孔编号 *</span>
              <input value={form.holeId} onChange={setField("holeId")} placeholder="如 ZK-18" />
            </label>
            <label>
              <span>层底深度（m）*</span>
              <input value={form.layerBottom} onChange={setField("layerBottom")} inputMode="decimal" placeholder="如 5.2" />
            </label>
            <label>
              <span>岩性描述 *</span>
              <input value={form.lithology} onChange={setField("lithology")} placeholder="如 粉质黏土" />
            </label>
            <label>
              <span>土色</span>
              <input value={form.soilColor} onChange={setField("soilColor")} placeholder="如 灰黄色" />
            </label>
            <label>
              <span>密实度 / 状态</span>
              <input value={form.density} onChange={setField("density")} placeholder="如 中密、硬塑" />
            </label>
            <label>
              <span>标贯击数（击）</span>
              <input value={form.spt} onChange={setField("spt")} inputMode="numeric" placeholder="如 12" />
            </label>
            <label>
              <span>地下水位（m）</span>
              <input value={form.waterLevel} onChange={setField("waterLevel")} inputMode="decimal" placeholder="不得深于该孔最深层底" />
            </label>
            <label>
              <span>备注</span>
              <input value={form.note} onChange={setField("note")} placeholder="取样、芯样情况等" />
            </label>
          </div>

          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}

          {pending && (
            <div className="confirm-box">
              <p>
                <strong>
                  {pending.existing.holeId} 在层底 {fmt(pending.existing.layerBottom)} m 已有记录
                </strong>
                ，确认后新内容将替换下面这条旧记录：
              </p>
              <p className="confirm-line">
                旧记录：{summarize(pending.existing)}（记于 {timeText(pending.existing.updatedAt)}）
              </p>
              <p className="confirm-line">新记录：{summarize(pending.incoming)}</p>
              <div className="confirm-actions">
                <button type="button" className="primary-action" onClick={confirmOverwrite}>
                  确认覆盖旧记录
                </button>
                <button type="button" onClick={cancelOverwrite}>
                  取消，保留原记录
                </button>
              </div>
            </div>
          )}

          {notice && <p className="form-notice">{notice}</p>}

          <div className="form-actions">
            <button type="button" className="primary-action" onClick={handleSave}>
              保存记录
            </button>
          </div>
        </section>
      </section>

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>连续作业台账 · 本机持久保存</p>
            <h2>钻孔台账</h2>
          </div>
          <button type="button" onClick={exportSummary} disabled={!records.length}>
            导出摘要
          </button>
        </div>
        {activeFilter && (
          <p className="filter-hint">
            已按「{activeFilter}」筛选：显示 {visibleLayerCount} 层 / 共 {records.length} 层。
          </p>
        )}
        <div className="hole-list">
          {visibleHoles.map((h) => (
            <article className="hole-card" key={h.holeId}>
              <header>
                <h3>{h.holeId}</h3>
                <p>
                  孔深 {fmt(h.depth)} m · {h.layers.length} 层{activeFilter ? "（筛选后）" : ""}
                  {h.waterLevel != null ? ` · 水位 ${fmt(h.waterLevel)} m` : ""}
                </p>
              </header>
              <div className="record-list">
                {h.layers.map((r, i) => (
                  <div className="record-card" key={r.id}>
                    <div className="record-index">{String(i + 1).padStart(2, "0")}</div>
                    <div>
                      <h3>层底 {fmt(r.layerBottom)} m</h3>
                      <p>{summarize(r)}</p>
                      <p className="record-time">记于 {timeText(r.updatedAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
          {!visibleHoles.length && (
            <p className="empty-state">
              {activeFilter ? `台账中没有岩性为「${activeFilter}」的记录。` : "台账暂无记录，请在上方录入第一口钻孔的第一层。"}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

export default App;
