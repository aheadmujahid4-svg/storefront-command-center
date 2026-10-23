import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, useServerFn } from "@tanstack/react-query";
import { toast } from "sonner";
import { getOrder, listOrders, updateOrderStatus } from "@/lib/admin.functions";
import { useStoreScope } from "@/components/AppShell";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, Label, Modal, Select, Spinner } from "@/components/ui";
import { fmtDateTime, fmtMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/orders")({
  head: () => ({
    meta: [
      { title: "Master Control — Orders" },
      { name: "description", content: "Search and manage orders across connected stores." },
    ],
  }),
  component: OrdersPage,
});

const STATUS_TONE: Record<string, "warning" | "info" | "muted" | "success" | "danger"> = {
  pending: "warning",
  processing: "info",
  shipped: "muted",
  delivered: "success",
  cancelled: "danger",
  refunded: "danger",
};

type OrderRow = {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  total: string;
  currency: string;
  placed_at: string;
  customers: { name: string } | null;
  stores: { name: string; is_demo: boolean } | null;
};

function OrdersPage() {
  const { scope } = useStoreScope();
  const queryClient = useQueryClient();
  const listFn = useServerFn(listOrders);
  const getFn = useServerFn(getOrder);
  const updateFn = useServerFn(updateOrderStatus);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ patch: { status?: string; paymentStatus?: string }; label: string } | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["orders", { scope, search, status, from, to, page }],
    queryFn: () =>
      listFn({
        data: {
          storeId: scope === "all" ? undefined : scope,
          search: search || undefined,
          status,
          from: from || undefined,
          to: to ? `${to}T23:59:59Z` : undefined,
          page,
        },
      }) as Promise<{ rows: OrderRow[]; total: number; page: number; pageSize: number }>,
  });

  const { data: detail } = useQuery({
    queryKey: ["order", openId],
    queryFn: () => getFn({ data: { id: openId! } }),
    enabled: !!openId,
  });

  const updateMut = useMutation({
    mutationFn: (input: { id: string; status?: string; paymentStatus?: string }) =>
      updateFn({ data: input as any }),
    onSuccess: () => {
      toast.success("Order updated");
      setConfirm(null);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => {
      toast.error((e as Error).message);
      setConfirm(null);
    },
  });

  function requestUpdate(patch: { status?: string; paymentStatus?: string }, label: string) {
    const irreversible = patch.status === "cancelled" || patch.paymentStatus === "refunded";
    if (irreversible) setConfirm({ patch, label });
    else updateMut.mutate({ id: openId!, ...patch });
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-semibold">Orders</h1>

      <Card className="grid gap-3 p-4 sm:grid-cols-4">
        <div>
          <Label>Search order #</Label>
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="UT-1024"
          />
        </div>
        <div>
          <Label>Status</Label>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="all">All statuses</option>
            {["pending", "processing", "shipped", "delivered", "cancelled", "refunded"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>From</Label>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </div>
      </Card>

      {isLoading ? <Spinner /> : null}
      {error ? <ErrorState message={(error as Error).message} onRetry={() => refetch()} /> : null}
      {data && data.rows.length === 0 ? <EmptyState title="No orders found" hint="Try clearing filters or switching store scope." /> : null}

      {data && data.rows.length > 0 ? (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Store</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rows.map((o) => (
                <tr key={o.id} className="cursor-pointer transition-colors hover:bg-accent/40" onClick={() => setOpenId(o.id)}>
                  <td className="px-4 py-3 font-medium">{o.order_number}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {o.stores?.name} {o.stores?.is_demo ? <Badge variant="warning" className="ml-1">DEMO</Badge> : null}
                  </td>
                  <td className="px-4 py-3">{o.customers?.name ?? "—"}</td>
                  <td className="px-4 py-3"><Badge variant={STATUS_TONE[o.status] ?? "muted"}>{o.status}</Badge></td>
                  <td className="px-4 py-3"><Badge variant={o.payment_status === "paid" ? "success" : o.payment_status === "refunded" ? "danger" : "muted"}>{o.payment_status}</Badge></td>
                  <td className="tabular px-4 py-3 text-right font-medium">{fmtMoney(o.total, o.currency)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtDateTime(o.placed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {data && data.total > data.pageSize ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {data.page} of {totalPages} · {data.total} orders</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      ) : null}

      <Modal open={!!openId} onClose={() => setOpenId(null)} title={detail ? `Order ${detail.order_number}` : "Order"} wide>
        {!detail ? (
          <Spinner />
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={STATUS_TONE[detail.status] ?? "muted"}>{detail.status}</Badge>
              <Badge variant={detail.payment_status === "paid" ? "success" : detail.payment_status === "refunded" ? "danger" : "muted"}>
                payment: {detail.payment_status}
              </Badge>
              <span className="text-muted-foreground">{detail.stores?.name}</span>
              {detail.stores?.is_demo ? <Badge variant="warning">DEMO</Badge> : null}
            </div>

            <div className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Customer</div>
                <div>{detail.customers?.name ?? "—"}</div>
                <div className="text-muted-foreground">{detail.customers?.email ?? ""}</div>
                <div className="text-muted-foreground">{detail.customers?.phone ?? ""}</div>
              </div>
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Shipping</div>
                <div>{detail.shipping_address?.address ?? "—"}</div>
                <div className="text-muted-foreground">{detail.shipping_address?.city ?? ""} {detail.shipping_address?.country ?? ""}</div>
                <div className="text-muted-foreground">Payment method: {detail.payment_method ?? "—"}</div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Unit</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {detail.order_items.map((it: any) => (
                    <tr key={it.id}>
                      <td className="px-3 py-2">{it.title}</td>
                      <td className="px-3 py-2 text-muted-foreground">{it.sku ?? "—"}</td>
                      <td className="tabular px-3 py-2 text-right">{it.quantity}</td>
                      <td className="tabular px-3 py-2 text-right">{fmtMoney(it.unit_price, detail.currency)}</td>
                      <td className="tabular px-3 py-2 text-right">{fmtMoney(it.total, detail.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 text-muted-foreground" colSpan={3}>Subtotal</td>
                    <td className="tabular px-3 py-2 text-right" colSpan={2}>{fmtMoney(detail.subtotal, detail.currency)}</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-muted-foreground" colSpan={3}>Shipping</td>
                    <td className="tabular px-3 py-2 text-right" colSpan={2}>{fmtMoney(detail.shipping, detail.currency)}</td>
                  </tr>
                  <tr className="border-t border-border font-semibold">
                    <td className="px-3 py-2" colSpan={3}>Total</td>
                    <td className="tabular px-3 py-2 text-right" colSpan={2}>{fmtMoney(detail.total, detail.currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div>
              <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Update status</div>
              <div className="flex flex-wrap gap-2">
                {(["pending", "processing", "shipped", "delivered"] as const).map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={detail.status === s ? "primary" : "outline"}
                    disabled={detail.status === s || updateMut.isPending}
                    onClick={() => requestUpdate({ status: s }, `Set status to ${s}`)}
                  >
                    {s}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={detail.payment_status === "refunded" || updateMut.isPending}
                  onClick={() => requestUpdate({ paymentStatus: "refunded", status: "refunded" }, "Mark refunded")}
                >
                  Mark refunded
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={detail.status === "cancelled" || updateMut.isPending}
                  onClick={() => requestUpdate({ status: "cancelled" }, "Cancel order")}
                >
                  Cancel order
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Status updates and refunds are only applied when the store connection is verified. Refunds are marked complete only after the payment provider confirms.
              </p>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title="This action is irreversible"
        message={confirm ? `${confirm.label}. Cancellations and refunds cannot be undone from this panel. Continue?` : ""}
        confirmLabel="Yes, proceed"
        danger
        loading={updateMut.isPending}
        onConfirm={() => confirm && updateMut.mutate({ id: openId!, ...confirm.patch } as any)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
