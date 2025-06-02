
import type { NavItemStructure, UserRole } from '@/types';
import { Icons } from '@/components/icons';

export const APP_NAME = "StockPilot";

export const userRoles: UserRole[] = ['employee', 'admin', 'superadmin'];

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
