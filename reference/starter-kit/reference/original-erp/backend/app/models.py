import enum
import datetime
from sqlalchemy import (
    Column, Integer, String, Float, DateTime, ForeignKey, Enum, Text
)
from sqlalchemy.orm import relationship
from .database import Base


class ItemType(str, enum.Enum):
    crude_oil = "crude_oil"
    chemical = "chemical"
    packaging = "packaging"
    finished_good = "finished_good"


class WarehouseType(str, enum.Enum):
    tank = "tank"                      # crude oil storage tanks
    raw_material_store = "raw_material_store"
    packaging_store = "packaging_store"
    finished_goods = "finished_goods"
    toll_customer_stock = "toll_customer_stock"  # material owned by toll customers, not us


class POStatus(str, enum.Enum):
    draft = "draft"
    approved = "approved"
    partially_received = "partially_received"
    completed = "completed"
    cancelled = "cancelled"


class LedgerDirection(str, enum.Enum):
    debit = "debit"   # money we owe increases (purchase bill)
    credit = "credit"  # money we owe decreases (we paid)


class PaymentMethod(str, enum.Enum):
    cash = "cash"
    cheque = "cheque"
    online = "online"


class PaymentStatus(str, enum.Enum):
    unpaid = "unpaid"
    paid = "paid"


class AdjustmentDirection(str, enum.Enum):
    increase = "increase"   # physical count found MORE than the books show
    decrease = "decrease"   # physical count found LESS than the books show


class AdjustmentStatus(str, enum.Enum):
    pending = "pending"     # audit trail placeholder — no role system exists yet to
    approved = "approved"   # restrict who can flip this; see Employee Accounts phase


class Plant(str, enum.Enum):
    refining = "refining"
    hydrogenation = "hydrogenation"   # ghee production
    soap = "soap"
    packaging = "packaging"           # reserved for Phase 4


class ProductionOrderStatus(str, enum.Enum):
    draft = "draft"
    completed = "completed"
    cancelled = "cancelled"


class SalesOrderStatus(str, enum.Enum):
    draft = "draft"
    approved = "approved"
    partially_dispatched = "partially_dispatched"
    completed = "completed"
    cancelled = "cancelled"


class ExpenseCategory(str, enum.Enum):
    salaries = "salaries"
    utilities = "utilities"
    rent = "rent"
    maintenance = "maintenance"
    transport = "transport"
    fuel = "fuel"
    admin = "admin"
    other = "other"


class EmploymentType(str, enum.Enum):
    permanent = "permanent"
    contract = "contract"
    daily_wage = "daily_wage"


class AttendanceStatus(str, enum.Enum):
    present = "present"
    absent = "absent"
    leave = "leave"          # paid leave
    half_day = "half_day"


class PayrollRunStatus(str, enum.Enum):
    draft = "draft"          # computed, still editable
    finalized = "finalized"  # locked, posted to Expenses


# ---------- Master Data ----------

class UnitOfMeasure(Base):
    __tablename__ = "units_of_measure"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)   # e.g. "Metric Ton", "Kilogram", "Liter"
    symbol = Column(String, unique=True, nullable=False)  # e.g. "MT", "kg", "L"
    is_active = Column(Integer, default=1)


class Vendor(Base):
    __tablename__ = "vendors"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    contact_person = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    address = Column(String, nullable=True)
    payment_terms = Column(String, nullable=True)  # e.g. "Net 15", "Cash on delivery"
    opening_balance = Column(Float, default=0.0)   # +ve = we owe vendor
    is_active = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    ledger_entries = relationship("VendorLedgerEntry", back_populates="vendor")
    supplied_items = relationship("VendorItem", cascade="all, delete-orphan")
    bank_accounts = relationship("VendorBankAccount", cascade="all, delete-orphan")


class VendorItem(Base):
    """Which items a vendor supplies — a simple tag/association, not a financial
    record, so unlike bank accounts it's safe to fully replace on every vendor
    edit rather than needing soft-delete."""
    __tablename__ = "vendor_items"
    id = Column(Integer, primary_key=True, index=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)

    item = relationship("Item")


class VendorBankAccount(Base):
    """A vendor can have several accounts (different banks/branches); payments
    can be split across them. Soft-delete only — a removed account may already
    be referenced by a past payment's ledger entry, and that historical record
    must stay accurate."""
    __tablename__ = "vendor_bank_accounts"
    id = Column(Integer, primary_key=True, index=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False)
    bank_name = Column(String, nullable=False)
    account_title = Column(String, nullable=True)
    account_number = Column(String, nullable=False)
    is_active = Column(Integer, default=1)


class Customer(Base):
    """A toll/job-work customer — sends us their own material to process, owes us a
    processing fee (not the other direction, unlike vendors)."""
    __tablename__ = "customers"
    id = Column(Integer, primary_key=True, index=True)
    customer_number = Column(String, unique=True, nullable=True)   # auto-suggested, editable
    name = Column(String, nullable=False)
    contact_person = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    address = Column(String, nullable=True)
    is_active = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    ledger_entries = relationship("CustomerLedgerEntry", back_populates="customer")


class Warehouse(Base):
    __tablename__ = "warehouses"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)          # e.g. "Crude Tank 1", "Chemical Store"
    warehouse_type = Column(Enum(WarehouseType), nullable=False)
    capacity = Column(Float, nullable=True)         # in the item's base UOM, optional
    is_active = Column(Integer, default=1)


class Item(Base):
    __tablename__ = "items"
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, nullable=False)   # e.g. "CRD-001"
    name = Column(String, nullable=False)                 # e.g. "Crude Sunflower Oil"
    item_type = Column(Enum(ItemType), nullable=False)
    uom_id = Column(Integer, ForeignKey("units_of_measure.id"), nullable=False)
    reorder_level = Column(Float, nullable=True)
    pack_size = Column(String, nullable=True)        # e.g. "5L", "1kg" — for packed SKUs
    units_per_case = Column(Float, nullable=True)     # e.g. 12 bottles per carton, for packaging BOMs
    density_kg_per_liter = Column(Float, nullable=True)  # for oils bought by weight, packed by volume —
    # informational only, shown as a cross-check calculator, never auto-applied to stored quantities
    is_active = Column(Integer, default=1)

    uom = relationship("UnitOfMeasure")


# ---------- Procurement ----------

class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    id = Column(Integer, primary_key=True, index=True)
    po_number = Column(String, unique=True, nullable=False)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False)
    order_date = Column(DateTime, default=datetime.datetime.utcnow)
    status = Column(Enum(POStatus), default=POStatus.draft)
    payment_status = Column(Enum(PaymentStatus), default=PaymentStatus.unpaid)
    notes = Column(Text, nullable=True)
    advance_amount = Column(Float, default=0.0)    # paid up-front when the PO was raised (ledger: PO_ADVANCE)
    freight_charges = Column(Float, default=0.0)   # total freight across this PO's GRNs — kept apart from goods value
    gst_rate = Column(Float, default=0.0)          # percent GST charged on the goods; 0 = not a GST purchase

    vendor = relationship("Vendor")
    lines = relationship("PurchaseOrderLine", back_populates="purchase_order", cascade="all, delete-orphan")


class PurchaseOrderLine(Base):
    __tablename__ = "purchase_order_lines"
    id = Column(Integer, primary_key=True, index=True)
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    quantity = Column(Float, nullable=False)
    rate = Column(Float, nullable=False)   # price per UOM
    received_quantity = Column(Float, default=0.0)

    purchase_order = relationship("PurchaseOrder", back_populates="lines")
    item = relationship("Item")


class GRN(Base):
    """Goods Received Note — records actual receipt of material against a PO."""
    __tablename__ = "grns"
    id = Column(Integer, primary_key=True, index=True)
    grn_number = Column(String, unique=True, nullable=False)
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=False)
    received_date = Column(DateTime, default=datetime.datetime.utcnow)
    vehicle_no = Column(String, nullable=True)
    freight_amount = Column(Float, default=0.0)               # freight paid/owed for this delivery (ledger: GRN_FREIGHT)
    notes = Column(Text, nullable=True)
    bill_photo_url = Column(String, nullable=True)            # Google Drive view link
    bill_photo_drive_file_id = Column(String, nullable=True)   # for future management (delete/replace)

    purchase_order = relationship("PurchaseOrder")
    lines = relationship("GRNLine", back_populates="grn", cascade="all, delete-orphan")


class GRNLine(Base):
    __tablename__ = "grn_lines"
    id = Column(Integer, primary_key=True, index=True)
    grn_id = Column(Integer, ForeignKey("grns.id"), nullable=False)
    po_line_id = Column(Integer, ForeignKey("purchase_order_lines.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    batch_no = Column(String, nullable=False)
    quantity = Column(Float, nullable=False)
    rate = Column(Float, nullable=False)

    grn = relationship("GRN", back_populates="lines")
    item = relationship("Item")
    warehouse = relationship("Warehouse")


# ---------- Inventory ----------

class StockLedgerEntry(Base):
    """Every stock movement (in or out) is one row here. Current stock = sum of entries."""
    __tablename__ = "stock_ledger_entries"
    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    batch_no = Column(String, nullable=True)
    quantity = Column(Float, nullable=False)   # positive = stock in, negative = stock out
    rate = Column(Float, nullable=True)        # value per unit at time of movement
    is_toll_stock = Column(Integer, default=0)  # 1 = belongs to a toll/job-work customer, not us
    toll_customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)  # WHICH customer owns
    # this batch, when is_toll_stock=1. Two customers' oil in the same tank must never be summed
    # together or FIFO-consumed into each other's batches — this field is what keeps them apart.
    ref_type = Column(String, nullable=False)   # e.g. "GRN", "PRODUCTION_ISSUE", "SALES_DISPATCH"
    ref_id = Column(Integer, nullable=True)
    entry_date = Column(DateTime, default=datetime.datetime.utcnow)

    item = relationship("Item")
    warehouse = relationship("Warehouse")
    toll_customer = relationship("Customer")


# ---------- Production (Phase 2) ----------

class BOM(Base):
    """
    Bill of Materials / recipe template. Defines EXPECTED input->output ratios for a
    plant, scaled to a reference batch size. Actual production orders record real
    quantities, which may differ from this template (yield varies in practice).
    """
    __tablename__ = "boms"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)              # e.g. "Sunflower Oil Refining - Standard"
    plant = Column(Enum(Plant), nullable=False)
    reference_batch_size = Column(Float, nullable=False)  # e.g. 100 (means "per 100 units of primary input")
    is_active = Column(Integer, default=1)
    notes = Column(Text, nullable=True)

    input_lines = relationship("BOMInputLine", back_populates="bom", cascade="all, delete-orphan")
    output_lines = relationship("BOMOutputLine", back_populates="bom", cascade="all, delete-orphan")


class BOMInputLine(Base):
    __tablename__ = "bom_input_lines"
    id = Column(Integer, primary_key=True, index=True)
    bom_id = Column(Integer, ForeignKey("boms.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    quantity = Column(Float, nullable=False)   # per reference_batch_size

    bom = relationship("BOM", back_populates="input_lines")
    item = relationship("Item")


class BOMOutputLine(Base):
    __tablename__ = "bom_output_lines"
    id = Column(Integer, primary_key=True, index=True)
    bom_id = Column(Integer, ForeignKey("boms.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    quantity = Column(Float, nullable=False)   # per reference_batch_size
    is_primary = Column(Integer, default=1)     # 1 = main product, 0 = byproduct/waste

    bom = relationship("BOM", back_populates="output_lines")
    item = relationship("Item")


class ProductionOrder(Base):
    """
    An actual production batch run. Records real material consumed (from specific
    stock batches, so cost flows through accurately) and real output produced
    (new batch(es) created with a computed cost per unit).
    """
    __tablename__ = "production_orders"
    id = Column(Integer, primary_key=True, index=True)
    order_number = Column(String, unique=True, nullable=False)
    plant = Column(Enum(Plant), nullable=False)
    bom_id = Column(Integer, ForeignKey("boms.id"), nullable=True)   # template used as reference, optional
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)  # set = this is a TOLL run;
    # all input/output stock is that customer's, never mixed with our own or another customer's
    status = Column(Enum(ProductionOrderStatus), default=ProductionOrderStatus.draft)
    order_date = Column(DateTime, default=datetime.datetime.utcnow)
    notes = Column(Text, nullable=True)

    # denormalized summary fields, computed on completion
    total_input_cost = Column(Float, nullable=True)   # cost of OUR OWN material consumed in this
    # order. For own production this is the full input cost, same as before. For a toll order it's
    # normally 0 (the customer's material has no cost to us) — UNLESS the order also consumes our
    # own stock (e.g. our packaging materials packing a customer's oil), in which case it's that
    # contributed cost, useful for billing the customer for materials on top of the processing fee.
    total_input_quantity = Column(Float, nullable=True)
    total_primary_output_quantity = Column(Float, nullable=True)
    yield_percent = Column(Float, nullable=True)

    bom = relationship("BOM")
    customer = relationship("Customer")
    input_lines = relationship("ProductionOrderInputLine", back_populates="production_order", cascade="all, delete-orphan")
    output_lines = relationship("ProductionOrderOutputLine", back_populates="production_order", cascade="all, delete-orphan")


class ProductionOrderInputLine(Base):
    """Material consumed from a specific existing stock batch."""
    __tablename__ = "production_order_input_lines"
    id = Column(Integer, primary_key=True, index=True)
    production_order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    batch_no = Column(String, nullable=False)
    quantity = Column(Float, nullable=False)
    rate = Column(Float, nullable=False)   # pulled from the consumed batch's stock ledger rate
    is_toll_stock = Column(Integer, default=0)  # which pool this particular line drew from — lets a
    toll_customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)  # single order mix
    # a toll customer's bulk material with OUR OWN packaging materials (see use_own_stock on create)

    production_order = relationship("ProductionOrder", back_populates="input_lines")
    item = relationship("Item")
    warehouse = relationship("Warehouse")


class ProductionOrderOutputLine(Base):
    """
    Material produced, becomes a new stock batch. Byproduct lines (is_primary=0,
    is_loss=0) require a user-entered rate (their recovery/scrap value); the
    primary line's rate is computed as the residual cost after byproducts and loss
    are valued off. Loss lines (is_loss=1) record a quantity for reporting
    visibility only — no StockLedgerEntry is created for them (no physical batch
    exists — evaporation, spillage, etc.), even though warehouse_id/batch_no are
    still populated (auto-filled) on the row itself for consistency.
    """
    __tablename__ = "production_order_output_lines"
    id = Column(Integer, primary_key=True, index=True)
    production_order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    batch_no = Column(String, nullable=False)   # new output batch number
    quantity = Column(Float, nullable=False)
    is_primary = Column(Integer, default=1)
    is_loss = Column(Integer, default=0)   # pure process loss — no recovery value, no stock created
    rate = Column(Float, nullable=True)   # byproduct: user-entered; primary: computed on save; loss: always 0

    production_order = relationship("ProductionOrder", back_populates="output_lines")
    item = relationship("Item")
    warehouse = relationship("Warehouse")


# ---------- Toll / Job-Work Processing (Phase 3) ----------

class TollIntake(Base):
    """Customer material arriving at the mill. No cost/vendor ledger impact — this
    is never our stock, just held and processed on the customer's behalf."""
    __tablename__ = "toll_intakes"
    id = Column(Integer, primary_key=True, index=True)
    intake_number = Column(String, unique=True, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    received_date = Column(DateTime, default=datetime.datetime.utcnow)
    vehicle_no = Column(String, nullable=True)
    notes = Column(Text, nullable=True)

    customer = relationship("Customer")
    lines = relationship("TollIntakeLine", back_populates="intake", cascade="all, delete-orphan")


class TollIntakeLine(Base):
    __tablename__ = "toll_intake_lines"
    id = Column(Integer, primary_key=True, index=True)
    intake_id = Column(Integer, ForeignKey("toll_intakes.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    batch_no = Column(String, nullable=False)
    quantity = Column(Float, nullable=False)
    declared_value = Column(Float, nullable=True)   # optional, for the customer's own insurance/reference only

    intake = relationship("TollIntake", back_populates="lines")
    item = relationship("Item")
    warehouse = relationship("Warehouse")


class TollDelivery(Base):
    """Dispatching processed goods back to the customer. Reduces that customer's
    toll stock; FIFO by default, same as production consumption."""
    __tablename__ = "toll_deliveries"
    id = Column(Integer, primary_key=True, index=True)
    delivery_number = Column(String, unique=True, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    delivery_date = Column(DateTime, default=datetime.datetime.utcnow)
    vehicle_no = Column(String, nullable=True)
    notes = Column(Text, nullable=True)

    customer = relationship("Customer")
    lines = relationship("TollDeliveryLine", back_populates="delivery", cascade="all, delete-orphan")


class TollDeliveryLine(Base):
    __tablename__ = "toll_delivery_lines"
    id = Column(Integer, primary_key=True, index=True)
    delivery_id = Column(Integer, ForeignKey("toll_deliveries.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    batch_no = Column(String, nullable=False)   # which batch this line actually drew from (FIFO-resolved)
    quantity = Column(Float, nullable=False)

    delivery = relationship("TollDelivery", back_populates="lines")
    item = relationship("Item")
    warehouse = relationship("Warehouse")


class CommissionInvoice(Base):
    """The actual revenue event of the toll business — the processing fee charged
    to the customer. Posts a debit to the customer ledger (they owe us)."""
    __tablename__ = "commission_invoices"
    id = Column(Integer, primary_key=True, index=True)
    invoice_number = Column(String, unique=True, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    production_order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=True)  # optional link
    invoice_date = Column(DateTime, default=datetime.datetime.utcnow)
    quantity_processed = Column(Float, nullable=True)   # reference only
    rate_per_unit = Column(Float, nullable=True)         # reference only
    amount = Column(Float, nullable=False)                # the actual invoice total
    payment_status = Column(Enum(PaymentStatus), default=PaymentStatus.unpaid)
    notes = Column(Text, nullable=True)

    customer = relationship("Customer")
    production_order = relationship("ProductionOrder")


class CustomerLedgerEntry(Base):
    """Debit = customer owes us (commission invoice). Credit = customer paid us."""
    __tablename__ = "customer_ledger_entries"
    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    direction = Column(Enum(LedgerDirection), nullable=False)
    amount = Column(Float, nullable=False)
    ref_type = Column(String, nullable=False)   # "COMMISSION_INVOICE" or "COMMISSION_PAYMENT"
    ref_id = Column(Integer, nullable=True)
    entry_date = Column(DateTime, default=datetime.datetime.utcnow)
    notes = Column(String, nullable=True)

    # payment method detail — only populated on incoming-payment (credit) entries
    payment_method = Column(Enum(PaymentMethod), nullable=True)
    cheque_number = Column(String, nullable=True)
    cheque_bank = Column(String, nullable=True)          # bank the cheque is drawn on
    our_bank = Column(String, nullable=True)              # our bank the cheque/transfer was deposited into
    other_party_name = Column(String, nullable=True)      # sender's name (who paid us)
    other_party_bank = Column(String, nullable=True)      # sender's bank (for online transfer)

    customer = relationship("Customer", back_populates="ledger_entries")


# ---------- Sales & Distribution (Phase 5) ----------

class Distributor(Base):
    """Buyers of your own-brand finished goods (Riwayat oil, ghee, soap). Separate
    from toll Customers — money flows the normal direction here: they owe you for
    goods sold, same shape as a vendor relationship but reversed."""
    __tablename__ = "distributors"
    id = Column(Integer, primary_key=True, index=True)
    distributor_number = Column(String, unique=True, nullable=True)   # auto-suggested, editable
    name = Column(String, nullable=False)
    contact_person = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    address = Column(String, nullable=True)
    city = Column(String, nullable=True)
    payment_terms = Column(String, nullable=True)
    credit_limit = Column(Float, nullable=True)
    opening_balance = Column(Float, default=0.0)   # +ve = they owe us
    is_active = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    ledger_entries = relationship("DistributorLedgerEntry", back_populates="distributor")


class SalesOrder(Base):
    __tablename__ = "sales_orders"
    id = Column(Integer, primary_key=True, index=True)
    so_number = Column(String, unique=True, nullable=False)
    distributor_id = Column(Integer, ForeignKey("distributors.id"), nullable=False)
    order_date = Column(DateTime, default=datetime.datetime.utcnow)
    status = Column(Enum(SalesOrderStatus), default=SalesOrderStatus.approved)
    notes = Column(Text, nullable=True)
    gst_rate = Column(Float, default=0.0)          # percent GST on this order; 0 = not a GST sale

    distributor = relationship("Distributor")
    lines = relationship("SalesOrderLine", back_populates="sales_order", cascade="all, delete-orphan")


class SalesOrderLine(Base):
    __tablename__ = "sales_order_lines"
    id = Column(Integer, primary_key=True, index=True)
    sales_order_id = Column(Integer, ForeignKey("sales_orders.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    quantity = Column(Float, nullable=False)
    rate = Column(Float, nullable=False)
    dispatched_quantity = Column(Float, default=0.0)

    sales_order = relationship("SalesOrder", back_populates="lines")
    item = relationship("Item")


class SalesDispatch(Base):
    """Delivery challan — the goods actually leaving the mill. Reduces finished
    goods stock via FIFO by default, same principle as every other consumption
    in this system."""
    __tablename__ = "sales_dispatches"
    id = Column(Integer, primary_key=True, index=True)
    dispatch_number = Column(String, unique=True, nullable=False)
    sales_order_id = Column(Integer, ForeignKey("sales_orders.id"), nullable=False)
    dispatch_date = Column(DateTime, default=datetime.datetime.utcnow)
    vehicle_no = Column(String, nullable=True)
    notes = Column(Text, nullable=True)

    sales_order = relationship("SalesOrder")
    lines = relationship("SalesDispatchLine", back_populates="dispatch", cascade="all, delete-orphan")


class SalesDispatchLine(Base):
    __tablename__ = "sales_dispatch_lines"
    id = Column(Integer, primary_key=True, index=True)
    dispatch_id = Column(Integer, ForeignKey("sales_dispatches.id"), nullable=False)
    sales_order_line_id = Column(Integer, ForeignKey("sales_order_lines.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    batch_no = Column(String, nullable=False)   # which batch this line actually drew from (FIFO-resolved)
    quantity = Column(Float, nullable=False)
    cogs_rate = Column(Float, nullable=True)     # the stock's cost rate at time of dispatch — useful
    # for margin reporting later (Phase 6), even though Sales itself doesn't compute P&L

    dispatch = relationship("SalesDispatch", back_populates="lines")
    sales_order_line = relationship("SalesOrderLine")
    item = relationship("Item")
    warehouse = relationship("Warehouse")


class SalesInvoice(Base):
    __tablename__ = "sales_invoices"
    id = Column(Integer, primary_key=True, index=True)
    invoice_number = Column(String, unique=True, nullable=False)
    distributor_id = Column(Integer, ForeignKey("distributors.id"), nullable=False)
    sales_order_id = Column(Integer, ForeignKey("sales_orders.id"), nullable=True)
    invoice_date = Column(DateTime, default=datetime.datetime.utcnow)
    subtotal = Column(Float, nullable=False)
    tax_rate = Column(Float, default=0.0)     # percent, e.g. 17 for 17% GST
    tax_amount = Column(Float, default=0.0)
    total_amount = Column(Float, nullable=False)
    payment_status = Column(Enum(PaymentStatus), default=PaymentStatus.unpaid)
    notes = Column(Text, nullable=True)

    distributor = relationship("Distributor")
    sales_order = relationship("SalesOrder")
    lines = relationship("SalesInvoiceLine", back_populates="invoice", cascade="all, delete-orphan")


class SalesInvoiceLine(Base):
    __tablename__ = "sales_invoice_lines"
    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("sales_invoices.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    quantity = Column(Float, nullable=False)
    rate = Column(Float, nullable=False)
    amount = Column(Float, nullable=False)

    invoice = relationship("SalesInvoice", back_populates="lines")
    item = relationship("Item")


class DistributorLedgerEntry(Base):
    """Debit = distributor owes us (sales invoice). Credit = they paid us."""
    __tablename__ = "distributor_ledger_entries"
    id = Column(Integer, primary_key=True, index=True)
    distributor_id = Column(Integer, ForeignKey("distributors.id"), nullable=False)
    direction = Column(Enum(LedgerDirection), nullable=False)
    amount = Column(Float, nullable=False)
    ref_type = Column(String, nullable=False)   # "SALES_INVOICE", "SALES_PAYMENT", "OPENING_BALANCE"
    ref_id = Column(Integer, nullable=True)
    entry_date = Column(DateTime, default=datetime.datetime.utcnow)
    notes = Column(String, nullable=True)

    # payment method detail — only populated on incoming-payment (credit) entries
    payment_method = Column(Enum(PaymentMethod), nullable=True)
    cheque_number = Column(String, nullable=True)
    cheque_bank = Column(String, nullable=True)
    our_bank = Column(String, nullable=True)
    other_party_name = Column(String, nullable=True)
    other_party_bank = Column(String, nullable=True)

    distributor = relationship("Distributor", back_populates="ledger_entries")


# ---------- Accounts (minimal, for Phase 1 vendor ledger) ----------

class VendorLedgerEntry(Base):
    __tablename__ = "vendor_ledger_entries"
    id = Column(Integer, primary_key=True, index=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False)
    direction = Column(Enum(LedgerDirection), nullable=False)
    amount = Column(Float, nullable=False)
    ref_type = Column(String, nullable=False)  # e.g. "GRN_BILL", "PO_PAYMENT"
    ref_id = Column(Integer, nullable=True)
    entry_date = Column(DateTime, default=datetime.datetime.utcnow)
    notes = Column(String, nullable=True)

    # payment method detail — only populated on outgoing-payment (credit) entries
    payment_method = Column(Enum(PaymentMethod), nullable=True)
    cheque_number = Column(String, nullable=True)
    cheque_bank = Column(String, nullable=True)           # bank the cheque is drawn on
    our_bank = Column(String, nullable=True)               # our bank the transfer was sent from
    other_party_name = Column(String, nullable=True)       # receiver's name (who we paid)
    other_party_bank = Column(String, nullable=True)       # receiver's bank (for online transfer)
    vendor_bank_account_id = Column(Integer, ForeignKey("vendor_bank_accounts.id"), nullable=True)
    # which of the vendor's registered accounts this specific split went to, when
    # paid by selecting one rather than typing a bank name freehand

    vendor = relationship("Vendor", back_populates="ledger_entries")
    vendor_bank_account = relationship("VendorBankAccount")


# ---------- Finance (Phase 6) ----------

class Expense(Base):
    """Overhead / running costs not captured anywhere else (salaries, utilities,
    rent, etc.) — needed for P&L to reflect real profitability, not just gross
    margin on goods sold."""
    __tablename__ = "expenses"
    id = Column(Integer, primary_key=True, index=True)
    expense_date = Column(DateTime, default=datetime.datetime.utcnow)
    category = Column(Enum(ExpenseCategory), nullable=False)
    plant = Column(Enum(Plant), nullable=True)   # optional cost-center attribution; null = general/admin
    amount = Column(Float, nullable=False)       # total paid, freight included
    freight_charges = Column(Float, default=0.0)  # the freight part of `amount` (optional, shown separately in reports)
    description = Column(String, nullable=True)
    notes = Column(Text, nullable=True)

    payment_method = Column(Enum(PaymentMethod), nullable=True)
    cheque_number = Column(String, nullable=True)
    cheque_bank = Column(String, nullable=True)
    our_bank = Column(String, nullable=True)
    other_party_name = Column(String, nullable=True)
    other_party_bank = Column(String, nullable=True)

    bill_photo_url = Column(String, nullable=True)
    bill_photo_drive_file_id = Column(String, nullable=True)

    payroll_run_id = Column(Integer, nullable=True)   # set on the salary expenses a finalized payroll run posts


# ---------- HR & Payroll (Phase 7) ----------

class Employee(Base):
    __tablename__ = "employees"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    father_name = Column(String, nullable=True)
    cnic = Column(String, nullable=True)            # national ID
    phone = Column(String, nullable=True)
    address = Column(String, nullable=True)
    designation = Column(String, nullable=True)      # e.g. "Boiler Operator", "Accountant"
    plant = Column(Enum(Plant), nullable=True)        # cost-center attribution; null = admin/general
    employment_type = Column(Enum(EmploymentType), nullable=False)
    basic_salary = Column(Float, nullable=True)        # monthly, for permanent/contract
    daily_wage_rate = Column(Float, nullable=True)      # per day, for daily_wage
    overtime_rate_per_hour = Column(Float, nullable=True)
    bank_account = Column(String, nullable=True)
    joining_date = Column(DateTime, nullable=True)
    emergency_contact = Column(String, nullable=True)
    is_active = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class AttendanceRecord(Base):
    __tablename__ = "attendance_records"
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    attendance_date = Column(DateTime, nullable=False)
    status = Column(Enum(AttendanceStatus), nullable=False)
    overtime_hours = Column(Float, default=0.0)
    notes = Column(String, nullable=True)

    employee = relationship("Employee")


class PayrollRun(Base):
    __tablename__ = "payroll_runs"
    id = Column(Integer, primary_key=True, index=True)
    run_number = Column(String, unique=True, nullable=False)
    period_start = Column(DateTime, nullable=False)
    period_end = Column(DateTime, nullable=False)
    run_date = Column(DateTime, default=datetime.datetime.utcnow)
    status = Column(Enum(PayrollRunStatus), default=PayrollRunStatus.draft)
    notes = Column(Text, nullable=True)

    lines = relationship("PayslipLine", back_populates="payroll_run", cascade="all, delete-orphan")


class PayslipLine(Base):
    __tablename__ = "payslip_lines"
    id = Column(Integer, primary_key=True, index=True)
    payroll_run_id = Column(Integer, ForeignKey("payroll_runs.id"), nullable=False)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    days_present = Column(Float, default=0.0)
    days_absent = Column(Float, default=0.0)
    days_leave = Column(Float, default=0.0)
    days_half = Column(Float, default=0.0)
    overtime_hours = Column(Float, default=0.0)
    basic_pay = Column(Float, default=0.0)
    overtime_pay = Column(Float, default=0.0)
    allowances = Column(Float, default=0.0)   # editable before finalizing
    deductions = Column(Float, default=0.0)   # editable before finalizing (starts as the automatic absence deduction)
    advance_deduction = Column(Float, default=0.0)   # salary advance recovered in this run (may be less than owed)
    payment_method = Column(String, default="cash")  # how this person's salary is paid: cash / online / cheque
    net_pay = Column(Float, default=0.0)

    payroll_run = relationship("PayrollRun", back_populates="lines")
    employee = relationship("Employee")


class SalaryAdvance(Base):
    """Money handed to an employee ahead of payroll. What is still owed back is the sum of
    advances minus the advance_deduction taken on finalized payslips."""
    __tablename__ = "salary_advances"
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    advance_date = Column(DateTime, default=datetime.datetime.utcnow)
    amount = Column(Float, nullable=False)
    payment_method = Column(String, default="cash")   # cash / online / cheque
    notes = Column(String, nullable=True)

    employee = relationship("Employee")


# ---------- Invoice Print Settings (Improvement Phase 4) ----------

class InvoiceSettings(Base):
    """Singleton row (id always 1) controlling how printed invoices/challans look."""
    __tablename__ = "invoice_settings"
    id = Column(Integer, primary_key=True, index=True)
    company_name = Column(String, default="Riwayat Oils and Fats")
    company_address = Column(String, nullable=True)
    company_phone = Column(String, nullable=True)
    company_email = Column(String, nullable=True)
    ntn_number = Column(String, nullable=True)   # tax registration number, printed if set
    logo_base64 = Column(Text, nullable=True)     # data URL or raw base64 of the logo image
    logo_width_mm = Column(Float, default=30.0)
    logo_height_mm = Column(Float, default=30.0)
    footer_text = Column(Text, nullable=True)
    show_logo = Column(Integer, default=1)
    accent_color = Column(String, default="#c98a2c")


# ---------- Stock Adjustments (Improvement Phase 6) ----------

class StockAdjustment(Base):
    """
    Corrects the book quantity of OWN stock (never toll stock) against a physical
    check — e.g. a tank dip reading disagrees with what production orders say
    should be there. Posts to the stock ledger immediately on creation (operations
    can't wait on a review to fix a wrong number blocking the next batch); the
    pending/approved status is an audit trail only — there's no role system yet to
    restrict who can flip it to approved (see Employee Accounts, a later phase).
    Deliberately has no delete/edit — a mistaken adjustment should be corrected
    with an offsetting adjustment, not erased, to keep the audit trail honest.
    """
    __tablename__ = "stock_adjustments"
    id = Column(Integer, primary_key=True, index=True)
    adjustment_number = Column(String, unique=True, nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    direction = Column(Enum(AdjustmentDirection), nullable=False)
    quantity = Column(Float, nullable=False)   # always positive; direction determines the ledger sign
    rate = Column(Float, nullable=False)        # increase: user-entered value; decrease: weighted avg of
    # the batch(es) actually drawn from (for record-keeping — the real per-batch rates are on the
    # individual stock ledger entries, since a decrease can FIFO-split across more than one batch)
    batch_no = Column(String, nullable=True)    # increase: the new batch label (required); decrease:
    # optional — a specific batch to target, otherwise FIFO across all of that item/warehouse's batches
    reason_comment = Column(Text, nullable=False)
    status = Column(Enum(AdjustmentStatus), default=AdjustmentStatus.pending)
    adjustment_date = Column(DateTime, default=datetime.datetime.utcnow)
    approved_at = Column(DateTime, nullable=True)
    approved_by = Column(String, nullable=True)   # free-text name — no login system yet to pull this from

    item = relationship("Item")
    warehouse = relationship("Warehouse")


# ---------------------------------------------------------------------------
# Accounts & access control (Improvement Phase 12)
# ---------------------------------------------------------------------------
class Role(Base):
    """
    A named bundle of permissions. `permissions` is a JSON string:
      {"modules": {"vendors": "view", "grn": "edit", ...}, "actions": ["approve_stock_adjustments"]}
    A role with is_admin=1 ignores that JSON entirely and can do everything
    (including managing accounts and the Danger Zone reset). The built-in "Admin"
    role (is_system=1) can't be deleted or downgraded.
    Deliberately plain Integer/String/Text columns (no Enum) so the additive
    startup migrator never has to deal with Postgres enum types for these tables.
    """
    __tablename__ = "roles"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(String, nullable=True)
    is_admin = Column(Integer, default=0)
    is_system = Column(Integer, default=0)
    permissions = Column(Text, default="{}")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    users = relationship("User", back_populates="role")


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False, index=True)   # stored lowercase
    full_name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=False)
    is_active = Column(Integer, default=1)
    must_change_password = Column(Integer, default=0)
    token_version = Column(Integer, default=0)   # bumped on password change/reset -> logs out every other session
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)

    role = relationship("Role", back_populates="users")


class AuthSecret(Base):
    """Holds the token-signing key when no SECRET_KEY env var is set, so sessions
    survive restarts/redeploys without any manual setup."""
    __tablename__ = "auth_secret"
    id = Column(Integer, primary_key=True)
    value = Column(String, nullable=False)


# ---------------------------------------------------------------------------
# Stock transfers (Improvement Phase 13)
# ---------------------------------------------------------------------------
class StockTransfer(Base):
    """
    Moves stock of one item from one warehouse/tank to another. Nothing is created
    or destroyed: each transfer posts matching STOCK_TRANSFER_OUT (negative, source)
    and STOCK_TRANSFER_IN (positive, destination) ledger entries per batch, keeping
    the batch number, cost rate and toll-customer ownership intact. Like the ledger
    itself it is append-only — a mistaken transfer is fixed with a transfer back.
    Plain columns only (no Enum) so the additive startup migrator has nothing to do.
    """
    __tablename__ = "stock_transfers"
    id = Column(Integer, primary_key=True, index=True)
    transfer_number = Column(String, unique=True, nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    from_warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    to_warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    quantity = Column(Float, nullable=False)
    is_toll_stock = Column(Integer, default=0)
    toll_customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    batch_no = Column(String, nullable=True)     # only set when one specific batch was pinned; else FIFO
    notes = Column(Text, nullable=True)
    created_by = Column(String, nullable=True)   # who recorded it (from the sign-in)
    transfer_date = Column(DateTime, default=datetime.datetime.utcnow)

    item = relationship("Item")
    from_warehouse = relationship("Warehouse", foreign_keys=[from_warehouse_id])
    to_warehouse = relationship("Warehouse", foreign_keys=[to_warehouse_id])
    toll_customer = relationship("Customer")
