// src/components/icons.ts
import type { SVGProps } from 'react';
import {
  LayoutDashboard,
  PackagePlus,
  BarChart3,
  Boxes,
  Warehouse,
  Users,
  Settings,
  LogOut,
  LogIn,
  UserPlus as LucideUserPlus,
  ChevronDown,        // Ya lo tienes
  ChevronUp,          // <--- AÑADIR ESTA IMPORTACIÓN
  Menu,
  Package,
  FilePlus2,
  ShoppingCart,
  Truck,
  DollarSign,
  AlertTriangle,
  Search,
  Filter,
  PlusCircle,
  Edit3,
  Trash2,
  Eye,
  Download,
  Upload,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  List,
  Grid,
  Archive,
  Send as LucideSend,
  ClipboardList,
  MapPin,
  Building,
  Briefcase,
  UsersRound,
  LayoutList,
  Calendar as LucideCalendar,
} from 'lucide-react';

export const StockPilotLogo = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    stroke="currentColor"
    {...props}
  >
    <path d="M12 2L2 7L12 12L22 7L12 2Z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M2 17L12 22L22 17" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M2 12L12 17L22 12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 12V22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 2V12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M2 7V17" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M22 7V17" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
  </svg>
);


export const Icons = {
  Dashboard: LayoutDashboard,
  RegisterStock: PackagePlus,
  VisualizeStock: BarChart3,
  Products: Boxes,
  Warehouses: Building, // Warehouse fue cambiado por Building, asegúrate que sea consistente.
  Suppliers: UsersRound,
  Categories: LayoutList,
  Users: Users,
  Settings: Settings,
  Logout: LogOut,
  Login: LogIn,
  UserPlus: LucideUserPlus,
  ChevronDown: ChevronDown,
  ChevronUp: ChevronUp,      // <--- AÑADIR ESTA LÍNEA
  Menu: Menu,
  Logo: StockPilotLogo,
  Package: Package,
  Inbound: Archive,
  Outbound: LucideSend,
  Send: LucideSend,
  Inventory: ClipboardList,
  Location: MapPin,
  Business: Briefcase,
  ShoppingCart: ShoppingCart,
  Truck: Truck,
  DollarSign: DollarSign,
  AlertTriangle: AlertTriangle,
  Search: Search,
  Filter: Filter,
  Add: PlusCircle,
  Edit: Edit3,
  Delete: Trash2,
  View: Eye,
  Download: Download,
  Upload: Upload,
  ChevronLeft: ChevronLeft,
  ChevronRight: ChevronRight,
  MoreHorizontal: MoreHorizontal,
  List: List,
  Grid: Grid,
  LayoutList: LayoutList, // Tienes LayoutList dos veces, lo cual es redundante pero no dañino.
  ClipboardList: ClipboardList,
  Calendar: LucideCalendar,
};