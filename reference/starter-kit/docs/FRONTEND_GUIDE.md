# Frontend guide (`frontend/src/`)

## File-by-file
| File | Purpose |
|---|---|
| `brand.js` | product name, tagline, slogan, copyright — change first when rebranding |
| `index.css` | Tailwind v4 `@import "tailwindcss"` + `@theme` colour/font tokens + `.field` input style + animations. Re-point the tokens to re-skin everything |
| `api.js` | **only** place that calls the server: token storage, `authFetch`, `downloadFile`, `resolveFileUrl`, `request()` and the `api` object |
| `auth.jsx` | `AuthProvider` + `useAuth()`: `user, signIn, signOut, applyNewSession, isAdmin, can(module, need), canDo(action), canOpenPage(pageKey), pageLevel(pageKey)` |
| `permissions.js` | `PAGE_MODULE`: page key → permission module (`"__admin__"` = admin only) |
| `nav.jsx` | hash router (`NavProvider`, `useNav()` → `active, navigate(key,{action})`), `useIntent(key, fn)`, `useAttention()` (bell/dashboard alerts) |
| `App.jsx` | `PAGES` map, `Gate`, `Shell` (top bar, search, bell, view-only banner, phone bottom-nav + quick add) |
| `components/Sidebar.jsx` | `NAV_SECTIONS` menu, collapsible sections, rail mode, drawer on phones |
| `components/ui.jsx` | the component library (below) |
| `components/Dialogs.jsx` | `confirmDialog(msg, opts)` (async, replaces `window.confirm`) and `notify(msg, tone, title)` toasts; `<DialogHost/>` mounted once |
| `components/Icon.jsx` | inline SVG icons by name (`dash, chart, pkg, wallet, users, gear, bell, search, plus, edit, trash, check, alert, …`). Add icons to its map |
| `components/ChangePasswordForm.jsx` | used by the forced-change screen and Accounts → My Password |
| `components/BillPhotoUpload.jsx` | required photo picker (preview, camera or gallery) — parent sends the `File` in a `FormData` |
| `components/PaymentMethodFields.jsx` | cash / cheque / online sub-form (`direction="outgoing"|"incoming"`) |
| `pages/Login.jsx` | `LoginPage`, `ForcePasswordChange` |
| `pages/Accounts.jsx` | users, roles & permission grid, my password (admin only) |
| `pages/InvoiceSettings.jsx` | company details, logo upload, accent colour, danger-zone data reset |
| `pages/Items.jsx` | **example master-data page — copy it** |
| `printReport.js` | `printReport(settings, {title, subtitle, sections:[{heading, columns, rows, footer}]})` opens a print/PDF-ready page |
| `docNumbers.js` | `generateDocNumber("PO")` → `PO-261104-153012`; `generateSequentialNumber("CUST", existing)` → `CUST-0007` |

## Component cheat-sheet (`components/ui.jsx`)
```jsx
<SectionTitle eyebrow="Catalogue" title="Items" action={<Button>…</Button>} subtitle="optional"/>
<Card>…</Card>                                       // white rounded panel
<Button variant="primary|secondary|ghost|danger" size="sm|md|lg" onClick/disabled/type/>
<Input label hint error {...inputProps}/>           // pill input; <Select label>{options}</Select>; <Textarea label/>
<SearchSelect label value onChange options={[{value,label}]} placeholder/>   // type-to-search dropdown (long lists)
<Table columns={[{key,label,mono?,render?(row)}]} rows emptyLabel onRowClick/>
        // desktop: real table. Phone: each row becomes a card — first column = title, a column with label "" = action area
<Badge tone="neutral|amber|green|red|blue">…</Badge>
<RowActions onEdit onDelete deleteConfirm deleteLabel deleteDisabledReason/> // pencil + bin, bin asks for confirmation
<IconButton icon label onClick tone disabled/>
<FormPanel title onClose wide>…</FormPanel>          // slide-over (bottom sheet on phones) for add/edit forms; wide="xl" for big forms
<Modal title subtitle onClose wide footer>…</Modal>  // centred dialog
<Stat icon tone label value sub/>                    // KPI tile
<DetailRow label>value</DetailRow>
formatPKR(1234567) -> "1,234,567"   formatShort(18400000) -> "18.4M"     // rename/localise for your currency
```
Forms: use native `required` attributes + a single `error` state shown next to the Save button.
Always `try/catch` API calls: `catch (err) { setError(err.message) }` — server messages are already human-readable.

## Page template (what `Items.jsx` demonstrates)
1. State: `items`, `showForm`, `editingId`, `form`, `error`; `load()` in `useEffect`.
2. `startCreate()` pre-fills a generated code; `startEdit(row)` copies the row into `form`.
3. `handleSubmit`: convert number inputs with `Number(...)`, call create/update, close form, `load()`.
4. Delete: `<RowActions onDelete=…>` → call API → `notify(err.message,"error")` on failure.
5. Permissions: `can("items","edit")` hides New/Edit buttons; `canDo("delete_items")` hides delete.
6. `useIntent("items", a => a === "new" && startCreate())` lets quick-add buttons open the form.
7. Excel: `downloadFile("/items/report","item-list.xlsx")`.

## Navigation & permissions on the client
- Page key (e.g. `"purchase-orders"`) is used in 3 places: `PAGES` (App.jsx), `NAV_SECTIONS` (Sidebar.jsx), `PAGE_MODULE` (permissions.js).
- Link to another page: `const {navigate} = useNav(); navigate("grn", {action: "new"})`.
- Never rely on hidden buttons for security; the API enforces it.

## Styling rules
Tailwind utility classes + the tokens from `index.css` (`bg-surface`, `text-text-muted`, `border-border`, `text-forest`,
`bg-gold-soft`, `text-red`…). Inputs use the `.field` class (pill shape, 48px tall = comfortable on phones). Everything is
mobile-first: tables become cards under `md`, panels become bottom sheets, a bottom tab bar replaces the sidebar on phones.
Use `font-display` for headings and `stencil` class for numbers that should align in columns.

## Printing
`printReport.js` builds a standalone HTML page (company header from InvoiceSettings, accent colour, tables) and calls
`window.print()` — the user chooses "Save as PDF". For a branded invoice layout see `reference/original-erp/frontend/src/printInvoice.js`.

## Charts
Recharts is installed. See `reference/original-erp/frontend/src/pages/BIDashboard.jsx` and `Dashboard.jsx` for line/bar/pie cards with
period filters; the backend side is `reference/original-erp/backend/app/routers/bi.py`.
