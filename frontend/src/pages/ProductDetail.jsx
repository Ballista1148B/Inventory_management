import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { fmtDate, fmtMoney, fmtNum, useFetch } from "../hooks";
import { Alert, Button, Empty, ErrorState, Field, Loading, Modal, PageHeader, inputCls, tableWrap, tdCls, thCls, useToast } from "../ui.jsx";

export default function ProductDetail() {
  const { id } = useParams();
  const { data: p, error, reload } = useFetch(`/products/${id}`);
  const [editing, setEditing] = useState(false);
  const toast = useToast();

  if (error) return error.status === 404 ? <Empty title="Product not found">It may have been removed. <Link className="font-bold text-brand hover:underline" to="/products">Back to products</Link></Empty> : <ErrorState error={error} onRetry={reload} />;
  if (!p) return <Loading />;
  const attrs = Object.entries(p.attributes);

  return (
    <>
      <p className="mb-2 text-sm"><Link className="font-bold text-brand hover:underline" to="/products">Products</Link></p>
      <PageHeader title={p.product_name}><Button onClick={() => setEditing(true)}>Edit details</Button></PageHeader>
      <p className="mb-6 text-base">{p.category_name || "Uncategorized"} in {p.industry}. {fmtNum(p.total_stock)} units in stock across {p.batch_count} {p.batch_count === 1 ? "batch" : "batches"}.</p>

      <h2 className="mb-2 text-lg font-bold">Industry-specific details</h2>
      {attrs.length === 0 ? <p className="mb-6 text-sm text-muted">None recorded for this product.</p> : (
        <dl className="mb-6 grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-1 rounded border border-line bg-white p-4 text-sm">
          {attrs.map(([k, v]) => (<><dt key={`k${k}`} className="font-bold">{k.replaceAll("_", " ")}</dt><dd key={`v${k}`}>{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd></>))}
        </dl>
      )}

      <h2 className="mb-2 text-lg font-bold">Batches</h2>
      {p.batches.length === 0 ? <Empty title="No batches received">Receive stock from the Inventory page.</Empty> : (
        <div className={tableWrap}>
          <table className="w-full">
            <thead className="border-b border-line bg-panel">
              <tr><th className={thCls}>Batch</th><th className={thCls}>Supplier</th><th className={thCls}>Received</th><th className={thCls}>Expires</th><th className={`${thCls} text-right`}>Unit price</th><th className={`${thCls} text-right`}>Received qty</th><th className={thCls}>Stock by warehouse</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {p.batches.map((b) => (
                <tr key={b.batch_id}>
                  <td className={tdCls}>{b.batch_id}</td><td className={tdCls}>{b.supplier_name}</td>
                  <td className={`${tdCls} whitespace-nowrap`}>{fmtDate(b.received_date)}</td><td className={`${tdCls} whitespace-nowrap`}>{fmtDate(b.expiration_date)}</td>
                  <td className={`${tdCls} text-right`}>{fmtMoney(b.unit_price)}</td><td className={`${tdCls} text-right`}>{fmtNum(b.received_quantity)}</td>
                  <td className={tdCls}>{b.stock.length ? b.stock.map((s) => `${s.warehouse}: ${s.quantity}`).join(", ") : "Not stocked"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <EditModal product={p} onClose={() => setEditing(false)} onDone={() => { setEditing(false); toast("Saved changes"); reload(); }} />}
    </>
  );
}

function EditModal({ product, onClose, onDone }) {
  const [name, setName] = useState(product.product_name);
  const [attrs, setAttrs] = useState(JSON.stringify(product.attributes, null, 2));
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    let attributes;
    try { attributes = JSON.parse(attrs.trim() || "{}"); } catch { return setErr("Industry-specific details must be valid JSON."); }
    setErr(null); setBusy(true);
    try { await api.patch(`/products/${product.product_id}`, { product_name: name, attributes }); onDone(); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }
  return (
    <Modal title="Edit product" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Product name">{(id) => <input id={id} required className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Industry-specific details">{(id) => <textarea id={id} rows={6} className={`${inputCls} font-mono`} value={attrs} onChange={(e) => setAttrs(e.target.value)} spellCheck={false} />}</Field>
        <Alert>{err}</Alert>
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button></div>
      </form>
    </Modal>
  );
}
