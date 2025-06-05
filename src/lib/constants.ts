
import type { NavItemStructure, UserRole, RequisitionStatus, PurchaseOrderStatus, QuotationStatus, StockMovementType } from '@/types';
import { Icons } from '@/components/icons';

export const APP_NAME = "StockPilot";

export const userRoles: UserRole[] = ['employee', 'admin', 'superadmin'];

export const REQUISITION_STATUSES: RequisitionStatus[] = ["Pending Quotation", "Quoted", "PO in Progress", "Completed", "Canceled"];

export const QUOTATION_STATUSES: QuotationStatus[] = ["Sent", "Received", "Rejected", "Awarded", "Lost", "Partially Awarded"];

// Updated to include new PO statuses
export const PURCHASE_ORDER_STATUSES: PurchaseOrderStatus[] = [
  "Pending",
  "SentToSupplier",
  "ChangesProposedBySupplier",
  "PendingInternalReview",
  "ConfirmedBySupplier",
  "RejectedBySupplier",
  "PartiallyDelivered",
  "AwaitingFutureDelivery",
  "FullyReceived",
  "Completed",
  "Canceled"
];

// Added new stock movement types
export const STOCK_MOVEMENT_TYPES: StockMovementType[] = [
  'INBOUND_PO',
  'INBOUND_PO_DAMAGED',
  'PO_MISSING',
  'INBOUND_TRANSFER',
  'INBOUND_ADJUSTMENT',
  'OUTBOUND_SALE',
  'OUTBOUND_TRANSFER',
  'OUTBOUND_ADJUSTMENT',
  'INITIAL_STOCK'
];


export const navItems: NavItemStructure[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: Icons.Dashboard,
    allowedRoles: ['employee', 'admin', 'superadmin'],
  },
  {
    href: '/stock',
    label: 'Stock Management',
    icon: Icons.Package,
    allowedRoles: ['employee', 'admin', 'superadmin'],
    subItems: [
      { href: '/stock/register', label: 'Register Movement', icon: Icons.RegisterStock, allowedRoles: ['employee', 'admin', 'superadmin'] },
      { href: '/stock/visualize', label: 'Visualize Stock', icon: Icons.VisualizeStock, allowedRoles: ['employee', 'admin', 'superadmin'] },
      { href: '/stock/inventory', label: 'Current Inventory', icon: Icons.Inventory, allowedRoles: ['employee', 'admin', 'superadmin'] },
    ]
  },
  {
    href: '/products',
    label: 'Products',
    icon: Icons.Products,
    allowedRoles: ['admin', 'superadmin'],
  },
  {
    href: '/categories',
    label: 'Categories',
    icon: Icons.LayoutList,
    allowedRoles: ['admin', 'superadmin'],
  },
  {
    href: '/warehouses',
    label: 'Warehouses',
    icon: Icons.Warehouses,
    allowedRoles: ['admin', 'superadmin'],
  },
  {
    href: '/suppliers',
    label: 'Suppliers',
    icon: Icons.Suppliers,
    allowedRoles: ['admin', 'superadmin'],
  },
  {
    href: '/requisitions',
    label: 'Requisitions',
    icon: Icons.ClipboardList,
    allowedRoles: ['employee', 'admin', 'superadmin'],
    subItems: [
        { href: '/requisitions', label: 'View Requisitions', icon: Icons.List, allowedRoles: ['employee', 'admin', 'superadmin'] },
        { href: '/requisitions/new', label: 'New Requisition', icon: Icons.Add, allowedRoles: ['employee', 'admin', 'superadmin'] },
    ]
  },
  {
    href: '/quotations',
    label: 'Quotations',
    icon: Icons.DollarSign,
    allowedRoles: ['admin', 'superadmin'],
  },
  {
    href: '/purchase-orders',
    label: 'Purchase Orders',
    icon: Icons.ShoppingCart,
    allowedRoles: ['admin', 'superadmin'],
  },
  {
    href: '/admin',
    label: 'Admin Area',
    icon: Icons.Settings,
    allowedRoles: ['admin', 'superadmin'],
    subItems: [
      { href: '/admin/register-user', label: 'Register New User', icon: Icons.UserPlus, allowedRoles: ['admin', 'superadmin'] },
      { href: '/admin/users', label: 'Manage Users', icon: Icons.Users, allowedRoles: ['superadmin'] },
    ]
  },
];
