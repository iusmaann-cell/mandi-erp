import datetime
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from .. import models
from ..database import get_db

router = APIRouter(prefix="/bi", tags=["BI Dashboards"])


def _month_key(dt: datetime.datetime) -> str:
    return dt.strftime("%Y-%m")


def _month_range(months: int):
    end = datetime.datetime.utcnow()
    # first day of the month, `months` months back, so partial current month is included
    start = (end.replace(day=1) - datetime.timedelta(days=1))
    for _ in range(months - 1):
        start = (start.replace(day=1) - datetime.timedelta(days=1))
    start = start.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return start, end


@router.get("/revenue-trend")
def get_revenue_trend(months: int = 6, db: Session = Depends(get_db)):
    """Monthly sales revenue, commission revenue, COGS, expenses, and net profit —
    the core trend line for spotting whether the business is improving month over
    month, not just a single-period snapshot."""
    start, end = _month_range(months)

    buckets = {}

    def bucket(key):
        return buckets.setdefault(key, {"sales": 0.0, "commission": 0.0, "cogs": 0.0, "expenses": 0.0})

    for inv in db.query(models.SalesInvoice).filter(models.SalesInvoice.invoice_date >= start).all():
        bucket(_month_key(inv.invoice_date))["sales"] += inv.subtotal

    for c in db.query(models.CommissionInvoice).filter(models.CommissionInvoice.invoice_date >= start).all():
        bucket(_month_key(c.invoice_date))["commission"] += c.amount

    dispatch_rows = db.query(
        models.SalesDispatch.dispatch_date,
        models.SalesDispatchLine.quantity,
        models.SalesDispatchLine.cogs_rate,
    ).join(models.SalesDispatchLine, models.SalesDispatchLine.dispatch_id == models.SalesDispatch.id).filter(
        models.SalesDispatch.dispatch_date >= start
    ).all()
    for dispatch_date, qty, rate in dispatch_rows:
        bucket(_month_key(dispatch_date))["cogs"] += qty * (rate or 0)

    for e in db.query(models.Expense).filter(models.Expense.expense_date >= start).all():
        bucket(_month_key(e.expense_date))["expenses"] += e.amount

    result = []
    for key in sorted(buckets.keys()):
        b = buckets[key]
        revenue = b["sales"] + b["commission"]
        gross_profit = revenue - b["cogs"]
        net_profit = gross_profit - b["expenses"]
        result.append({
            "month": key, "sales_revenue": b["sales"], "commission_revenue": b["commission"],
            "total_revenue": revenue, "cogs": b["cogs"], "gross_profit": gross_profit,
            "expenses": b["expenses"], "net_profit": net_profit,
        })
    return result


@router.get("/production-yield-trend")
def get_production_yield_trend(plant: Optional[str] = None, months: int = 6, db: Session = Depends(get_db)):
    """Average yield % per month, optionally filtered to one plant — the core
    efficiency metric for spotting whether a plant's process is drifting."""
    start, end = _month_range(months)
    query = db.query(models.ProductionOrder).filter(
        models.ProductionOrder.order_date >= start,
        models.ProductionOrder.yield_percent.isnot(None),
    )
    if plant:
        query = query.filter(models.ProductionOrder.plant == plant)

    buckets = {}
    for order in query.all():
        key = _month_key(order.order_date)
        buckets.setdefault(key, []).append(order.yield_percent)

    result = []
    for key in sorted(buckets.keys()):
        values = buckets[key]
        result.append({
            "month": key,
            "avg_yield_percent": sum(values) / len(values),
            "batch_count": len(values),
        })
    return result


@router.get("/inventory-value-by-type")
def get_inventory_value_by_type(db: Session = Depends(get_db)):
    """Current owned inventory value broken down by item type — shows how much
    capital is tied up in crude oil vs. packaging materials vs. finished goods."""
    rows = db.query(
        models.Item.item_type,
        func.sum(models.StockLedgerEntry.quantity * models.StockLedgerEntry.rate).label("value"),
    ).join(models.Item, models.Item.id == models.StockLedgerEntry.item_id).filter(
        models.StockLedgerEntry.is_toll_stock == 0
    ).group_by(models.Item.item_type).all()

    return [{"item_type": r.item_type.value, "value": r.value or 0.0} for r in rows if (r.value or 0) > 1]


@router.get("/sales-by-distributor")
def get_sales_by_distributor(
    start_date: Optional[datetime.datetime] = None,
    end_date: Optional[datetime.datetime] = None,
    db: Session = Depends(get_db),
):
    """Revenue concentration across distributors — spot who your business actually
    depends on."""
    end_date = end_date or datetime.datetime.utcnow()
    start_date = start_date or (end_date - datetime.timedelta(days=90))

    rows = db.query(
        models.Distributor.id, models.Distributor.name,
        func.sum(models.SalesInvoice.total_amount).label("revenue"),
    ).join(models.SalesInvoice, models.SalesInvoice.distributor_id == models.Distributor.id).filter(
        models.SalesInvoice.invoice_date >= start_date,
        models.SalesInvoice.invoice_date <= end_date,
    ).group_by(models.Distributor.id, models.Distributor.name).all()

    result = [{"distributor_id": r.id, "distributor_name": r.name, "revenue": r.revenue} for r in rows]
    result.sort(key=lambda x: x["revenue"], reverse=True)
    return result


@router.get("/expense-breakdown")
def get_expense_breakdown(
    start_date: Optional[datetime.datetime] = None,
    end_date: Optional[datetime.datetime] = None,
    db: Session = Depends(get_db),
):
    """Expense total by category for a period — where the overhead money is
    actually going."""
    end_date = end_date or datetime.datetime.utcnow()
    start_date = start_date or (end_date - datetime.timedelta(days=90))

    rows = db.query(
        models.Expense.category,
        func.sum(models.Expense.amount).label("total"),
    ).filter(
        models.Expense.expense_date >= start_date,
        models.Expense.expense_date <= end_date,
    ).group_by(models.Expense.category).all()

    result = [{"category": r.category.value, "total": r.total} for r in rows]
    result.sort(key=lambda x: x["total"], reverse=True)
    return result
