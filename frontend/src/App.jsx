import { NavLink, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard.jsx";
import Inventory from "./pages/Inventory.jsx";
import Products from "./pages/Products.jsx";
import ProductDetail from "./pages/ProductDetail.jsx";
import Transfers from "./pages/Transfers.jsx";
import Warehouses from "./pages/Warehouses.jsx";
import Imports from "./pages/Imports.jsx";
import { Empty } from "./ui.jsx";

const nav = [
  ["/", "Overview", true],
  ["/inventory", "Inventory"],
  ["/products", "Products"],
  ["/transfers", "Transfers"],
  ["/warehouses", "Warehouses"],
  ["/imports", "Import reports"],
];

export default function App() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="bg-ink text-white md:w-56 md:shrink-0">
        <div className="px-5 py-4 text-lg font-bold md:py-6">Warehouse manager</div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
          {nav.map(([to, label, end]) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                "whitespace-nowrap rounded px-3 py-2 text-sm font-bold " +
                (isActive ? "bg-white text-ink" : "text-white/80 hover:bg-white/10 hover:text-white")}>
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-8">
        <div className="mx-auto max-w-6xl">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/products" element={<Products />} />
            <Route path="/products/:id" element={<ProductDetail />} />
            <Route path="/transfers" element={<Transfers />} />
            <Route path="/warehouses" element={<Warehouses />} />
            <Route path="/imports" element={<Imports />} />
            <Route path="*" element={<Empty title="Page not found">Use the menu to get back to a working page.</Empty>} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
