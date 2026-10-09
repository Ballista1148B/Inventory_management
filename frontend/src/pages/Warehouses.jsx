import { useState } from "react";
import { api } from "../api";
import { fmtDate, fmtNum, useFetch } from "../hooks";
import { Alert, Button, Empty, ErrorState, Field, Loading, Modal, PageHeader, inputCls, tableWrap, tdCls, thCls, useToast } from "../ui.jsx";

export default function Warehouses() {
  const wh = useFetch("/warehouses");
  const inds = useFetch("/industries");
  const [modal, setModal] = useState(null); // "warehouse" | "industry"
  const toast = useToast();

  if (wh.error) return <ErrorState error={wh.error} onRetry={wh.reload} />;
  if (!wh.data || !inds.data) return <Loading />;

  return (
    <>
      <PageHeader title="Warehouses"><Button variant="primary" onClick={() => setModal("warehouse")}>New warehouse</Button></PageHeader>
      {wh.data.items.length === 0 ? <Empty title="No warehouses yet">Create one to start receiving or importing stock.</Empty> : (
        <div className={tableWrap}>
          <table className="w-full">
            <thead className="border-b border-line bg-panel"><tr><th className={thCls}>Name</th><th className={thCls}>Industry</th><th className={thCls}>Location</th><th className={thCls}>Created</th><th className={`${thCls} text-right`}>Batches</th><th className={`${thCls} text-right`}>Units</th></tr></thead>
            <tbody className="divide-y divide-line">
              {wh.data.items.map((w) => (
                <tr key={w.warehouse_id}><td className={`${tdCls} font-bold`}>{w.name}</td><td className={tdCls}>{w.industry}</td><td className={tdCls}>{w.location || "Not set"}</td>
                  <td className={`${tdCls} whitespace-nowrap`}>{fmtDate(w.created_at.slice(0, 10))}</td><td className={`${tdCls} text-right`}>{fmtNum(w.batch_count)}</td><td className={`${tdCls} text-right`}>{fmtNum(w.total_units)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mb-2 mt-10 flex items-center justify-between">
        <h2 className="text-lg font-bold">Industries</h2>
        <Button onClick={() => setModal("industry")}>Add industry</Button>
      </div>
      <p className="mb-3 max-w-prose text-sm text-muted">An industry is just a label that groups warehouses and products. Adding one needs no database change.</p>
      <div className={tableWrap}>
        <table className="w-full">
          <thead className="border-b border-line bg-panel"><tr><th className={thCls}>Industry</th><th className={`${thCls} text-right`}>Warehouses</th><th className={`${thCls} text-right`}>Products</th></tr></thead>
          <tbody className="divide-y divide-line">
            {inds.data.items.map((i) => <tr key={i.industry_type_id}><td className={`${tdCls} font-bold`}>{i.name}</td><td className={`${tdCls} text-right`}>{i.warehouses}</td><td className={`${tdCls} text-right`}>{fmtNum(i.products)}</td></tr>)}
          </tbody>
        </table>
      </div>

      {modal === "warehouse" && <WarehouseModal industries={inds.data.items} onClose={() => setModal(null)} onDone={(n) => { setModal(null); toast(`Created ${n}`); wh.reload(); inds.reload(); }} />}
      {modal === "industry" && <IndustryModal onClose={() => setModal(null)} onDone={(n) => { setModal(null); toast(`Added industry ${n}`); inds.reload(); }} />}
    </>
  );
}

function WarehouseModal({ industries, onClose, onDone }) {
  const [v, setV] = useState({ name: "", industry: industries[0]?.name || "", location: "" });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await api.post("/warehouses", { name: v.name, industry: v.industry, location: v.location || undefined }); onDone(v.name); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }
  return (
    <Modal title="New warehouse" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">{(id) => <input id={id} required className={inputCls} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <Field label="Industry" hint="Stock can only move between warehouses of the same industry.">{(id) => <select id={id} className={inputCls} value={v.industry} onChange={(e) => setV({ ...v, industry: e.target.value })} required>{industries.map((i) => <option key={i.industry_type_id} value={i.name}>{i.name}</option>)}</select>}</Field>
        <Field label="Location">{(id) => <input id={id} className={inputCls} value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} />}</Field>
        <Alert>{err}</Alert>
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? "Creating…" : "Create warehouse"}</Button></div>
      </form>
    </Modal>
  );
}

function IndustryModal({ onClose, onDone }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setErr(null); setBusy(true);
    try { const r = await api.post("/industries", { name }); onDone(r.name); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }
  return (
    <Modal title="Add industry" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Industry name" hint="For example winery, electronics or pharmaceutical.">{(id) => <input id={id} required className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Alert>{err}</Alert>
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? "Adding…" : "Add industry"}</Button></div>
      </form>
    </Modal>
  );
}
