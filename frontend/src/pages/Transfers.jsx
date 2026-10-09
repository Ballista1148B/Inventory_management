import { useState } from "react";
import { useFetch, fmtNum } from "../hooks";
import { Empty, ErrorState, Loading, PageHeader, Pager, tableWrap, tdCls, thCls } from "../ui.jsx";

export default function Transfers() {
  const [page, setPage] = useState(1);
  const { data, error, reload } = useFetch("/transfers", { page, per_page: 20 });
  return (
    <>
      <PageHeader title="Transfers" />
      <p className="mb-4 max-w-prose text-sm text-muted">Start a transfer from a row on the Inventory page. Every transfer is recorded here.</p>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading /> :
        data.items.length === 0 ? <Empty title="No transfers yet">Move stock between warehouses from the Inventory page.</Empty> : (
          <>
            <div className={tableWrap}>
              <table className="w-full">
                <thead className="border-b border-line bg-panel">
                  <tr><th className={thCls}>When</th><th className={thCls}>Product</th><th className={thCls}>From</th><th className={thCls}>To</th><th className={`${thCls} text-right`}>Quantity</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.items.map((t) => (
                    <tr key={t.transfer_id}>
                      <td className={tdCls}>{new Date(t.transferred_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
                      <td className={tdCls}>{t.product_name} <span className="text-muted">batch {t.batch_id}</span></td>
                      <td className={tdCls}>{t.from_warehouse}</td>
                      <td className={tdCls}>{t.to_warehouse}</td>
                      <td className={`${tdCls} text-right`}>{fmtNum(t.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} perPage={20} total={data.total} onPage={setPage} />
          </>
        )}
    </>
  );
}
