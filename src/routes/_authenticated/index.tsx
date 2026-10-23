import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useServerFn } from "@tanstack/react-query";
import { getDashboard } from "@/lib/admin.functions";
import { useStoreScope, type StoreDTO } from "@/components/AppShell";
import { Badge, Card, EmptyState, ErrorState, Spinner, StatCard, cn } from "@/components/ui";
import { fmtMoney, fmtRelative, num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Master Control — Dashboard" },
      { name: "description", content: "Multi-store overview: stores, orders, revenue and low-stock alerts." },
    ],
  }),
  component: Dashboard,
});

const STATUS_TONE: Record<string, "warning" | "info" | "muted" | "success" | "danger"> = {
  pending: "warning",
  processing: "info",
  shipped: "muted",
  delivered: "success",
  cancelled: "danger",
};

function Dashboard() {
  const { scope } = useStoreScope();
  const getDashFn = useServerFn(getDashboard);
  const [revRange, setRevRange] = useState<7 | 30 | 90>(30);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard", scope],
    queryFn: () => getDashFn({ data: { storeId: scope === "all" ? undefined : scope } }),
  });

  if (isLoading) return <Spinner label="Loading dashboard…" />;
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  const d = data!;

  const connected = (d.stores as StoreDTO[]).filter((s) => s.connection?.connection_status === "connected").length;
  const anyDemo = (d.stores as StoreDTO[]).some((s) => s.is_demo);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-semibold">Dashboard</h1>
        {anyDemo ? <Badge variant="warning">DEMO DATA SHOWN</Badge> : null}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Stores connected" value={`${connected}/${(d.stores as StoreDTO[]).length}`} hint={(d.stores as StoreDTO[]).length ? "verified connections" : "no stores yet"} />
        <StatCard label="Products" value={d.productsTotal} />
        <StatCard label="Pending orders" value={d.orderCounts.pending} tone="warning" />
        <StatCard
          label={`Revenue (${revRange}d)`}
          value={fmtMoney(d.revenue[`d${revRange}` as "d7"])}
          hint="paid orders only"
          tone="primary"
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Revenue range:</span>
        {([7, 30, 90] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRevRange(r)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              revRange === r ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-accent",
            )}
          >
            {r}d
          </button>
        ))}
      </div>

      <Card className="p-4">
        <h2 className="font-display mb-3 text-sm font-semibold">Orders by status</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(["pending", "processing", "shipped", "delivered", "cancelled"] as const).map((st) => (
            <div key={st} className="rounded-lg bg-muted/50 p-3">
              <div className="text-xs capitalize text-muted-foreground">{st}</div>
              <div className="font-display tabular mt-1 text-lg font-semibold">{d.orderCounts[st]}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold">Recent orders</h2>
            <Link to="/orders" className="text-xs text-primary hover:underline">
              View all
            </Link>
          </div>
          {d.recentOrders.length === 0 ? (
            <EmptyState title="No orders yet" hint="Orders will appear here once stores sync." />
          ) : (
            <ul className="divide-y divide-border">
              {d.recentOrders.map((o: any) => (
                <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {o.order_number}
                      <span className="ml-2 text-xs text-muted-foreground">{o.stores?.name}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {o.customers?.name ?? "—"} · {fmtRelative(o.placed_at)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={STATUS_TONE[o.status] ?? "muted"}>{o.status}</Badge>
                    <span className="tabular text-sm font-medium">{fmtMoney(o.total, o.currency)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold">Low-stock alerts</h2>
            <Link to="/inventory" className="text-xs text-primary hover:underline">
              Manage inventory
            </Link>
          </div>
          {d.lowStock.length === 0 ? (
            <EmptyState title="No low-stock items" hint="Items at or below their threshold will be listed here." />
          ) : (
            <ul className="divide-y divide-border">
              {d.lowStock.map((i: any) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{i.title}</div>
                    <div className="text-xs text-muted-foreground">{i.sku}</div>
                  </div>
                  <Badge variant={num(i.stock) === 0 ? "danger" : "warning"}>
                    {i.stock} left · min {i.threshold}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Link to="/stores" className="rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/40">
          <div className="font-display text-sm font-semibold">Connect a store</div>
          <div className="mt-1 text-xs text-muted-foreground">Add a real store connection or manage existing ones.</div>
        </Link>
        <Link to="/analytics" className="rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/40">
          <div className="font-display text-sm font-semibold">Analytics</div>
          <div className="mt-1 text-xs text-muted-foreground">Sales, order value and best sellers from verified records.</div>
        </Link>
        <Link to="/audit" className="rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/40">
          <div className="font-display text-sm font-semibold">Audit log</div>
          <div className="mt-1 text-xs text-muted-foreground">Every admin action, timestamped.</div>
        </Link>
      </div>
    </div>
  );
}
