import { useMemo, useRef, useState } from "react";
import "./styles.css";
import {
  LayerEntry,
  LedgerState,
  buildSummary,
  computeMetrics,
  deepestBottom,
  describeEntryInline,
  findConflict,
  fmtDepth,
  fmtTime,
  groupByHole,
  loadLedger,
  parseLedgerFile,
  persistLedger,
  serializeLedger,
} from "./ledger";

const project = {
  id: "hxwl-03",
  port: 5103,
  title: "岩土钻孔编录",
  subtitle: "钻孔分层、标贯与地下水位的现场记录面板",
  stack: "React + Vite + TypeScript + CSS",
  domain: "岩土工程",
  users: ["岩土工程师", "现场编录员", "项目负责人"],
};

const statusColors = ["status-ok", "status-watch", "status-danger"];

interface Draft {
  holeId: string;
  layerBottom: string;
  lithology: string;
  soilColor: string;
  spt: string;
  waterLevel: string;
}

const emptyDraft: Draft = {
  holeId: "",
  layerBottom: "",
  lithology: "",
  soilColor: "",
  spt: "",
  waterLevel: "",
};

// 去掉 id/seq/时间戳的待保存内容
type EntryBody = Omit<LayerEntry, "id" | "seq" | "savedAt">;

interface PendingReplace {
  body: EntryBody;
  previous: LayerEntry;
}

function MetricCard({
  label,
  value,
  note,
  index,
}: {
  label: string;
  value: string;
  note?: string;
  index: number;
}) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small className="metric-note">{note}</small> : null}
      <i className={statusColors[index % statusColors.length]} />
    </article>
  );
}

function App() {
  const [ledger, setLedger] = useState<LedgerState>(loadLedger);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingReplace | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const metrics = useMemo(() => computeMetrics(ledger.entries), [ledger.entries]);
  const filterOptions = useMemo(
    () => Array.from(new Set(ledger.entries.map((e) => e.lithology))),
    [ledger.entries]
  );
  // 筛选选项随台账重算；已失效的筛选自动回到“全部”
  const activeFilter =
    ledger.activeFilter && filterOptions.includes(ledger.activeFilter)
      ? ledger.activeFilter
      : null;
  const visibleEntries = useMemo(
    () =>
      activeFilter
        ? ledger.entries.filter((e) => e.lithology === activeFilter)
        : ledger.entries,
    [ledger.entries, activeFilter]
  );
  const groups = useMemo(() => groupByHole(visibleEntries), [visibleEntries]);

  function update(next: LedgerState) {
    setLedger(next);
    persistLedger(next);
  }

  function setFilter(filter: string | null) {
    update({ ...ledger, activeFilter: filter });
  }

  function commitEntry(body: EntryBody, replaceId?: string) {
    const entry: LayerEntry = {
      ...body,
      id: `e${ledger.seq + 1}-${Date.now()}`,
      seq: ledger.seq + 1,
      savedAt: new Date().toISOString(),
    };
    const entries = replaceId
      ? ledger.entries.map((e) => (e.id === replaceId ? entry : e))
      : [...ledger.entries, entry];
    update({ ...ledger, entries, seq: ledger.seq + 1 });
    return entry;
  }

  function handleSave() {
    setError(null);
    setNotice(null);

    const holeId = draft.holeId.trim();
    if (!holeId) {
      setError("请填写钻孔编号。");
      return;
    }
    const layerBottom = Number(draft.layerBottom);
    if (!draft.layerBottom.trim() || !Number.isFinite(layerBottom) || layerBottom <= 0) {
      setError("层底深度需为大于 0 的数字（米）。");
      return;
    }
    const lithology = draft.lithology.trim();
    if (!lithology) {
      setError("请填写岩性描述。");
      return;
    }
    let spt: number | null = null;
    if (draft.spt.trim()) {
      const parsed = Number(draft.spt);
      if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
        setError("标贯击数需为不小于 0 的整数。");
        return;
      }
      spt = parsed;
    }
    let waterLevel: number | null = null;
    if (draft.waterLevel.trim()) {
      const parsed = Number(draft.waterLevel);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError("地下水位需为不小于 0 的数字（米）。");
        return;
      }
      // 水位不得深于孔底：与该孔既有最深层底及本次层底一并比较
      const limit = Math.max(layerBottom, deepestBottom(ledger.entries, holeId) ?? 0);
      if (parsed > limit) {
        setError(
          `已拦截保存：地下水位 ${fmtDepth(parsed)}m 深于 ${holeId} 当前最深层底 ${fmtDepth(
            limit
          )}m，水位不可能深于孔底，请核对后重填。`
        );
        return;
      }
      waterLevel = parsed;
    }

    const body: EntryBody = {
      holeId,
      layerBottom,
      lithology,
      soilColor: draft.soilColor.trim() || "未记录",
      spt,
      waterLevel,
    };

    // 同孔同深度：先说明将覆盖哪条旧记录，确认后才替换
    const conflict = findConflict(ledger.entries, holeId, layerBottom);
    if (conflict) {
      setPending({ body, previous: conflict });
      return;
    }

    commitEntry(body);
    setDraft(emptyDraft);
    setNotice(`已记入台账：${holeId} 层底 ${fmtDepth(layerBottom)}m。`);
  }

  function handleConfirmReplace() {
    if (!pending) return;
    commitEntry(pending.body, pending.previous.id);
    setNotice(
      `已替换 ${pending.previous.holeId} 层底 ${fmtDepth(
        pending.previous.layerBottom
      )}m 的旧记录。`
    );
    setPending(null);
    setDraft(emptyDraft);
    setError(null);
  }

  function handleCancelReplace() {
    setPending(null);
    setNotice("已取消替换，原记录内容照旧保留。");
  }

  function handleExport() {
    const text = buildSummary(ledger, new Date());
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `台账摘要-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleBackup() {
    const blob = new Blob([serializeLedger(ledger)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `台账备份-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFile(file: File) {
    file.text().then((text) => {
      const parsed = parseLedgerFile(text);
      if (!parsed) {
        setError("导入失败：文件不是有效的台账备份。");
        return;
      }
      if (
        !window.confirm(
          `备份包含 ${parsed.entries.length} 条记录，导入后将替换当前台账（现有 ${ledger.entries.length} 条）。确定导入？`
        )
      ) {
        return;
      }
      update(parsed);
      setPending(null);
      setError(null);
      setNotice(`已导入备份：${parsed.entries.length} 条记录。`);
    });
  }

  const metricCards = [
    { label: "累计孔深", value: `${fmtDepth(metrics.totalDepth)} m` },
    { label: "地层数量", value: `${metrics.layerCount} 层` },
    {
      label: "最高标贯",
      value: metrics.maxSpt !== null ? `${metrics.maxSpt} 击` : "—",
    },
    {
      label: "地下水位",
      value: metrics.water ? `${fmtDepth(metrics.water.waterLevel!)} m` : "—",
      note: metrics.water
        ? `最近一次 · ${metrics.water.holeId} · ${fmtTime(metrics.water.savedAt)}`
        : undefined,
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
          <span>台账保存在本机浏览器，重开自动恢复；换设备可用“备份 / 导入”迁移。</span>
        </div>
      </section>

      <section className="metrics-grid">
        {metricCards.map((card, index) => (
          <MetricCard
            key={card.label}
            label={card.label}
            value={card.value}
            note={card.note}
            index={index}
          />
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
          <h2>筛选（按岩性，随台账重算）</h2>
          <div className="chips muted">
            <button
              className={activeFilter === null ? "active" : ""}
              onClick={() => setFilter(null)}
            >
              全部
            </button>
            {filterOptions.map((option) => (
              <button
                key={option}
                className={activeFilter === option ? "active" : ""}
                onClick={() => setFilter(activeFilter === option ? null : option)}
              >
                {option}
              </button>
            ))}
          </div>
          <h2>数据迁移</h2>
          <div className="chips">
            <button onClick={handleBackup}>备份台账</button>
            <button onClick={() => fileInputRef.current?.click()}>导入备份</button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportFile(file);
                e.target.value = "";
              }}
            />
          </div>
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>{project.domain}</p>
              <h2>分层记录</h2>
            </div>
            <button className="primary-action" onClick={handleSave}>
              保存记录
            </button>
          </div>
          <div className="field-grid">
            <label>
              <span>钻孔编号</span>
              <input
                placeholder="如 ZK-25"
                value={draft.holeId}
                onChange={(e) => setDraft({ ...draft, holeId: e.target.value })}
              />
            </label>
            <label>
              <span>层底深度（m）</span>
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="如 12.5"
                value={draft.layerBottom}
                onChange={(e) => setDraft({ ...draft, layerBottom: e.target.value })}
              />
            </label>
            <label>
              <span>岩性描述</span>
              <input
                placeholder="如 粉质黏土"
                value={draft.lithology}
                onChange={(e) => setDraft({ ...draft, lithology: e.target.value })}
              />
            </label>
            <label>
              <span>土色</span>
              <input
                placeholder="如 黄褐色"
                value={draft.soilColor}
                onChange={(e) => setDraft({ ...draft, soilColor: e.target.value })}
              />
            </label>
            <label>
              <span>标贯击数（击，可空）</span>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="如 12"
                value={draft.spt}
                onChange={(e) => setDraft({ ...draft, spt: e.target.value })}
              />
            </label>
            <label>
              <span>地下水位（m，可空）</span>
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="如 3.4"
                value={draft.waterLevel}
                onChange={(e) => setDraft({ ...draft, waterLevel: e.target.value })}
              />
            </label>
          </div>

          {error ? (
            <p className="alert" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? <p className="notice">{notice}</p> : null}

          {pending ? (
            <div className="confirm-box">
              <p>
                <strong>
                  {pending.body.holeId} 层底 {fmtDepth(pending.body.layerBottom)}m
                </strong>{" "}
                已有一条旧记录，继续保存将覆盖它：
              </p>
              <p className="confirm-old">旧记录：{describeEntryInline(pending.previous)}</p>
              <p className="confirm-new">
                新内容：{describeEntryInline({ ...pending.body, id: "", seq: 0, savedAt: "" })}
              </p>
              <div className="confirm-actions">
                <button className="primary-action" onClick={handleConfirmReplace}>
                  确认替换
                </button>
                <button onClick={handleCancelReplace}>取消，保留原记录</button>
              </div>
            </div>
          ) : null}
        </section>
      </section>

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>连续作业台账</p>
            <h2>近期记录{activeFilter ? ` · 筛选：${activeFilter}` : ""}</h2>
          </div>
          <button onClick={handleExport} disabled={ledger.entries.length === 0}>
            导出摘要
          </button>
        </div>
        {groups.length === 0 ? (
          <p className="empty-state">
            {ledger.entries.length === 0
              ? "台账暂无记录，请在上方录入第一条分层。"
              : "当前筛选下没有记录。"}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.holeId} className="hole-group">
              <header className="hole-header">
                <h3>{group.holeId}</h3>
                <span>
                  孔深 {fmtDepth(group.depth)}m · {group.layers.length} 层
                </span>
              </header>
              <div className="record-list">
                {group.layers.map((layer, index) => (
                  <article key={layer.id} className="record-card">
                    <div className="record-index">{String(index + 1).padStart(2, "0")}</div>
                    <div>
                      <h3>
                        层底 {fmtDepth(layer.layerBottom)}m · {layer.lithology}
                      </h3>
                      <p>
                        {[
                          `土色 ${layer.soilColor}`,
                          layer.spt !== null ? `标贯 ${layer.spt} 击` : null,
                          layer.waterLevel !== null
                            ? `水位 ${fmtDepth(layer.waterLevel)}m`
                            : null,
                          `记于 ${fmtTime(layer.savedAt)}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </main>
  );
}

export default App;
