import { useEffect, useState } from "react";
import { useFetch, fmtNum } from "../hooks";
import { Empty, ErrorState, Loading, PageHeader, Pager, cx, inputCls, tableWrap, tdCls, thCls, Field } from "../ui.jsx";

export default function Imports() {
  const runs = useFetch("/imports", { per_page: 20 });
  const [selected, setSelected] = useState(null);
  useEffect(() => { if (runs.data?.items.length && selected == null) setSelected(runs.data.items[0].import_run_id); }, [runs.data]); // eslint-disable-line

  if (runs.error) return <ErrorState error={runs.error} onRetry={runs.reload} />;
  if (!runs.data) return <Loading />;
  return (
    <>
      <PageHeader title="Import reports" />
      <p className="mb-4 max-w-prose text-sm text-muted">Rows with errors are not loaded. They are kept here with the original data so nothing is silently changed. Warnings are loaded but flagged.</p>
      {runs.data.items.length === 0 ? <Empty title="No imports yet">Run the CSV importer to see a report here.</Empty> : (
        <>
          <div className={tableWrap}>
            <table className="w-full">
              <thead className="border-b border-line bg-panel"><tr><th className={thCls}>File</th><th className={thCls}>Warehouse</th><th className={`${thCls} text-right`}>Processed</th><th className={`${thCls} text-right`}>Imported</th><th className={`${thCls} text-right`}>Rejected</th><th className={`${thCls} text-right`}>Warnings</th></tr></thead>
              <tbody className="divide-y divide-line">
                {runs.data.items.map((r) => (
                  <tr key={r.import_run_id} className={cx("cursor-pointer hover:bg-panel", selected === r.import_run_id && "bg-panel")} onClick={() => setSelected(r.import_run_id)}>
                    <td className={tdCls}>
                      <button className="text-left font-bold text-brand hover:underline" aria-pressed={selected === r.import_run_id} onClick={() => setSelected(r.import_run_id)}>{r.filename}</button>
                      <div className="text-muted">Run {r.import_run_id}</div>
                    </td>
                    <td className={tdCls}>{r.warehouse}</td>
                    <td className={`${tdCls} text-right`}>{fmtNum(r.records_processed)}</td><td className={`${tdCls} text-right`}>{fmtNum(r.records_imported)}</td>
                    <td className={`${tdCls} text-right ${r.error_count ? "font-bold text-bad" : ""}`}>{fmtNum(r.error_count)}</td>
                    <td className={`${tdCls} text-right ${r.warning_count ? "font-bold text-warn" : ""}`}>{fmtNum(r.warning_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected != null && <Issues key={selected} runId={selected} />}
        </>
      )}
    </>
  );
}

function Issues({ runId }) {
  const [severity, setSeverity] = useState("error");
  const [page, setPage] = useState(1);
  const { data, error, reload } = useFetch(`/imports/${runId}/issues`, { severity, page, per_page: 15 });
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-bold">Issues in run {runId}</h2>
        <div className="w-60"><Field label="Show">{(id) => (
          <select id={id} className={inputCls} value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }}>
            <option value="error">Errors (rejected rows)</option><option value="warning">Warnings</option><option value="">Both</option>
          </select>)}</Field></div>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading /> : data.items.length === 0 ? <Empty title="No issues of this kind" /> : (
        <>
          <div className={tableWrap}>
            <table className="w-full">
              <thead className="border-b border-line bg-panel"><tr><th className={thCls}>Row</th><th className={thCls}>Type</th><th className={thCls}>Rule</th><th className={thCls}>What happened</th></tr></thead>
              <tbody className="divide-y divide-line">
                {data.items.map((i) => (
                  <tr key={i.issue_id}>
                    <td className={tdCls}>{i.row_number === 0 ? "Whole file" : i.row_number}</td>
                    <td className={tdCls}><span className={cx("rounded px-2 py-0.5 text-sm font-bold", i.severity === "error" ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn")}>{i.severity === "error" ? "Error" : "Warning"}</span></td>
                    <td className={tdCls}>{i.rule_code.replaceAll("_", " ").toLowerCase()}</td>
                    <td className={tdCls}>
                      {i.message}
                      {Object.keys(i.raw_row).length > 0 && <details className="mt-1"><summary className="cursor-pointer text-brand">View original row</summary><pre className="mt-1 overflow-x-auto rounded bg-panel p-2 text-xs">{JSON.stringify(i.raw_row, null, 2)}</pre></details>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} perPage={15} total={data.total} onPage={setPage} />
        </>
      )}
    </section>
  );
}
