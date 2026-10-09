import { Link } from "react-router-dom";
import { useFetch, fmtNum } from "../hooks";
import { Empty, ErrorState, Loading, PageHeader, tableWrap, thCls, tdCls } from "../ui.jsx";

export default function Dashboard() {
  const wh = useFetch("/warehouses");
  const low = useFetch("/inventory", { low_stock: 1, per_page: 1 });
  const prods = useFetch("/products", { per_page: 1 });
  const imp = useFetch("/imports", { per_page: 1 });

  if (wh.error) return <ErrorState error={wh.error} onRetry={wh.reload} />;
  if (wh.loading) return <Loading />;
  const run = imp.data?.items?.[0];

  return (
    <>
      <PageHeader title="Overview" />
      <p className="mb-6 max-w-prose text-base">
        {prods.data ? `${fmtNum(prods.data.total)} products` : "Products"} are tracked across{" "}
        {wh.data.items.length} {wh.data.items.length === 1 ? "warehouse" : "warehouses"}.
      </p>

      <h2 className="mb-2 text-lg font-bold">Warehouses</h2>
      {wh.data.items.length === 0 ? (
        <Empty title="No warehouses yet">Create one on the Warehouses page, then import or receive stock into it.</Empty>
      ) : (
        <div className={tableWrap}>
          <table className="w-full">
            <thead className="border-b border-line bg-panel">
              <tr><th className={thCls}>Name</th><th className={thCls}>Industry</th><th className={`${thCls} text-right`}>Batches</th><th className={`${thCls} text-right`}>Units in stock</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {wh.data.items.map((w) => (
                <tr key={w.warehouse_id}>
                  <td className={tdCls}><Link className="font-bold text-brand hover:underline" to={`/inventory?warehouse_id=${w.warehouse_id}`}>{w.name}</Link></td>
                  <td className={tdCls}>{w.industry}</td>
                  <td className={`${tdCls} text-right`}>{fmtNum(w.batch_count)}</td>
                  <td className={`${tdCls} text-right`}>{fmtNum(w.total_units)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-2 mt-8 text-lg font-bold">Needs attention</h2>
      <ul className="max-w-prose space-y-3 text-base">
        <li>
          {low.data ? (
            low.data.total > 0 ? (
              <Link className="font-bold text-brand hover:underline" to="/inventory?low_stock=1">
                {fmtNum(low.data.total)} stock lines are at or below their reorder level
              </Link>
            ) : "No stock lines are below their reorder level."
          ) : "Checking reorder levels…"}
        </li>
        {run && (
          <li>
            Latest import: {run.filename} into {run.warehouse} loaded {fmtNum(run.records_imported)} of{" "}
            {fmtNum(run.records_processed)} rows.{" "}
            {run.error_count > 0 && (
              <Link className="font-bold text-brand hover:underline" to="/imports">
                {fmtNum(run.error_count)} rows were rejected. Review them.
              </Link>
            )}
          </li>
        )}
      </ul>
    </>
  );
}
