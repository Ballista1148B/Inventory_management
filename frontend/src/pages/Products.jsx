import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { fmtNum, useDebounced, useFetch, useQueryFilters } from "../hooks";
import { Alert, Button, Empty, ErrorState, Field, Loading, Modal, PageHeader, Pager, inputCls, tableWrap, tdCls, thCls, useToast } from "../ui.jsx";

const PER_PAGE = 20;

export default function Products() {
  const [f, setFilters] = useQueryFilters();
  const page = Number(f.page) || 1;
  const [search, setSearch] = useState(f.q || "");
  const dsearch = useDebounced(search);
  useEffect(() => { if ((f.q || "") !== dsearch) setFilters({ q: dsearch }); }, [dsearch]); // eslint-disable-line
  const cats = useFetch("/categories");
  const inds = useFetch("/industries");
  const { data, error, reload } = useFetch("/products", { q: f.q, category_id: f.category_id, industry: f.industry, page, per_page: PER_PAGE });
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  return (
    <>
      <PageHeader title="Products"><Button variant="primary" onClick={() => setCreating(true)}>New product</Button></PageHeader>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Search products">{(id) => <input id={id} className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. yogurt" />}</Field>
        <Field label="Category">
          {(id) => <select id={id} className={inputCls} value={f.category_id || ""} onChange={(e) => setFilters({ category_id: e.target.value })}>
            <option value="">All categories</option>
            {cats.data?.items.map((c) => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
          </select>}
        </Field>
        <Field label="Industry">
          {(id) => <select id={id} className={inputCls} value={f.industry || ""} onChange={(e) => setFilters({ industry: e.target.value })}>
            <option value="">All industries</option>
            {inds.data?.items.map((i) => <option key={i.industry_type_id} value={i.name}>{i.name}</option>)}
          </select>}
        </Field>
      </div>

      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading /> :
        data.items.length === 0 ? <Empty title="No products match">Try a different search, or add a new product.</Empty> : (
          <>
            <div className={tableWrap}>
              <table className="w-full">
                <thead className="border-b border-line bg-panel">
                  <tr><th className={thCls}>Product</th><th className={thCls}>Category</th><th className={thCls}>Industry</th><th className={`${thCls} text-right`}>Batches</th><th className={`${thCls} text-right`}>Units in stock</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.items.map((p) => (
                    <tr key={p.product_id}>
                      <td className={tdCls}>
                        <Link className="font-bold text-brand hover:underline" to={`/products/${p.product_id}`}>{p.product_name}</Link>
                        {Object.keys(p.attributes).length > 0 && <div className="text-muted">{Object.keys(p.attributes).length} industry-specific details</div>}
                      </td>
                      <td className={tdCls}>{p.category_name || "Uncategorized"}</td>
                      <td className={tdCls}>{p.industry}</td>
                      <td className={`${tdCls} text-right`}>{fmtNum(p.batch_count)}</td>
                      <td className={`${tdCls} text-right`}>{fmtNum(p.total_stock)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} perPage={PER_PAGE} total={data.total} onPage={(p) => setFilters({ page: p })} />
          </>
        )}

      {creating && <NewProductModal categories={cats.data?.items || []} industries={inds.data?.items || []} onClose={() => setCreating(false)}
        onDone={(p) => { setCreating(false); toast(`Added ${p.product_name}`); navigate(`/products/${p.product_id}`); }} />}
    </>
  );
}

function NewProductModal({ categories, industries, onClose, onDone }) {
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState(industries[0]?.name || "");
  const [category, setCategory] = useState("");
  const [attrs, setAttrs] = useState("{\n  \n}");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    let attributes;
    try { attributes = JSON.parse(attrs.trim() || "{}"); } catch { return setErr("Industry-specific details must be valid JSON, for example {\"vintage_year\": 2019}."); }
    setErr(null); setBusy(true);
    try {
      const p = await api.post("/products", { product_name: name, industry, category_id: category ? Number(category) : undefined, attributes });
      onDone(p);
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  return (
    <Modal title="New product" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Product name">{(id) => <input id={id} required className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Industry">{(id) => <select id={id} className={inputCls} value={industry} onChange={(e) => setIndustry(e.target.value)} required>
            {industries.map((i) => <option key={i.industry_type_id} value={i.name}>{i.name}</option>)}</select>}</Field>
          <Field label="Category">{(id) => <select id={id} className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">None</option>{categories.map((c) => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}</select>}</Field>
        </div>
        <Field label="Industry-specific details" hint='JSON, such as {"vintage_year": 2019, "grape_variety": "Merlot"} for a winery.'>
          {(id) => <textarea id={id} rows={5} className={`${inputCls} font-mono`} value={attrs} onChange={(e) => setAttrs(e.target.value)} spellCheck={false} />}
        </Field>
        <Alert>{err}</Alert>
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Add product"}</Button></div>
      </form>
    </Modal>
  );
}
