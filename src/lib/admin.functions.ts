import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Master Control server functions.
 * Every function requires an authenticated session AND the admin role,
 * checked server-side on each call (route guards protect UI only).
 */

type Ctx = { supabase: any; userId: string };

async function assertAdmin(ctx: Ctx) {
  const { data, error } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (error || !data) throw new Error("Forbidden: admin access required");
}

async function writeAudit(
  ctx: Ctx,
  action: string,
  opts: { entity?: string; entityId?: string; storeId?: string | null; success?: boolean; details?: Record<string, unknown> } = {},
) {
  await ctx.supabase.from("audit_logs").insert({
    admin_id: ctx.userId,
    action,
    entity: opts.entity ?? null,
    entity_id: opts.entityId ?? null,
    store_id: opts.storeId ?? null,
    success: opts.success ?? true,
    details: opts.details ?? {},
  });
}

/* ================= Access ================= */

export const getMyAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
    return { isAdmin: !!data };
  });

/** Bootstrap: the very first signed-in account can claim owner-admin while no admin exists. */
export const bootstrapClaimAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const { data } = await ctx.supabase.rpc("claim_admin_ownership");
    return { claimed: !!data };
  });

/* ================= Stores ================= */

export const getStores = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { data, error } = await ctx.supabase
      .from("stores")
      .select("id, name, url, platform, status, is_demo, created_at, store_connections(connection_status, last_verified_at, last_synced_at, last_error)")
      .order("created_at");
    if (error) throw new Error(error.message);
    return (data ?? []).map((s: any) => ({ ...s, connection: s.store_connections?.[0] ?? null, store_connections: undefined }));
  });

export const saveStore = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { id?: string; name: string; url: string; platform: string; status?: string; externalId?: string }) => d,
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const isDemo = data.platform === "demo";
    const row = {
      name: data.name,
      url: data.url,
      platform: data.platform,
      status: data.status ?? "active",
      external_id: data.externalId ?? null,
      is_demo: isDemo,
    };
    if (data.id) {
      const { error } = await ctx.supabase.from("stores").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      await writeAudit(ctx, "store.update", { entity: "store", entityId: data.id, storeId: data.id, details: { name: data.name } });
      return { id: data.id };
    }
    const { data: created, error } = await ctx.supabase.from("stores").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    await ctx.supabase.from("store_connections").insert({ store_id: created.id, connection_status: "unverified" });
    await writeAudit(ctx, "store.create", { entity: "store", entityId: created.id, storeId: created.id, details: { name: data.name, platform: data.platform } });
    return { id: created.id as string };
  });

export const setStoreStatus = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; status: "active" | "disabled" }) => d)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { error } = await ctx.supabase.from("stores").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAudit(ctx, `store.${data.status === "disabled" ? "disable" : "enable"}`, { entity: "store", entityId: data.id, storeId: data.id });
    return { ok: true };
  });

export const deleteStore = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; name?: string }) => d)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { error } = await ctx.supabase.from("stores").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAudit(ctx, "store.delete", { entity: "store", entityId: data.id, details: { name: data.name ?? null } });
    return { ok: true };
  });

/** Store API credentials — stored server-side only, never returned to the client. */
export const saveStoreSecrets = createServerFn({ method: "POST" })
  .inputValidator((d: { storeId: string; apiToken: string; apiSecret?: string }) => d)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("store_connection_secrets").upsert(
      {
        store_id: data.storeId,
        api_token: data.apiToken,
        api_secret: data.apiSecret || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_id" },
    );
    if (error) throw new Error(error.message);
    await writeAudit(ctx, "store.save_credentials", { entity: "store", entityId: data.storeId, storeId: data.storeId });
    return { ok: true };
  });

export const verifyStoreConnection = createServerFn({ method: "POST" })
  .inputValidator((d: { storeId: string }) => d)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: store } = await supabaseAdmin.from("stores").select("id, name, url, platform, status").eq("id", data.storeId).single();
    if (!store) throw new Error("Store not found");
    const { data: secrets } = await supabaseAdmin.from("store_connection_secrets").select("api_token, api_secret").eq("store_id", data.storeId).maybeSingle();
    const { verifyConnection } = await import("./adapters.server");
    const result = await verifyConnection(store, secrets);
    const now = new Date().toISOString();
    await ctx.supabase
      .from("store_connections")
      .update({
        connection_status: result.ok ? "connected" : "error",
        ...(result.ok ? { last_verified_at: now } : {}),
        last_error: result.error ?? null,
      })
      .eq("store_id", data.storeId);
    await writeAudit(ctx, "store.verify_connection", {
      entity: "store",
      entityId: data.storeId,
      storeId: data.storeId,
      success: result.ok,
      details: { error: result.error ?? null },
    });
    if (!result.ok) throw new Error(result.error ?? "Connection verification failed");
    return { ok: true, note: result.note ?? null };
  });

export const syncStoreData = createServerFn({ method: "POST" })
  .inputValidator((d: { storeId: string }) => d)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: store } = await supabaseAdmin.from("stores").select("id, name, url, platform, status").eq("id", data.storeId).single();
    if (!store) throw new Error("Store not found");
    const { syncStore } = await import("./adapters.server");
    const result = await syncStore(store);
    if (!result.ok) {
      await writeAudit(ctx, "store.sync", { entity: "store", entityId: data.storeId, storeId: data.storeId, success: false, details: { error: result.error } });
      throw new Error(result.error ?? "Sync failed");
    }
    await ctx.supabase.from("store_connections").update({ last_synced_at: new Date().toISOString() }).eq("store_id", data.storeId);
    await writeAudit(ctx, "store.sync", { entity: "store", entityId: data.storeId, storeId: data.storeId, success: true });
    return { ok: true };
  });

/* ================= Dashboard ================= */

export const getDashboard = createServerFn({ method: "POST" })
  .inputValidator((d: { storeId?: string }) => d ?? {})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const storeId = data?.storeId || null;

    let storesQ = ctx.supabase
      .from("stores")
      .select("id, name, platform, status, is_demo, store_connections(connection_status, last_synced_at, last_error)");
    if (storeId) storesQ = storesQ.eq("id", storeId);
    const { data: stores, error: storesErr } = await storesQ.order("created_at");
    if (storesErr) throw new Error(storesErr.message);

    const productsCountQ = ctx.supabase.from("products").select("id", { count: "exact", head: true });
    const { count: productsTotal } = storeId ? await productsCountQ.eq("store_id", storeId) : await productsCountQ;

    const statusCounts: Record<string, number> = { pending: 0, processing: 0, shipped: 0, delivered: 0, cancelled: 0 };
    for (const st of Object.keys(statusCounts)) {
      let q = ctx.supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", st);
      if (storeId) q = q.eq("store_id", storeId);
      const { count } = await q;
      statusCounts[st] = count ?? 0;
    }

    // Revenue from actual paid, non-refunded orders in the last 90 days
    const since90 = new Date(Date.now() - 90 * 86400000).toISOString();
    let revQ = ctx.supabase.from("orders").select("total, currency, placed_at").eq("payment_status", "paid").gte("placed_at", since90);
    if (storeId) revQ = revQ.eq("store_id", storeId);
    const { data: paidOrders } = await revQ;
    const sum = (days: number) =>
      (paidOrders ?? [])
        .filter((o: any) => new Date(o.placed_at).getTime() >= Date.now() - days * 86400000)
        .reduce((acc: number, o: any) => acc + Number(o.total), 0);
    const revenue = { d7: sum(7), d30: sum(30), d90: sum(90) };

    let recentQ = ctx.supabase
      .from("orders")
      .select("id, order_number, status, payment_status, total, currency, placed_at, store_id, customers(name), stores(name, is_demo)")
      .order("placed_at", { ascending: false })
      .limit(8);
    if (storeId) recentQ = recentQ.eq("store_id", storeId);
    const { data: recentOrders } = await recentQ;

    let invQ = ctx.supabase
      .from("inventory")
      .select("id, sku, stock, low_stock_threshold, store_id, products(title)")
      .order("stock", { ascending: true })
      .limit(50);
    if (storeId) invQ = invQ.eq("store_id", storeId);
    const { data: invRows } = await invQ;
    const lowStock = (invRows ?? [])
      .filter((r: any) => r.stock <= r.low_stock_threshold)
      .slice(0, 10)
      .map((r: any) => ({ id: r.id, sku: r.sku, title: r.products?.title ?? r.sku, stock: r.stock, threshold: r.low_stock_threshold, store_id: r.store_id }));

    return {
      stores: stores ?? [],
      productsTotal: productsTotal ?? 0,
      orderCounts: statusCounts,
      revenue,
      recentOrders: recentOrders ?? [],
      lowStock,
    };
  });

/* ================= Products ================= */

export const listProducts = createServerFn({ method: "POST" })
  .inputValidator((d: { storeId?: string; search?: string; status?: string; page?: number; pageSize?: number }) => d ?? {})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const page = Math.max(1, data?.page ?? 1);
    const pageSize = Math.min(50, Math.max(5, data?.pageSize ?? 10));
    let q = ctx.supabase.from("products").select("id, store_id, sku, title, price, sale_price, stock, category, status, sync_status, sync_error, updated_at", { count: "exact" });
    if (data?.storeId) q = q.eq("store_id", data.storeId);
    if (data?.status && data.status !== "all") q = q.eq("status", data.status);
    if (data?.search) q = q.or(`title.ilike.%${data.search}%,sku.ilike.%${data.search}%`);
    const { data: rows, error, count } = await q
      .order("updated_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0, page, pageSize };
  });

export const saveProduct = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      id?: string;
      storeId: string;
      sku: string;
      title: string;
      description?: string;
      category?: string;
      price: number;
      salePrice?: number | null;
      stock: number;
      status: "draft" | "active" | "archived";
      images?: string[];
    }) => d,
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    if (!data.sku.trim() || !data.title.trim()) throw new Error("SKU and title are required");
    if (data.price < 0 || data.stock < 0) throw new Error("Price and stock cannot be negative");

    // The store must be connected for changes to sync
    const { data: store } = await ctx.supabase.from("stores").select("id, platform, is_demo, store_connections(connection_status)").eq("id", data.storeId).single();
    if (!store) throw new Error("Store not found");

    const row = {
      store_id: data.storeId,
      sku: data.sku.trim(),
      title: data.title.trim(),
      description: data.description ?? null,
      category: data.category ?? null,
      price: data.price,
      sale_price: data.salePrice ?? null,
      stock: data.stock,
      status: data.status,
      images: data.images?.length ? data.images : [],
      sync_status: store.is_demo ? "synced" : "pending",
      last_synced_at: store.is_demo ? new Date().toISOString() : null,
    };

    let productId = data.id;
    if (data.id) {
      const { error } = await ctx.supabase.from("products").update(row).eq("id", data.id).eq("store_id", data.storeId);
      if (error) throw new Error(error.message);
    } else {
      const { data: created, error } = await ctx.supabase.from("products").insert(row).select("id").single();
      if (error) {
        if (error.code === "23505") throw new Error(`SKU "${data.sku}" already exists in this store`);
        throw new Error(error.message);
      }
      productId = created.id;
    }

    // Keep inventory in step for this store + SKU only
    const { data: inv } = await ctx.supabase.from("inventory").select("id").eq("store_id", data.storeId).eq("sku", row.sku).maybeSingle();
    if (inv) {
      await ctx.supabase.from("inventory").update({ stock: data.stock, product_id: productId, updated_at: new Date().toISOString() }).eq("id", inv.id);
    } else {
      await ctx.supabase.from("inventory").insert({ store_id: data.storeId, product_id: productId, sku: row.sku, stock: data.stock, low_stock_threshold: 5 });
    }

    await writeAudit(ctx, data.id ? "product.update" : "product.create", {
      entity: "product",
      entityId: productId,
      storeId: data.storeId,
      details: { sku: row.sku, title: row.title },
    });
    return { id: productId };
  });

export const archiveProduct = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; storeId: string }) => d)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { error } = await ctx.supabase.from("products").update({ status: "archived" }).eq("id", data.id).eq("store_id", data.storeId);
    if (error) throw new Error(error.message);
    await writeAudit(ctx, "product.archive", { entity: "product", entityId: data.id, storeId: data.storeId });
    return { ok: true };
  });

/* ============ Bulk price/stock updates (preview → confirm → apply) ============ */

export const bulkUpdatePreview = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      storeId: string;
      productIds: string[];
      priceMode: "none" | "set" | "increase" | "decrease";
      priceValue: number;
      priceIsPercent: boolean;
      stockMode: "none" | "set" | "increase" | "decrease";
      stockValue: number;
    }) => d,
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    if (!data.productIds.length || data.productIds.length > 200) throw new Error("Select between 1 and 200 products");
    const { data: rows } = await ctx.supabase
      .from("products")
      .select("id, sku, title, price, stock")
      .eq("store_id", data.storeId)
      .in("id", data.productIds);
    const changes = (rows ?? []).map((p: any) => {
      let newPrice = Number(p.price);
      if (data.priceMode !== "none") {
        const v = Number(data.priceValue);
        newPrice = data.priceMode === "set" ? v : data.priceMode === "increase" ? newPrice + (data.priceIsPercent ? newPrice * (v / 100) : v) : newPrice - (data.priceIsPercent ? newPrice * (v / 100) : v);
      }
      let newStock = Number(p.stock);
      if (data.stockMode !== "none") {
        const v = Number(data.stockValue);
        newStock = data.stockMode === "set" ? v : data.stockMode === "increase" ? newStock + v : newStock - v;
      }
      return {
        id: p.id,
        sku: p.sku,
        title: p.title,
        oldPrice: Number(p.price),
        newPrice: Math.max(0, Math.round(newPrice * 100) / 100),
        oldStock: Number(p.stock),
        newStock: Math.max(0, Math.round(newStock)),
      };
    });
    const skipped = data.productIds.length - changes.length;
    return { changes, skipped };
  });

export const bulkUpdateApply = createServerFn({ method: "POST" })
  .inputValidator((d: { storeId: string; changes: { id: string; newPrice: number; newStock: number }[] }) => d)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    if (!data.changes.length || data.changes.length > 200) throw new Error("Nothing to apply");
    const { data: store } = await ctx.supabase.from("stores").select("id, is_demo").eq("id", data.storeId).single();
    if (!store) throw new Error("Store not found");

    let applied = 0;
    const failed: { sku?: string; error: string }[] = [];
    for (const c of data.changes) {
      const { error } = await ctx.supabase
        .from("products")
        .update({
          price: c.newPrice,
          stock: c.newStock,
          sync_status: store.is_demo ? "synced" : "pending",
        })
        .eq("id", c.id)
        .eq("store_id", data.storeId);
      if (error) {
        failed.push({ error: error.message });
        continue;
      }
      const { data: inv } = await ctx.supabase.from("inventory").select("id").eq("store_id", data.storeId).eq("product_id", c.id).maybeSingle();
      if (inv) await ctx.supabase.from("inventory").update({ stock: c.newStock, updated_at: new Date().toISOString() }).eq("id", inv.id);
      applied += 1;
    }
    await writeAudit(ctx, "product.bulk_update", {
      entity: "product",
      storeId: data.storeId,
      success: failed.length === 0,
      details: { applied, failed: failed.length },
    });
    return { applied, failed };
  });

/* ================= Orders ================= */

export const listOrders = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { storeId?: string; status?: string; search?: string; from?: string; to?: string; page?: number; pageSize?: number }) => d ?? {},
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const page = Math.max(1, data?.page ?? 1);
    const pageSize = Math.min(50, Math.max(5, data?.pageSize ?? 10));
    let q = ctx.supabase
      .from("orders")
      .select("id, order_number, status, payment_status, total, currency, placed_at, store_id, customers(name), stores(name, is_demo)", { count: "exact" });
    if (data?.storeId) q = q.eq("store_id", data.storeId);
    if (data?.status && data.status !== "all") q = q.eq("status", data.status);
    if (data?.from) q = q.gte("placed_at", data.from);
    if (data?.to) q = q.lte("placed_at", data.to);
    if (data?.search) q = q.ilike("order_number", `%${data.search}%`);
    const { data: rows, error, count } = await q
      .order("placed_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0, page, pageSize };
  });

export const getOrder = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => d)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { data: order, error } = await ctx.supabase
      .from("orders")
      .select("*, customers(name, email, phone), stores(id, name, is_demo, platform, store_connections(connection_status)), order_items(id, title, sku, quantity, unit_price, total)")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return order;
  });

export const updateOrderStatus = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { id: string; status?: "pending" | "processing" | "shipped" | "delivered" | "cancelled" | "refunded"; paymentStatus?: "unpaid" | "pending" | "paid" | "refunded" | "failed" }) => d,
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { data: order } = await ctx.supabase
      .from("orders")
      .select("id, order_number, store_id, status, payment_status, stores(id, name, platform, is_demo, store_connections(connection_status))")
      .eq("id", data.id)
      .single();
    if (!order) throw new Error("Order not found");
    const conn = order.stores?.store_connections?.[0]?.connection_status;
    if (order.stores?.status === undefined) {
      // store fields flattened? guard not needed — supabase returns nested
    }
    if (conn !== "connected") throw new Error("The store connection is not verified — status updates are blocked until the connection is verified.");

    const isDemo = !!order.stores?.is_demo;
    if (data.paymentStatus === "refunded" && order.payment_status !== "refunded" && !isDemo) {
      throw new Error("Refunds must be confirmed by the payment provider before they can be marked refunded. Process the refund in the provider dashboard first.");
    }
    if (data.status && !isDemo) {
      throw new Error("This store's API does not support fulfillment updates yet. The store integration must be verified first.");
    }

    const patch: Record<string, string> = {};
    if (data.status) patch.status = data.status;
    if (data.paymentStatus) patch.payment_status = data.paymentStatus;
    const { error } = await ctx.supabase.from("orders").update(patch).eq("id", data.id).eq("store_id", order.store_id);
    if (error) throw new Error(error.message);
    await writeAudit(ctx, "order.update_status", {
      entity: "order",
      entityId: data.id,
      storeId: order.store_id,
      details: { order_number: order.order_number, ...patch },
    });
    return { ok: true };
  });

/* ================= Customers ================= */

export const listCustomers = createServerFn({ method: "POST" })
  .inputValidator((d: { storeId?: string; search?: string; page?: number; pageSize?: number }) => d ?? {})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const page = Math.max(1, data?.page ?? 1);
    const pageSize = Math.min(50, Math.max(5, data?.pageSize ?? 10));
    let q = ctx.supabase.from("customers").select("id, store_id, name, email, phone, created_at, stores(name, is_demo)", { count: "exact" });
    if (data?.storeId) q = q.eq("store_id", data.storeId);
    if (data?.search) q = q.or(`name.ilike.%${data.search}%,email.ilike.%${data.search}%,phone.ilike.%${data.search}%`);
    const { data: rows, error, count } = await q
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0, page, pageSize };
  });

/* ================= Inventory ================= */

export const listInventory = createServerFn({ method: "POST" })
  .inputValidator((d: { storeId?: string; search?: string; lowOnly?: boolean }) => d ?? {})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    let q = ctx.supabase
      .from("inventory")
      .select("id, store_id, sku, stock, low_stock_threshold, updated_at, products(id, title, status)")
      .order("stock", { ascending: true })
      .limit(300);
    if (data?.storeId) q = q.eq("store_id", data.storeId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    let out = rows ?? [];
    if (data?.search) {
      const s = data.search.toLowerCase();
      out = out.filter((r: any) => r.sku.toLowerCase().includes(s) || (r.products?.title ?? "").toLowerCase().includes(s));
    }
    if (data?.lowOnly) out = out.filter((r: any) => r.stock <= r.low_stock_threshold);
    return out.slice(0, 100);
  });

export const updateInventory = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; storeId: string; stock: number; lowStockThreshold?: number }) => d)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    if (data.stock < 0) throw new Error("Stock cannot be negative");
    const { data: inv } = await ctx.supabase
      .from("inventory")
      .select("id, sku, product_id")
      .eq("id", data.id)
      .eq("store_id", data.storeId)
      .single();
    if (!inv) throw new Error("Inventory record not found in this store");
    const patch: Record<string, unknown> = { stock: data.stock, updated_at: new Date().toISOString() };
    if (typeof data.lowStockThreshold === "number") patch.low_stock_threshold = Math.max(0, data.lowStockThreshold);
    const { error } = await ctx.supabase.from("inventory").update(patch).eq("id", data.id).eq("store_id", data.storeId);
    if (error) throw new Error(error.message);
    if (inv.product_id) {
      await ctx.supabase.from("products").update({ stock: data.stock }).eq("id", inv.product_id).eq("store_id", data.storeId);
    }
    await writeAudit(ctx, "inventory.update", {
      entity: "inventory",
      entityId: data.id,
      storeId: data.storeId,
      details: { sku: inv.sku, stock: data.stock },
    });
    return { ok: true };
  });

/* ================= Analytics ================= */

export const getAnalytics = createServerFn({ method: "POST" })
  .inputValidator((d: { storeId?: string; days: number }) => d)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const days = Math.min(365, Math.max(1, data.days));
    const since = new Date(Date.now() - days * 86400000).toISOString();
    let q = ctx.supabase
      .from("orders")
      .select("id, total, payment_status, status, currency, placed_at, store_id")
      .gte("placed_at", since);
    if (data.storeId) q = q.eq("store_id", data.storeId);
    const { data: orders, error } = await q;
    if (error) throw new Error(error.message);
    const valid = (orders ?? []).filter((o: any) => o.status !== "cancelled" && o.status !== "refunded");
    const paid = valid.filter((o: any) => o.payment_status === "paid");
    const revenue = paid.reduce((a: number, o: any) => a + Number(o.total), 0);
    const orderCount = valid.length;
    const aov = paid.length ? revenue / paid.length : 0;

    const byDay = new Map<string, number>();
    for (const o of paid) {
      const day = new Date(o.placed_at).toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + Number(o.total));
    }

    // Best sellers from actual line items of paid orders
    const orderIds = paid.map((o: any) => o.id);
    let bestSellers: { title: string; sku: string | null; qty: number; revenue: number }[] = [];
    if (orderIds.length) {
      const { data: items } = await ctx.supabase.from("order_items").select("title, sku, quantity, total, order_id").in("order_id", orderIds);
      const agg = new Map<string, { title: string; sku: string | null; qty: number; revenue: number }>();
      for (const it of items ?? []) {
        const key = it.sku ?? it.title;
        const cur = agg.get(key) ?? { title: it.title, sku: it.sku, qty: 0, revenue: 0 };
        cur.qty += it.quantity;
        cur.revenue += Number(it.total);
        agg.set(key, cur);
      }
      bestSellers = [...agg.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
    }

    return {
      days,
      revenue,
      orderCount,
      aov,
      paidCount: paid.length,
      daily: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, total]) => ({ date, total })),
      bestSellers,
    };
  });

/* ================= Audit log ================= */

export const listAudit = createServerFn({ method: "POST" })
  .inputValidator((d: { storeId?: string; page?: number }) => d ?? {})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const page = Math.max(1, data?.page ?? 1);
    const pageSize = 20;
    let q = ctx.supabase
      .from("audit_logs")
      .select("id, action, entity, entity_id, store_id, details, success, created_at, stores(name)", { count: "exact" });
    if (data?.storeId) q = q.eq("store_id", data.storeId);
    const { data: rows, error, count } = await q
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0, page, pageSize };
  });
