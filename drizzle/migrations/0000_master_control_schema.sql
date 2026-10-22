-- ============= Master Control schema =============

create type public.app_role as enum ('admin', 'user');

-- Roles: never stored on profiles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

-- has_role security definer (table now exists)
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;

create policy "users read own roles" on public.user_roles for select to authenticated using (auth.uid() = user_id);
create policy "admins read all roles" on public.user_roles for select to authenticated using (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Profiles: user-facing identity fields
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "users read own profile" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "users update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Authorized admins allowlist
create table public.authorized_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null unique,
  granted_by uuid,
  created_at timestamptz not null default now()
);
grant select on public.authorized_admins to authenticated;
grant all on public.authorized_admins to service_role;
alter table public.authorized_admins enable row level security;
create policy "admins read allowlist" on public.authorized_admins for select to authenticated using (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Audit log (created early: claim_admin_ownership writes here)
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null,
  store_id uuid,
  action text not null,
  entity text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  success boolean not null default true,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
grant select, insert on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;
alter table public.audit_logs enable row level security;
create policy "admins read audit log" on public.audit_logs for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));
create policy "admins insert own audit" on public.audit_logs for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'::public.app_role) and admin_id = auth.uid());

-- Bootstrap: first signed-in account may claim owner-admin while no admin exists
create or replace function public.claim_admin_ownership()
returns boolean language plpgsql security definer set search_path = public as $$
declare
  has_admin boolean;
  uid uuid := auth.uid();
begin
  if uid is null then return false; end if;
  select exists(select 1 from public.user_roles where role = 'admin') into has_admin;
  if has_admin then return false; end if;
  insert into public.user_roles (user_id, role) values (uid, 'admin');
  insert into public.authorized_admins (user_id, granted_by) values (uid, uid) on conflict (user_id) do nothing;
  insert into public.audit_logs (admin_id, action, entity, success)
    values (uid, 'bootstrap.claim_admin_ownership', 'user:' || uid::text, true);
  return true;
end $$;
grant execute on function public.claim_admin_ownership() to authenticated;

-- Profile creation trigger on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Stores
create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  platform text not null check (platform in ('shopify','woocommerce','custom','demo')),
  external_id text,
  status text not null default 'active' check (status in ('active','disabled')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Store connections (status metadata; secrets live in a separate locked table)
create table public.store_connections (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade unique,
  connection_status text not null default 'unverified' check (connection_status in ('unverified','verifying','connected','error')),
  last_verified_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Store connection secrets: NO grants to anon/authenticated — service-role server code only
create table public.store_connection_secrets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade unique,
  api_token text not null,
  api_secret text,
  extra jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
grant all on public.store_connection_secrets to service_role;
alter table public.store_connection_secrets enable row level security;

-- Customers (per store)
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  external_id text,
  name text not null,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index customers_store_external_id_key on public.customers (store_id, external_id) where external_id is not null;
create index customers_store_idx on public.customers (store_id);

-- Products (per store)
create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  external_id text,
  sku text not null,
  title text not null,
  description text,
  images jsonb not null default '[]'::jsonb,
  price numeric(12,2) not null check (price >= 0),
  sale_price numeric(12,2) check (sale_price is null or sale_price >= 0),
  stock integer not null default 0 check (stock >= 0),
  category text,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  sync_status text not null default 'synced' check (sync_status in ('synced','pending','error')),
  sync_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index products_store_sku_key on public.products (store_id, sku);
create index products_store_idx on public.products (store_id);
create index products_status_idx on public.products (status);

-- Orders (per store)
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  external_id text,
  order_number text not null,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','processing','shipped','delivered','cancelled','refunded')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','pending','paid','refunded','failed')),
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  shipping numeric(12,2) not null default 0 check (shipping >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  currency text not null default 'PKR',
  shipping_address jsonb not null default '{}'::jsonb,
  payment_method text,
  placed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index orders_store_external_id_key on public.orders (store_id, external_id) where external_id is not null;
create index orders_store_placed_idx on public.orders (store_id, placed_at desc);
create index orders_status_idx on public.orders (status);

-- Order line items
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  title text not null,
  sku text,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  total numeric(12,2) not null check (total >= 0)
);
create index order_items_order_idx on public.order_items (order_id);

-- Inventory (per store + SKU)
create table public.inventory (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  sku text not null,
  stock integer not null default 0 check (stock >= 0),
  low_stock_threshold integer not null default 5,
  updated_at timestamptz not null default now()
);
create unique index inventory_store_sku_key on public.inventory (store_id, sku);
create index inventory_store_idx on public.inventory (store_id);

-- Grants for admin-scoped tables
grant select, insert, update, delete on public.stores to authenticated;
grant all on public.stores to service_role;
grant select, insert, update, delete on public.store_connections to authenticated;
grant all on public.store_connections to service_role;
grant select, insert, update, delete on public.customers to authenticated;
grant all on public.customers to service_role;
grant select, insert, update, delete on public.products to authenticated;
grant all on public.products to service_role;
grant select, insert, update, delete on public.orders to authenticated;
grant all on public.orders to service_role;
grant select, insert, update, delete on public.order_items to authenticated;
grant all on public.order_items to service_role;
grant select, insert, update, delete on public.inventory to authenticated;
grant all on public.inventory to service_role;

-- RLS: everything admin-scoped
alter table public.stores enable row level security;
alter table public.store_connections enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.inventory enable row level security;

create policy "admins manage stores" on public.stores for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role)) with check (public.has_role(auth.uid(), 'admin'::public.app_role));
create policy "admins manage connections" on public.store_connections for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role)) with check (public.has_role(auth.uid(), 'admin'::public.app_role));
create policy "admins manage customers" on public.customers for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role)) with check (public.has_role(auth.uid(), 'admin'::public.app_role));
create policy "admins manage products" on public.products for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role)) with check (public.has_role(auth.uid(), 'admin'::public.app_role));
create policy "admins manage orders" on public.orders for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role)) with check (public.has_role(auth.uid(), 'admin'::public.app_role));
create policy "admins manage order items" on public.order_items for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role)) with check (public.has_role(auth.uid(), 'admin'::public.app_role));
create policy "admins manage inventory" on public.inventory for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role)) with check (public.has_role(auth.uid(), 'admin'::public.app_role));

-- updated_at maintenance
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger trg_stores_updated before update on public.stores for each row execute function public.set_updated_at();
create trigger trg_connections_updated before update on public.store_connections for each row execute function public.set_updated_at();
create trigger trg_customers_updated before update on public.customers for each row execute function public.set_updated_at();
create trigger trg_products_updated before update on public.products for each row execute function public.set_updated_at();
create trigger trg_orders_updated before update on public.orders for each row execute function public.set_updated_at();
create trigger trg_inventory_updated before update on public.inventory for each row execute function public.set_updated_at();

-- ============= DEMO DATA (clearly labeled DEMO) =============
insert into public.stores (id, name, url, platform, status, is_demo) values
  ('d1000000-0000-4000-8000-000000000001', '[DEMO] Urban Threads', 'https://urbanthreads.example.com', 'demo', 'active', true),
  ('d1000000-0000-4000-8000-000000000002', '[DEMO] Gadget Bazaar', 'https://gadgetbazaar.example.com', 'demo', 'active', true);

insert into public.store_connections (store_id, connection_status, last_verified_at, last_synced_at) values
  ('d1000000-0000-4000-8000-000000000001', 'connected', now(), now()),
  ('d1000000-0000-4000-8000-000000000002', 'connected', now(), now());

insert into public.products (store_id, sku, title, description, category, price, sale_price, stock, status, sync_status, last_synced_at) values
  ('d1000000-0000-4000-8000-000000000001','UT-TS-001','Classic Cotton Tee — Black','Premium combed cotton tee','T-Shirts',1450.00,1290.00,42,'active','synced',now()),
  ('d1000000-0000-4000-8000-000000000001','UT-HD-002','Fleece Hoodie — Charcoal','Heavyweight fleece hoodie','Hoodies',3890.00,null,8,'active','synced',now()),
  ('d1000000-0000-4000-8000-000000000001','UT-CAP-003','Embroidered Cap — Navy','Adjustable embroidered cap','Accessories',990.00,null,120,'active','synced',now()),
  ('d1000000-0000-4000-8000-000000000001','UT-JN-004','Slim Fit Jeans — Indigo','Stretch denim jeans','Jeans',4990.00,4490.00,15,'active','synced',now()),
  ('d1000000-0000-4000-8000-000000000001','UT-BLT-005','Leather Belt — Tan','Full grain leather belt','Accessories',2190.00,null,0,'active','synced',now()),
  ('d1000000-0000-4000-8000-000000000002','GB-EB-101','Wireless Earbuds Pro','ANC wireless earbuds','Audio',2990.00,2490.00,66,'active','synced',now()),
  ('d1000000-0000-4000-8000-000000000002','GB-CH-102','65W Fast Charger','GaN USB-C fast charger','Chargers',1290.00,null,4,'active','synced',now()),
  ('d1000000-0000-4000-8000-000000000002','GB-PB-103','20000mAh Power Bank','Dual-output power bank','Power',3490.00,null,23,'active','synced',now());

insert into public.inventory (store_id, product_id, sku, stock, low_stock_threshold)
select p.store_id, p.id, p.sku, p.stock,
  case when p.sku = 'UT-HD-002' then 10 when p.sku = 'GB-CH-102' then 8 else 5 end
from public.products p;

insert into public.customers (store_id, external_id, name, email, phone) values
  ('d1000000-0000-4000-8000-000000000001','demo-c1','Ayesha Khan','ayesha.khan@example.com','+92 300 111 2222'),
  ('d1000000-0000-4000-8000-000000000001','demo-c2','Bilal Ahmed','bilal.ahmed@example.com','+92 321 333 4444'),
  ('d1000000-0000-4000-8000-000000000001','demo-c3','Hina Raza','hina.raza@example.com','+92 333 555 6666'),
  ('d1000000-0000-4000-8000-000000000002','demo-c4','Omar Sheikh','omar.sheikh@example.com','+92 345 777 8888'),
  ('d1000000-0000-4000-8000-000000000002','demo-c5','Sana Malik','sana.malik@example.com','+92 301 999 0000'),
  ('d1000000-0000-4000-8000-000000000002','demo-c6','Zain Abbas','zain.abbas@example.com','+92 311 121 3131');

insert into public.orders (store_id, external_id, order_number, customer_id, status, payment_status, subtotal, shipping, total, payment_method, shipping_address, placed_at) values
  ('d1000000-0000-4000-8000-000000000001','demo-o1','UT-1024',(select id from public.customers where external_id='demo-c1'),'delivered','paid',2740.00,250.00,2990.00,'COD','{"city":"Lahore","address":"House 12, Block C","country":"Pakistan"}', now() - interval '27 days'),
  ('d1000000-0000-4000-8000-000000000001','demo-o2','UT-1025',(select id from public.customers where external_id='demo-c2'),'delivered','paid',1290.00,250.00,1540.00,'COD','{"city":"Karachi","address":"Flat 4B, Sea View Apts","country":"Pakistan"}', now() - interval '21 days'),
  ('d1000000-0000-4000-8000-000000000001','demo-o3','UT-1026',(select id from public.customers where external_id='demo-c3'),'shipped','paid',3890.00,300.00,4190.00,'Card','{"city":"Islamabad","address":"Street 7, F-11","country":"Pakistan"}', now() - interval '9 days'),
  ('d1000000-0000-4000-8000-000000000001','demo-o4','UT-1027',(select id from public.customers where external_id='demo-c1'),'processing','paid',4490.00,250.00,4740.00,'COD','{"city":"Lahore","address":"House 12, Block C","country":"Pakistan"}', now() - interval '4 days'),
  ('d1000000-0000-4000-8000-000000000001','demo-o5','UT-1028',(select id from public.customers where external_id='demo-c2'),'pending','pending',990.00,250.00,1240.00,'COD','{"city":"Karachi","address":"Flat 4B, Sea View Apts","country":"Pakistan"}', now() - interval '1 days'),
  ('d1000000-0000-4000-8000-000000000001','demo-o6','UT-1029',(select id from public.customers where external_id='demo-c3'),'cancelled','refunded',4990.00,0.00,0.00,'Card','{"city":"Islamabad","address":"Street 7, F-11","country":"Pakistan"}', now() - interval '6 days'),
  ('d1000000-0000-4000-8000-000000000002','demo-o7','GB-2041',(select id from public.customers where external_id='demo-c4'),'delivered','paid',2490.00,200.00,2690.00,'COD','{"city":"Rawalpindi","address":"Bank Road 21","country":"Pakistan"}', now() - interval '18 days'),
  ('d1000000-0000-4000-8000-000000000002','demo-o8','GB-2042',(select id from public.customers where external_id='demo-c5'),'shipped','paid',3490.00,200.00,3690.00,'Card','{"city":"Faisalabad","address":"Peoples Colony 9","country":"Pakistan"}', now() - interval '7 days'),
  ('d1000000-0000-4000-8000-000000000002','demo-o9','GB-2043',(select id from public.customers where external_id='demo-c6'),'processing','paid',1290.00,200.00,1490.00,'COD','{"city":"Multan","address":"Gulgasht 44","country":"Pakistan"}', now() - interval '3 days'),
  ('d1000000-0000-4000-8000-000000000002','demo-o10','GB-2044',(select id from public.customers where external_id='demo-c4'),'pending','pending',2490.00,200.00,2690.00,'COD','{"city":"Rawalpindi","address":"Bank Road 21","country":"Pakistan"}', now() - interval '0 days');

insert into public.order_items (order_id, product_id, title, sku, quantity, unit_price, total)
select o.id, p.id, p.title, p.sku, 1, coalesce(p.sale_price, p.price), coalesce(p.sale_price, p.price)
from public.orders o join public.products p on p.store_id = o.store_id
where o.external_id in ('demo-o1','demo-o3','demo-o5','demo-o6','demo-o7','demo-o8','demo-o9','demo-o10')
  and (
    (o.external_id='demo-o1' and p.sku='UT-TS-001') or
    (o.external_id='demo-o3' and p.sku='UT-HD-002') or
    (o.external_id='demo-o5' and p.sku='UT-CAP-003') or
    (o.external_id='demo-o6' and p.sku='UT-JN-004') or
    (o.external_id='demo-o7' and p.sku='GB-EB-101') or
    (o.external_id='demo-o8' and p.sku='GB-PB-103') or
    (o.external_id='demo-o9' and p.sku='GB-CH-102') or
    (o.external_id='demo-o10' and p.sku='GB-EB-101')
  );

-- demo-o2: two line items
insert into public.order_items (order_id, product_id, title, sku, quantity, unit_price, total)
select o.id, p.id, p.title, p.sku, 2, 645.00, 1290.00
from public.orders o join public.products p on p.store_id = o.store_id
where o.external_id = 'demo-o2' and p.sku = 'UT-TS-001';

-- audit_logs.store_id foreign key (added after stores exists)
alter table public.audit_logs add constraint audit_logs_store_fk foreign key (store_id) references public.stores(id) on delete set null;