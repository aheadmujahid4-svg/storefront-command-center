import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient, useServerFn } from "@tanstack/react-query";
import {
  BarChart3,
  Boxes,
  LayoutDashboard,
  LogOut,
  Package,
  ScrollText,
  ShoppingCart,
  Store as StoreIcon,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getStores } from "@/lib/admin.functions";
import { Badge, Button, Select, cn } from "@/components/ui";

export interface StoreDTO {
  id: string;
  name: string;
  url: string;
  platform: string;
  status: string;
  is_demo: boolean;
  created_at: string;
  connection: { connection_status: string; last_verified_at: string | null; last_synced_at: string | null; last_error: string | null } | null;
}

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/orders", label: "Orders", icon: ShoppingCart },
  { to: "/products", label: "Products", icon: Package },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/stores", label: "Stores", icon: StoreIcon },
  { to: "/audit", label: "Audit Log", icon: ScrollText },
];

const MOBILE_NAV = NAV.filter((n) => ["/", "/orders", "/products", "/inventory", "/stores"].includes(n.to));

const StoreCtx = createContext<{ stores: StoreDTO[]; scope: string; setScope: (s: string) => void }>({
  stores: [],
  scope: "all",
  setScope: () => {},
});

export function useStoreScope() {
  return useContext(StoreCtx);
}

export function AppShell({ children }: { children: ReactNode }) {
  const getStoresFn = useServerFn(getStores);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [scope, setScope] = useState("all");
  const [email, setEmail] = useState<string>("");

  const { data: stores, isLoading, error, refetch } = useQuery({
    queryKey: ["stores"],
    queryFn: () => getStoresFn() as Promise<StoreDTO[]>,
    retry: 1,
  });

  useEffect(() => {
    const saved = localStorage.getItem("mc-store-scope");
    if (saved) setScope(saved);
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  useEffect(() => {
    if (stores && scope !== "all" && !stores.some((s) => s.id === scope)) setScope("all");
  }, [stores, scope]);

  useEffect(() => {
    localStorage.setItem("mc-store-scope", scope);
  }, [scope]);

  const selected = useMemo(() => stores?.find((s) => s.id === scope) ?? null, [stores, scope]);

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    await navigate({ to: "/auth", replace: true });
  }

  const ctxValue = { stores: stores ?? [], scope, setScope };

  return (
    <StoreCtx.Provider value={ctxValue}>
      <div className="min-h-screen bg-background">
        {/* Desktop sidebar */}
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-card/60 md:flex">
          <div className="flex h-14 items-center gap-2 border-b border-border px-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground">M</div>
            <span className="font-display text-sm font-semibold tracking-wide">MASTER CONTROL</span>
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto p-3">
            {NAV.map((item) => {
              const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-border p-3">
            <div className="truncate px-3 pb-2 text-xs text-muted-foreground">{email}</div>
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </div>
        </aside>

        <div className="md:pl-60">
          {/* Header */}
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur">
            <div className="flex min-w-0 items-center gap-2">
              <span className="font-display text-sm font-bold md:hidden">MC</span>
              <Select
                className="h-9 w-48 max-w-[55vw] text-sm"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                aria-label="Store switcher"
              >
                <option value="all">All stores</option>
                {(stores ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              {selected?.is_demo ? <Badge variant="warning">DEMO DATA</Badge> : null}
              {selected && selected.connection?.connection_status !== "connected" ? <Badge variant="danger">NOT CONNECTED</Badge> : null}
            </div>
            <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Sign out" className="md:hidden">
              <LogOut className="h-4 w-4" />
            </Button>
          </header>

          <main className="mx-auto w-full max-w-6xl p-4 pb-24 md:p-6 md:pb-10">
            {error ? (
              <div className="mb-4">
                <div className="rounded-xl border border-destructive/40 bg-card p-4">
                  <div className="text-sm text-destructive">{(error as Error).message}</div>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
                    Retry
                  </Button>
                </div>
              </div>
            ) : null}
            {isLoading ? null : children}
          </main>
        </div>

        {/* Mobile bottom navigation */}
        <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-border bg-card/95 backdrop-blur md:hidden">
          {MOBILE_NAV.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </StoreCtx.Provider>
  );
}
