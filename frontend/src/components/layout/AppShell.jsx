import { ArrowLeftRight, Check, LogOut, Menu, UserRound, X } from 'lucide-react';
import { Suspense, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/utils/cn';
import { initials } from '@/utils/format';
import { Spinner } from '@/components/ui/primitives';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Logo } from './Logo';
import { NAV } from './navConfig';

function visibleNav(me) {
  const perms = me.context.permissions;
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => (!i.context || i.context === me.context.type) && (!i.any || i.any.some((p) => perms.includes(p)))),
  })).filter((g) => g.items.length);
}

function Sidebar({ me, onNavigate }) {
  const { pathname } = useLocation();
  const isActive = (item) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center px-5">
        <Logo dark />
      </div>
      <nav aria-label="Main" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {visibleNav(me).map((g) => (
          <div key={g.section}>
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/50">{g.section}</p>
            <ul className="space-y-0.5">
              {g.items.map((i) => {
                const active = isActive(i);
                return (
                  <li key={i.href}>
                    <Link
                      to={i.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        active ? 'bg-sidebar-active text-white' : 'hover:bg-white/5 hover:text-white',
                      )}
                    >
                      <i.icon className={cn('size-4', active ? 'text-[#5b9bff]' : 'text-sidebar-foreground/60 group-hover:text-white')} />
                      {i.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 px-5 py-4 text-[11px] text-sidebar-foreground/50">DTII Valuers Ecosystem</div>
    </div>
  );
}

function ContextSwitcher({ me, onSwitch }) {
  if (me.contexts.length < 2) return null;
  const activeId = me.context.type === 'PLATFORM' ? 'platform' : me.context.firm?.id;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="flex items-center gap-1.5">
        <ArrowLeftRight className="size-3.5" /> Switch to
      </DropdownMenuLabel>
      {me.contexts.map((c) => (
        <DropdownMenuItem key={c.firmId} disabled={c.firmId === activeId} onSelect={() => onSwitch(c.firmId)}>
          {c.firmId === activeId ? <Check /> : <span className="size-4" />}
          <span className="min-w-0">
            <span className="block truncate">{c.label}</span>
            {c.firmCode && <span className="block text-xs text-muted-foreground">{c.firmCode}</span>}
          </span>
        </DropdownMenuItem>
      ))}
    </>
  );
}

/** Authenticated layout: fixed navy sidebar (drawer on mobile), sticky header, account menu. */
export default function AppShell() {
  const { me, logout, switchContext } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const title = me.context.type === 'PLATFORM' ? 'Platform administration' : me.context.firm.name;
  const roleLabel = me.context.roles.map((r) => r.name).join(' · ');

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        <Sidebar me={me} />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64">
            <Sidebar me={me} onNavigate={() => setMobileOpen(false)} />
            <button className="absolute right-3 top-4 rounded p-1 text-white" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
              <X className="size-5" />
            </button>
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-card/85 px-4 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 hover:bg-accent lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="size-5" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {title}
              {me.context.firm && <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{me.context.firm.firmCode}</span>}
            </p>
            <p className="truncate text-xs text-muted-foreground">{roleLabel}</p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg p-1.5 pr-2 hover:bg-accent" aria-label="Account menu">
                <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">{initials(me.user.fullName)}</span>
                <span className="hidden text-left sm:block">
                  <span className="block max-w-40 truncate text-sm font-medium leading-tight">{me.user.fullName}</span>
                  <span className="block max-w-40 truncate text-xs text-muted-foreground">{me.user.email}</span>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64">
                <DropdownMenuLabel>
                  Signed in as <span className="font-medium text-foreground">{me.user.email}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/account">
                    <UserRound /> My account & security
                  </Link>
                </DropdownMenuItem>
                <ContextSwitcher me={me} onSwitch={(id) => void switchContext(id)} />
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void logout()} className="text-destructive [&_svg]:text-destructive">
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Suspense
            fallback={
              <div className="flex justify-center py-20">
                <Spinner className="size-7" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
