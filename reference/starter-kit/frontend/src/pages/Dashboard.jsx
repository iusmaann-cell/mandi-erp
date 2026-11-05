import { useAuth } from "../auth";
import { useNav, useAttention } from "../nav";
import { Card, SectionTitle } from "../components/ui";
import Icon from "../components/Icon";

/* Minimal home page: greeting + "needs your attention" list fed by useAttention() in nav.jsx.
   The original ERP's Dashboard.jsx (reference/original-erp/frontend/src/pages/Dashboard.jsx) shows
   KPI tiles, period filters and charts (recharts) if you want a richer example. */
export default function Dashboard() {
  const { user } = useAuth();
  const { navigate } = useNav();
  const { items } = useAttention();
  return (
    <div>
      <SectionTitle eyebrow="Home" title={`Welcome, ${user.full_name}`} />
      <Card>
        <div className="font-display font-extrabold text-forest mb-3">Needs your attention</div>
        {items.length === 0 && <div className="text-sm text-text-muted">All clear — nothing needs your attention.</div>}
        {items.map((a) => (
          <button key={a.id} onClick={() => navigate(a.page)} className="w-full text-left flex items-start gap-3 p-3 rounded-[18px] hover:bg-mint">
            <span className="w-10 h-10 rounded-full flex items-center justify-center bg-mint text-brand shrink-0"><Icon name={a.icon} size={18} /></span>
            <span><span className="block text-sm font-bold text-forest">{a.title}</span><span className="block text-xs text-text-muted">{a.sub}</span></span>
          </button>
        ))}
      </Card>
    </div>
  );
}
