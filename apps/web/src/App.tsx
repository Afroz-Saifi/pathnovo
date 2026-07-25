import { FileDiff, GitCompareArrows, Activity } from "lucide-react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";

import { cn } from "./lib/utils";
import { ComparePage } from "./routes/compare";
import { PairsPage } from "./routes/pairs";
import { TracesPage } from "./routes/traces";

function NavItem({ to, icon: Icon, label }: { to: string; icon: typeof FileDiff; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
          isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
        )
      }
    >
      <Icon className="h-4 w-4" />
      {label}
    </NavLink>
  );
}

export function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <FileDiff className="h-5 w-5 text-primary" />
            Pathnovo
          </div>
          <nav className="flex items-center gap-1">
            <NavItem to="/pairs" icon={GitCompareArrows} label="Pairs" />
            <NavItem to="/traces" icon={Activity} label="Traces" />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/pairs" replace />} />
          <Route path="/pairs" element={<PairsPage />} />
          <Route path="/compare/:id" element={<ComparePage />} />
          <Route path="/traces" element={<TracesPage />} />
        </Routes>
      </main>
    </div>
  );
}
