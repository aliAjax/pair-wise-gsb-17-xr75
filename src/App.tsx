import "./styles.css";

const project = {
  "id": "hxwl-03",
  "port": 5103,
  "title": "岩土钻孔编录",
  "subtitle": "钻孔分层、标贯与地下水位的现场记录面板",
  "stack": "React + Vite + TypeScript + CSS",
  "theme": [
    "#92400e",
    "#0f766e",
    "#2563eb"
  ],
  "domain": "岩土工程",
  "users": [
    "岩土工程师",
    "现场编录员",
    "项目负责人"
  ],
  "metrics": [
    "累计孔深",
    "地层数量",
    "最高标贯",
    "地下水位"
  ],
  "filters": [
    "黏土",
    "粉砂",
    "卵石",
    "强风化"
  ],
  "fields": [
    "钻孔编号",
    "孔深",
    "分层深度",
    "岩性描述",
    "土色",
    "标贯击数",
    "地下水位"
  ],
  "records": [
    [
      "ZK-18",
      "22.6m",
      "粉质黏土",
      "中密",
      "标贯12击，水位3.4m"
    ],
    [
      "ZK-21",
      "31.2m",
      "卵石层",
      "稍密",
      "夹中粗砂，取样困难"
    ],
    [
      "ZK-24",
      "18.4m",
      "强风化泥岩",
      "硬塑",
      "芯样完整率62%"
    ]
  ]
};

const statusColors = ["status-ok", "status-watch", "status-danger"];

function MetricCard({ label, value, index }: { label: string; value: string; index: number }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={statusColors[index % statusColors.length]} />
    </article>
  );
}

function App() {
  const values = project.metrics.map((metric: string, index: number) => {
    const base = [84, 12, 31, 7][index % 4];
    return String(base + index * 3);
  });

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">{project.id} · port {project.port}</p>
          <h1>{project.title}</h1>
          <p className="subtitle">{project.subtitle}</p>
        </div>
        <div className="stack-card">
          <span>技术栈</span>
          <strong>{project.stack}</strong>
        </div>
      </section>

      <section className="metrics-grid">
        {project.metrics.map((metric: string, index: number) => (
          <MetricCard key={metric} label={metric} value={values[index]} index={index} />
        ))}
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>角色</h2>
          <div className="chips">
            {project.users.map((user: string) => (
              <span key={user}>{user}</span>
            ))}
          </div>
          <h2>筛选</h2>
          <div className="chips muted">
            {project.filters.map((filter: string) => (
              <button key={filter}>{filter}</button>
            ))}
          </div>
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>{project.domain}</p>
              <h2>记录字段</h2>
            </div>
            <button className="primary-action">新增记录</button>
          </div>
          <div className="field-grid">
            {project.fields.map((field: string) => (
              <label key={field}>
                <span>{field}</span>
                <input placeholder={"填写" + field} />
              </label>
            ))}
          </div>
        </section>
      </section>

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>示例数据</p>
            <h2>近期记录</h2>
          </div>
          <button>导出摘要</button>
        </div>
        <div className="record-list">
          {project.records.map((record: string[], index: number) => (
            <article key={record.join("-")} className="record-card">
              <div className="record-index">{String(index + 1).padStart(2, "0")}</div>
              <div>
                <h3>{record[0]}</h3>
                <p>{record.slice(1).join(" · ")}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
