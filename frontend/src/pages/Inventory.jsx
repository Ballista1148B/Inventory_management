import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { fmtDate, fmtMoney, today, useDebounced, useFetch, useQueryFilters } from "../hooks";
import {
  Alert, Button, Empty, ErrorState, Field, Loading, Modal, PageHeader, Pager, Picker, StockGauge,
  inputCls, tableWrap, tdCls, thCls, useToast,
} from "../ui.jsx";

const PER_PAGE = 20;

export default function Inventory() {
  const [f, setFilters] = useQueryFilters();
  const page = Number(f.page) || 1;
  const [search, setSearch] = useState(f.q || "");
  const dsearch = useDebounced(search);
  useEffect(() => { if ((f.q || "") !== dsearch) setFilters({ q: dsearch }); }, [dsearch]); // eslint-disable-line

  const whs = useFetch("/warehouses");
  const inv = useFetch("/inventory", {
    warehouse_id: f.warehouse_id, q: f.q, low_stock: f.low_stock, expiring_before: f.expiring_before,
    page, per_page: PER_PAGE,
  });
  const [transfer, setTransfer] = useState(null);
  const [receiving, setReceiving] = useState(false);
  const toast = useToast();

  return (
    <>
      <PageHeader title="Inventory">
        <Button variant="primary" onClick={() => setReceiving(true)}>Receive stock</Button>
      </PageHeader>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Search products">
          {(id) => <input id={id} className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. rice" />}
        </Field>
        <Field label="Warehouse">
          {(id) => (
            <select id={id} className={inputCls} value={f.warehouse_id || ""} onChange={(e) => setFilters({ warehouse_id: e.target.value })}>
              <option value="">All warehouses</option>
              {whs.data?.items.map((w) => <option key={w.warehouse_id} value={w.warehouse_id}>{w.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Expires on or before">
          {(id) => <input id={id} type="date" className={inputCls} value={f.expiring_before || ""} onChange={(e) => setFilters({ expiring_before: e.target.value })} />}
        </Field>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm font-bold">
            <input type="checkbox" className="size-4" checked={f.low_stock === "1"} onChange={(e) => setFilters({ low_stock: e.target.checked ? "1" : "" })} />
            Low stock only
          </label>
        </div>
      </div>

      {inv.error ? <ErrorState error={inv.error} onRetry={inv.reload} /> : !inv.data ? <Loading /> :
        inv.data.items.length === 0 ? <Empty title="No stock matches these filters">Clear a filter, or receive stock into a warehouse.</Empty> : (
          <>
            <div className={tableWrap}>
              <table className="w-full">
                <thead className="border-b border-line bg-panel">
                  <tr>
                    <th className={thCls}>Product</th><th className={thCls}>Warehouse</th><th className={thCls}>Stock against reorder level</th>
                    <th className={`${thCls} text-right`}>Unit price</th><th className={thCls}>Received</th><th className={thCls}>Expires</th><th className={thCls}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {inv.data.items.map((r) => (
                    <tr key={`${r.batch_id}-${r.warehouse_id}`}>
                      <td className={tdCls}>
                        <Link className="font-bold text-brand hover:underline" to={`/products/${r.product_id}`}>{r.product_name}</Link>
                        <div className="text-muted">{r.category_name || "Uncategorized"} from {r.supplier_name}</div>
                      </td>
                      <td className={tdCls}>{r.warehouse}</td>
                      <td className={tdCls}><StockGauge quantity={r.quantity} reorderLevel={r.reorder_level} /></td>
                      <td className={`${tdCls} text-right`}>{fmtMoney(r.unit_price)}</td>
                      <td className={`${tdCls} whitespace-nowrap`}>{fmtDate(r.received_date)}</td>
                      <td className={`${tdCls} whitespace-nowrap`}>{fmtDate(r.expiration_date)}</td>
                      <td className={tdCls}><Button disabled={r.quantity === 0} onClick={() => setTransfer(r)}>Transfer</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} perPage={PER_PAGE} total={inv.data.total} onPage={(p) => setFilters({ page: p })} />
          </>
        )}

      {transfer && (
        <TransferModal row={transfer} warehouses={whs.data?.items || []} onClose={() => setTransfer(null)}
          onDone={(msg) => { setTransfer(null); toast(msg); inv.reload(); whs.reload(); }} />
      )}
      {receiving && (
        <ReceiveModal warehouses={whs.data?.items || []} onClose={() => setReceiving(false)}
          onDone={(msg) => { setReceiving(false); toast(msg); inv.reload(); whs.reload(); }} />
      )}
    </>
  );
}

function TransferModal({ row, warehouses, onClose, onDone }) {
  const targets = warehouses.filter((w) => w.warehouse_id !== row.warehouse_id);
  const [to, setTo] = useState(targets[0]?.warehouse_id || "");
  const [qty, setQty] = useState(1);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      await api.post("/transfers", { batch_id: row.batch_id, from_warehouse_id: row.warehouse_id, to_warehouse_id: Number(to), quantity: Number(qty) });
      const dest = targets.find((w) => w.warehouse_id === Number(to))?.name;
      onDone(`Moved ${qty} × ${row.product_name} to ${dest}`);
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  return (
    <Modal title="Transfer stock" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm"><span className="font-bold">{row.product_name}</span> in {row.warehouse} has {row.quantity} units available.</p>
        {targets.length === 0 ? <Alert kind="warn">Create a second warehouse before transferring stock.</Alert> : (
          <>
            <Field label="Destination warehouse">
              {(id) => <select id={id} className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}>
                {targets.map((w) => <option key={w.warehouse_id} value={w.warehouse_id}>{w.name} ({w.industry})</option>)}
              </select>}
            </Field>
            <Field label="Quantity">
              {(id) => <input id={id} type="number" min="1" max={row.quantity} required className={inputCls} value={qty} onChange={(e) => setQty(e.target.value)} />}
            </Field>
          </>
        )}
        <Alert>{err}</Alert>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || targets.length === 0}>{busy ? "Moving…" : "Move stock"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ReceiveModal({ warehouses, onClose, onDone }) {
  const [product, setProduct] = useState(null);
  const [supplier, setSupplier] = useState(null);
  const [v, setV] = useState({ warehouse_id: warehouses[0]?.warehouse_id || "", quantity: "", unit_price: "", received_date: today(), expiration_date: "", reorder_level: "", reorder_quantity: "" });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (!product || !supplier) return setErr("Choose a product and a supplier.");
    setErr(null); setBusy(true);
    const num = (x) => (x === "" ? undefined : Number(x));
    try {
      await api.post("/batches", {
        product_id: product.product_id, supplier_id: supplier.supplier_id, warehouse_id: Number(v.warehouse_id),
        quantity: num(v.quantity), unit_price: num(v.unit_price), received_date: v.received_date,
        expiration_date: v.expiration_date || undefined, reorder_level: num(v.reorder_level), reorder_quantity: num(v.reorder_quantity),
      });
      onDone(`Received ${v.quantity} × ${product.product_name}`);
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  const num = (label, k, extra = {}) => (
    <Field label={label}>{(id) => <input id={id} type="number" min="0" step={extra.step || 1} className={inputCls} value={v[k]} onChange={set(k)} {...extra} />}</Field>
  );

  return (
    <Modal title="Receive stock" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Picker label="Product" path="/products" labelOf={(p) => p.product_name} value={product} onChange={setProduct} />
        <Picker label="Supplier" path="/suppliers" labelOf={(s) => s.supplier_name} value={supplier} onChange={setSupplier} />
        <Field label="Warehouse">
          {(id) => <select id={id} className={inputCls} value={v.warehouse_id} onChange={set("warehouse_id")} required>
            {warehouses.map((w) => <option key={w.warehouse_id} value={w.warehouse_id}>{w.name} ({w.industry})</option>)}
          </select>}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {num("Quantity", "quantity", { required: true })}
          {num("Unit price ($)", "unit_price", { required: true, step: "0.01" })}
          <Field label="Received on">{(id) => <input id={id} type="date" required className={inputCls} value={v.received_date} onChange={set("received_date")} />}</Field>
          <Field label="Expires on" hint="Leave empty if it doesn't expire.">{(id) => <input id={id} type="date" className={inputCls} value={v.expiration_date} onChange={set("expiration_date")} />}</Field>
          {num("Reorder level", "reorder_level")}
          {num("Reorder quantity", "reorder_quantity")}
        </div>
        <Alert>{err}</Alert>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Receive stock"}</Button>
        </div>
      </form>
    </Modal>
  );
}
