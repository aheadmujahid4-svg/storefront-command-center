# Storefront Command Center

Build a secure, mobile-first private Multi-Store E-commerce Master Admin Panel.



PROJECT NAME: Master Control



PURPOSE:

I own multiple e-commerce websites built with Lovable. I want one private dashboard to manage all connected stores from a single place using my Android phone.



TECH STACK:



- React and TypeScript

- Tailwind CSS

- Supabase Auth and PostgreSQL

- Supabase Edge Functions for secure server-side integrations

- Responsive mobile-first interface



DESIGN:



- Professional premium dark dashboard

- Black, white and subtle blue accents

- Collapsible sidebar and mobile bottom navigation

- Fast loading, clean tables and search

- Mobile-friendly product and order forms



AUTHENTICATION AND SECURITY:



- Email/password login

- Only explicitly authorized owner accounts can access the admin panel

- No public admin sign-up

- Verify the user's identity and admin authorization on the server

- Enable RLS on every exposed database table

- Never expose service-role keys, secret keys, store API tokens or passwords in frontend code

- Protect every admin route and server-side operation

- Provide logout and secure session handling

- Do not rely on a hidden URL as security



DASHBOARD:



- Total connected stores

- Total products

- Pending, processing, shipped and delivered orders

- Revenue summaries with date filters

- Low-stock alerts

- Recent orders

- Store-specific and combined reports

- Clearly distinguish test data from real store data



MULTI-STORE MANAGEMENT:



- Add, edit, disable and remove store connections

- Give each store a unique ID, name, URL, platform and connection status

- Provide a store switcher and an all-stores overview

- Keep products, orders, customers and inventory separated by store

- Never merge records from different stores accidentally

- Store connection secrets only in secure server-side storage

- Display connection errors and last successful sync time

- Do not claim a store is connected until the connection has been verified



PRODUCT MANAGEMENT:



- List, search, filter and paginate products

- Add, edit and archive products

- Manage title, description, images, SKU, price, sale price, stock, category and status

- Support bulk price and stock updates with a preview and confirmation

- Keep product IDs and store IDs correctly mapped

- Show sync status and failed updates



ORDER MANAGEMENT:



- List and search orders by store, order number, date and status

- Display line items, quantities, totals, shipping details and payment status

- Update fulfillment and order status only when the connected store API supports it

- Confirm before cancellation, refunds or other irreversible actions

- Never mark a refund as complete unless the payment provider confirms it



CUSTOMER MANAGEMENT:



- Search customer records by store

- Display only necessary customer details

- Restrict access to personal information

- Do not copy customer data across stores without authorization



INVENTORY:



- Track stock by store and SKU

- Show low-stock warnings

- Preview bulk changes before applying them

- Prevent accidental cross-store stock updates



ANALYTICS:



- Sales, order count, average order value and best-selling products

- Date-range filters and per-store reports

- Calculate revenue from actual verified order records

- Clearly label unavailable or unsynchronized data



AUDIT LOG:



- Record admin actions, timestamps, affected store and success/failure

- Never log passwords, secret keys or full payment credentials



IMPLEMENTATION RULES:



1. First inspect the project and propose the database schema and security plan.

2. Create the authentication flow and private dashboard shell first.

3. Create tables for profiles, authorized admins, stores, store connections, products, orders, customers, inventory and audit logs as appropriate.

4. Add foreign keys, constraints, indexes and strict RLS policies.

5. Use server-side Edge Functions for privileged operations and external store API calls.

6. Build an adapter for each store platform instead of assuming all APIs are identical.

7. Never invent API endpoints or pretend an integration works without testing it.

8. Start with demo data clearly labeled DEMO.

9. Do not modify any existing live store or delete data during setup.

10. Build the first verified store connection only after its real backend and API capabilities are identified.

11. Provide loading states, empty states, error messages, retry controls and confirmation dialogs.

12. Test unauthorized access, store isolation, product edits, order updates and failed connections.



IMPORTANT:

Build the actual working application, not just a visual mockup. If credentials, API access, permissions or configuration are missing, clearly identify what I must provide and do not fake a successful connection.



Start by creating the dashboard foundation, secure authentication, database schema and mobile responsive UI. Then guide me through connecting the first store.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/3aeaf322-fd6c-4d38-ac70-e984e01211e3).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
