// 连续作业台账：数据模型、持久化、指标重算与摘要导出
// 页面所有展示（指标卡、筛选、记录列表、导出摘要）都从这一份台账派生。

export interface LayerEntry {
  id: string;
  holeId: string; // 钻孔编号
  layerBottom: number; // 层底深度 m
  lithology: string; // 岩性描述
  soilColor: string; // 土色
  spt: number | null; // 标贯击数
  waterLevel: number | null; // 地下水位 m
  savedAt: string; // ISO 时间
  seq: number; // 保存顺序号，用于“最近一次”判定
}

export interface LedgerState {
  entries: LayerEntry[];
  seq: number;
  activeFilter: string | null;
}

const STORAGE_KEY = "hxwl-03.ledger.v1";

// 首次打开时把原页面的示例数据转为台账底稿，之后完全以用户记录为准
function seedLedger(): LedgerState {
  const rows: Array<[string, number, string, string, number | null, number | null, string]> = [
    ["ZK-18", 8.5, "粉质黏土", "黄褐色", 8, null, "2026-09-23T08:40:00"],
    ["ZK-18", 22.6, "粉质黏土", "褐黄色", 12, 3.4, "2026-09-23T10:15:00"],
    ["ZK-21", 14.0, "中粗砂", "灰黄色", 15, null, "2026-09-24T09:05:00"],
    ["ZK-21", 31.2, "卵石层", "杂色", 31, null, "2026-09-24T11:20:00"],
    ["ZK-24", 18.4, "强风化泥岩", "灰绿色", 42, null, "2026-09-25T08:10:00"],
  ];
  const entries: LayerEntry[] = rows.map((r, i) => ({
    id: `seed-${i + 1}`,
    holeId: r[0],
    layerBottom: r[1],
    lithology: r[2],
    soilColor: r[3],
    spt: r[4],
    waterLevel: r[5],
    savedAt: r[6],
    seq: i + 1,
  }));
  return { entries, seq: rows.length, activeFilter: null };
}

function isEntry(value: unknown): value is LayerEntry {
  const e = value as LayerEntry;
  return (
    !!e &&
    typeof e.id === "string" &&
    typeof e.holeId === "string" &&
    typeof e.layerBottom === "number" &&
    Number.isFinite(e.layerBottom) &&
    typeof e.lithology === "string" &&
    typeof e.soilColor === "string" &&
    (e.spt === null || typeof e.spt === "number") &&
    (e.waterLevel === null || typeof e.waterLevel === "number") &&
    typeof e.savedAt === "string" &&
    typeof e.seq === "number"
  );
}

function normalize(value: unknown): LedgerState | null {
  const s = value as LedgerState;
  if (!s || !Array.isArray(s.entries) || !s.entries.every(isEntry)) return null;
  const seq = typeof s.seq === "number" && s.seq >= 0
    ? s.seq
    : s.entries.reduce((m, e) => Math.max(m, e.seq), 0);
  return {
    entries: s.entries,
    seq,
    activeFilter: typeof s.activeFilter === "string" ? s.activeFilter : null,
  };
}

export function loadLedger(): LedgerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedLedger();
    return normalize(JSON.parse(raw)) ?? seedLedger();
  } catch {
    return seedLedger();
  }
}

export function persistLedger(state: LedgerState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时页面仍可本次使用，不阻断记录
  }
}

// 导入备份文件（换设备迁移用）：校验失败返回 null
export function parseLedgerFile(text: string): LedgerState | null {
  try {
    return normalize(JSON.parse(text));
  } catch {
    return null;
  }
}

export function serializeLedger(state: LedgerState): string {
  return JSON.stringify(state, null, 2);
}

export function fmtDepth(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 同一孔号、同一层底深度视为同一条分层记录
export function findConflict(
  entries: LayerEntry[],
  holeId: string,
  layerBottom: number
): LayerEntry | undefined {
  return entries.find(
    (e) => e.holeId === holeId && Math.abs(e.layerBottom - layerBottom) < 1e-6
  );
}

// 该孔当前最深层底（不含待定的新记录）
export function deepestBottom(entries: LayerEntry[], holeId: string): number | null {
  let max: number | null = null;
  for (const e of entries) {
    if (e.holeId !== holeId) continue;
    if (max === null || e.layerBottom > max) max = e.layerBottom;
  }
  return max;
}

export interface Metrics {
  totalDepth: number; // 累计孔深：各孔最深层层底之和
  layerCount: number; // 地层数量
  maxSpt: number | null; // 最高标贯
  water: LayerEntry | null; // 最近一次记录到地下水位的条目
}

export function computeMetrics(entries: LayerEntry[]): Metrics {
  const depthByHole = new Map<string, number>();
  let maxSpt: number | null = null;
  let water: LayerEntry | null = null;
  for (const e of entries) {
    depthByHole.set(e.holeId, Math.max(depthByHole.get(e.holeId) ?? 0, e.layerBottom));
    if (e.spt !== null && (maxSpt === null || e.spt > maxSpt)) maxSpt = e.spt;
    if (e.waterLevel !== null && (water === null || e.seq > water.seq)) water = e;
  }
  let totalDepth = 0;
  depthByHole.forEach((d) => {
    totalDepth += d;
  });
  return { totalDepth, layerCount: entries.length, maxSpt, water };
}

export interface HoleGroup {
  holeId: string;
  depth: number; // 孔深 = 该孔最深层底
  layers: LayerEntry[]; // 按层底深度排队
}

export function groupByHole(entries: LayerEntry[]): HoleGroup[] {
  const map = new Map<string, LayerEntry[]>();
  for (const e of entries) {
    const list = map.get(e.holeId);
    if (list) list.push(e);
    else map.set(e.holeId, [e]);
  }
  const groups: HoleGroup[] = [];
  map.forEach((layers, holeId) => {
    const sorted = [...layers].sort(
      (a, b) => a.layerBottom - b.layerBottom || a.seq - b.seq
    );
    groups.push({
      holeId,
      layers: sorted,
      depth: sorted.length ? sorted[sorted.length - 1].layerBottom : 0,
    });
  });
  // 孔号按首次记录先后排列，保持连续作业的时间线
  groups.sort(
    (a, b) =>
      Math.min(...a.layers.map((l) => l.seq)) - Math.min(...b.layers.map((l) => l.seq))
  );
  return groups;
}

function describeEntry(e: LayerEntry): string {
  const parts = [
    `层底 ${fmtDepth(e.layerBottom)}m`,
    e.lithology,
    e.soilColor,
    e.spt !== null ? `标贯 ${e.spt} 击` : null,
    e.waterLevel !== null ? `水位 ${fmtDepth(e.waterLevel)}m` : null,
  ].filter(Boolean);
  return parts.join("｜");
}

export function describeEntryInline(e: LayerEntry): string {
  return describeEntry(e);
}

// 导出摘要：与页面共用同一份台账与同一套指标口径
export function buildSummary(state: LedgerState, generatedAt: Date): string {
  const metrics = computeMetrics(state.entries);
  const pad = (v: number) => String(v).padStart(2, "0");
  const stamp = `${generatedAt.getFullYear()}-${pad(generatedAt.getMonth() + 1)}-${pad(
    generatedAt.getDate()
  )} ${pad(generatedAt.getHours())}:${pad(generatedAt.getMinutes())}`;

  const lines: string[] = [
    "岩土钻孔编录 · 连续作业台账摘要",
    `项目 hxwl-03 ｜ 导出时间 ${stamp}`,
    `累计孔深 ${fmtDepth(metrics.totalDepth)}m ｜ 地层数量 ${metrics.layerCount} 层 ｜ 最高标贯 ${
      metrics.maxSpt !== null ? `${metrics.maxSpt} 击` : "—"
    } ｜ 地下水位 ${
      metrics.water
        ? `${fmtDepth(metrics.water.waterLevel!)}m（${metrics.water.holeId} 最近记录）`
        : "—"
    }`,
    "",
  ];

  for (const group of groupByHole(state.entries)) {
    lines.push(`${group.holeId} ｜ 孔深 ${fmtDepth(group.depth)}m ｜ ${group.layers.length} 层`);
    group.layers.forEach((layer, i) => {
      lines.push(`  ${String(i + 1).padStart(2, "0")} ${describeEntry(layer)}`);
    });
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}
