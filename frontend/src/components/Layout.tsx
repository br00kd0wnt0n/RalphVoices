import { Link, Outlet, useLocation } from 'react-router-dom';
import { RalphLogo } from '@/components/RalphLogo';
import { Users, TestTube, LayoutDashboard, FolderOpen, Settings, BookOpen } from 'lucide-react';
import { motion } from 'framer-motion';

export function Layout() {
  const location = useLocation();

  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/projects', label: 'Projects', icon: FolderOpen },
    { path: '/personas', label: 'Personas', icon: Users },
    { path: '/tests', label: 'Tests', icon: TestTube },
  ];

  const rightNavItems = [
    { path: '/how-it-works', label: 'How it Works', icon: BookOpen },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  function renderNavLink(item: { path: string; label: string; icon: React.ElementType }) {
    const Icon = item.icon;
    const isActive = location.pathname === item.path ||
      (item.path !== '/' && location.pathname.startsWith(item.path));
    return (
      <Link
        key={item.path}
        to={item.path}
        className={`relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
          isActive
            ? 'text-[#D94D8F]'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
        }`}
      >
        <Icon className="h-4 w-4" />
        {item.label}
        {isActive && (
          <motion.div
            layoutId="nav-indicator"
            className="absolute inset-0 bg-[#D94D8F]/10 rounded-lg -z-10"
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
          />
        )}
      </Link>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/40 backdrop-blur-md bg-background/90 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/" className="group overflow-visible">
              <RalphLogo size="md" />
            </Link>
            <nav className="hidden md:flex items-center gap-0.5">
              {navItems.map(renderNavLink)}
            </nav>
          </div>
          <nav className="hidden md:flex items-center gap-0.5">
            {rightNavItems.map(renderNavLink)}
          </nav>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
