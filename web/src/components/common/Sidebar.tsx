'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Users,
  Car,
  Route,
  Navigation,
  Activity,
  Cpu,
  Settings,
  ChevronLeft,
  ChevronRight,
  CarFront,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/driver', label: 'Driver View', icon: CarFront },
  { href: '/routing', label: 'Smart Routing', icon: Navigation },
  { href: '/drivers', label: 'Drivers', icon: Users },
  { href: '/vehicles', label: 'Vehicles', icon: Car },
  { href: '/trips', label: 'Trips', icon: Route },
  { href: '/road-network', label: 'Road Quality', icon: Activity },
  { href: '/hardware', label: 'Hardware', icon: Cpu },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <aside
      className={`bg-black border-r border-zinc-800 flex flex-col h-screen sticky top-0 z-40 select-none text-xs transition-all duration-200 ${
        isCollapsed ? 'w-14' : 'w-48'
      }`}
    >
      {/* Brand Header */}
      <div
        className={`h-11 flex items-center bg-black border-b border-zinc-800 transition-all ${
          isCollapsed ? 'justify-center px-1' : 'justify-between px-3'
        }`}
      >
        {!isCollapsed && (
          <Link
            href="/"
            className="font-semibold tracking-tight text-white font-sans text-xs flex items-center gap-2 overflow-hidden hover:opacity-90 transition-opacity"
          >
            <span className="w-1.5 h-1.5 rounded-sm bg-emerald-500 shrink-0" />
            <span className="truncate">RoadScore</span>
          </Link>
        )}

        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors flex items-center justify-center shrink-0"
          title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          aria-label={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto font-sans">
        {NAV_ITEMS.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);

          const Icon = item.icon;

          return (
            <Link key={item.href} href={item.href} className="block relative">
              {isActive && (
                <motion.div
                  layoutId="sidebar-active-indicator"
                  className="absolute inset-0 bg-zinc-900 rounded-md border border-zinc-800"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <div
                className={`relative z-10 flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                  isActive
                    ? 'text-white font-medium'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-900/50'
                } ${isCollapsed ? 'justify-center px-0' : ''}`}
                title={isCollapsed ? item.label : undefined}
              >
                <Icon size={15} className="shrink-0" />
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </div>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
