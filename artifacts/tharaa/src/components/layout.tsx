import { useEffect, useState, type ComponentType } from "react";
import { Link, useLocation } from "wouter";
import { useLogout, useGetMe } from "@workspace/api-client-react";
import {
  LogOut,
  BookOpen,
  Users,
  BarChart3,
  Layers,
  Home,
  Settings,
  ShieldAlert,
  Shield,
  AlertTriangle,
  MoreVertical,
} from "lucide-react";
import { isSupervisorRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { usePlatformSettings } from "@/lib/settingsPhpApi";
import { isDarkTheme } from "@/lib/theme";
import { ThemeToggle } from "@/components/ThemeToggle";

function useIsDarkTheme() {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined" ? isDarkTheme() : true
  );
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setIsDark(isDarkTheme());
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(el, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => mo.disconnect();
  }, []);
  return isDark;
}

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  id: string;
};

function AdminNavLinks({
  items,
  location,
  onNavigate,
}: {
  items: NavItem[];
  location: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {items.map((item) => {
        const isActive =
          location === item.href ||
          (location.startsWith(item.href + "/") && item.href !== "/admin");

        return (
          <Link key={item.href} href={item.href} onClick={onNavigate}>
            <div
              data-testid={`link-admin-${item.id}`}
              className={[
                "flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-lg)] cursor-pointer",
                "transition-all duration-[var(--dur-fast)] text-sm font-medium border-r-[3px]",
                isActive
                  ? "bg-card text-card-foreground shadow-[var(--shadow-sm)] border-r-[hsl(var(--primary))]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] border-r-transparent",
              ].join(" ")}
            >
              <item.icon
                className={[
                  "h-4 w-4 shrink-0",
                  isActive ? "text-[hsl(var(--primary))]" : "opacity-90",
                ].join(" ")}
              />
              <span className="min-w-0 truncate">{item.label}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const logout = useLogout();
  const { data: session } = useGetMe();
  const isDark = useIsDarkTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        window.location.href = "/login";
      },
    });
  };

  const supervisor = isSupervisorRole(session?.user?.role);

  const navItems: NavItem[] = [
    { href: "/admin", label: "نظرة عامة", icon: Home, id: "overview" },
    { href: "/admin/users", label: "إدارة المشاركين", icon: Users, id: "users" },
    { href: "/admin/curriculum", label: "المنهج الدراسي", icon: BookOpen, id: "curriculum" },
    { href: "/admin/batches", label: "الدفعات", icon: Layers, id: "batches" },
    { href: "/admin/strugglers", label: "المتعثرون", icon: AlertTriangle, id: "strugglers" },
    { href: "/admin/analytics", label: "الإحصائيات", icon: BarChart3, id: "analytics" },
    { href: "/admin/settings", label: "الإعدادات", icon: Settings, id: "settings" },
    ...(supervisor
      ? [{ href: "/admin/supervisors", label: "إدارة المشرفين", icon: Shield, id: "supervisors" }]
      : []),
  ];

  const brandBlock = (
    <div className="flex flex-col items-center gap-1 min-w-0">
      <img
        src={isDark ? "/brand/logo-full-white.png" : "/brand/logo-full-dark.png"}
        alt="ثراء المعرفة"
        className="h-12 sm:h-14 w-auto max-w-[220px] object-contain"
      />
      <p className="text-[11px] sm:text-xs text-[var(--text-secondary)] leading-none">
        {supervisor ? "لوحة السوبرفايزر" : "لوحة المشرف"}
      </p>
    </div>
  );

  const footerBlock = (
    <div className="p-4 border-t border-[var(--border-default)]">
      <div
        className="mb-3 px-2 text-sm text-[var(--text-secondary)] font-medium"
        data-testid="text-username"
      >
        {session?.user?.name}
      </div>
      <Button
        data-testid="button-logout"
        variant="ghost"
        className="w-full justify-start gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] text-sm"
        onClick={handleLogout}
      >
        <LogOut className="h-4 w-4" />
        تسجيل الخروج
      </Button>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground flex-col md:flex-row font-sans" dir="rtl">
      {/* شريط علوي للجوال */}
      <header className="md:hidden sticky top-0 z-40 flex items-center justify-between gap-3 px-4 py-3 bg-[var(--bg-primary)] border-b border-[var(--border-default)]">
        <img
          src={isDark ? "/brand/logo-full-white.png" : "/brand/logo-full-dark.png"}
          alt="ثراء المعرفة"
          className="h-10 w-auto max-w-[160px] object-contain"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="min-h-10 min-w-10"
          aria-label="فتح القائمة"
          onClick={() => setMobileOpen(true)}
        >
          <MoreVertical className="h-5 w-5" />
        </Button>
      </header>

      {/* درج الجوال */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="right"
          className="w-[min(100%,20rem)] p-0 bg-[var(--bg-primary)] flex flex-col"
        >
          <SheetHeader className="p-5 border-b border-[var(--border-default)] text-center space-y-0">
            <SheetTitle className="sr-only">القائمة الرئيسية</SheetTitle>
            {brandBlock}
          </SheetHeader>
          <nav className="flex-1 p-3 flex flex-col gap-3 overflow-y-auto">
            <div className="px-2 pt-1">
              <p className="text-[11px] font-semibold tracking-wide text-[var(--text-secondary)] opacity-90">
                القائمة الرئيسية
              </p>
            </div>
            <AdminNavLinks
              items={navItems}
              location={location}
              onNavigate={() => setMobileOpen(false)}
            />
          </nav>
          {footerBlock}
        </SheetContent>
      </Sheet>

      {/* شريط سطح المكتب الثابت */}
      <aside className="hidden md:flex w-64 flex-col shrink-0 bg-[var(--bg-primary)] border-l border-[var(--border-default)]">
        <div className="p-5 border-b border-[var(--border-default)]">{brandBlock}</div>
        <nav className="flex-1 p-3 flex flex-col gap-3">
          <div className="px-2 pt-1">
            <p className="text-[11px] font-semibold tracking-wide text-[var(--text-secondary)] opacity-90">
              القائمة الرئيسية
            </p>
          </div>
          <AdminNavLinks items={navItems} location={location} />
        </nav>
        {footerBlock}
      </aside>

      <main className="flex-1 p-4 md:p-8 overflow-y-auto min-w-0 text-right">
        <div className="max-w-6xl mx-auto">{children}</div>
      </main>
    </div>
  );
}

export function StudentLayout({ children }: { children: React.ReactNode }) {
  const logout = useLogout();
  const { data: session } = useGetMe();
  const { data: settings, isLoading: isSettingsLoading } = usePlatformSettings();
  const isDark = useIsDarkTheme();

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        window.location.href = "/login";
      },
    });
  };

  if (isSettingsLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center font-sans" dir="rtl">
        <span className="animate-pulse text-[var(--text-secondary)]">جاري التحميل...</span>
      </div>
    );
  }

  if (settings?.maintenanceMode) {
    return (
      <div
        className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center relative overflow-hidden font-sans"
        dir="rtl"
      >
        <div
          className="absolute inset-0 z-0 opacity-10 pointer-events-none"
          style={{
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            backgroundSize: "600px",
          }}
        />

        <div className="relative z-10 max-w-md w-full bg-[var(--bg-primary)] border border-[var(--border-default)] p-8 rounded-[var(--radius-xl)] shadow-[var(--shadow-xl)] flex flex-col items-center">
          <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6 bg-[var(--error-50)]">
            <ShieldAlert className="w-10 h-10 text-[var(--error-600)]" />
          </div>

          <h1 className="text-3xl font-bold mb-3 text-[var(--secondary-400)]">المنصة تحت الصيانة</h1>

          <p className="text-[var(--text-secondary)] text-sm leading-relaxed mb-8">
            نعتذر منك يا {session?.user?.name}، المنصة تخضع لبعض التحديثات التقنية حاليا لتحسين تجربتكم. يرجى العودة لاحقا.
          </p>

          <Button
            onClick={handleLogout}
            variant="outline"
            className="w-full rounded-[var(--radius-md)] border-[var(--border-default)] hover:bg-[var(--bg-tertiary)]"
          >
            تسجيل الخروج
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col relative font-sans" dir="rtl">
      <div
        className="fixed inset-0 z-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          backgroundSize: "400px",
        }}
      />

      <header className="relative z-10 bg-[var(--bg-primary)] border-b border-[var(--border-default)]">
        <div className="max-w-5xl mx-auto px-4 py-3 flex justify-between items-center gap-4">
          <div className="flex flex-col items-start gap-1 min-w-0">
            <img
              src={isDark ? "/brand/logo-full-white.png" : "/brand/logo-full-dark.png"}
              alt="ثراء المعرفة"
              className="h-12 sm:h-14 md:h-16 w-auto max-w-[min(100%,280px)] object-contain object-right"
            />
            <p className="text-[11px] sm:text-xs text-[var(--text-secondary)] leading-none">
              بوابة المشارك
            </p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <ThemeToggle />
            <span
              className="text-sm font-medium text-[var(--text-primary)]/80 hidden sm:block"
              data-testid="text-username"
            >
              {session?.user?.name}
            </span>
            <Button
              data-testid="button-logout"
              variant="ghost"
              size="sm"
              className="gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-[var(--radius-md)]"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">خروج</span>
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-5xl mx-auto w-full p-4 md:p-6 relative z-10">
        {children}
      </main>
    </div>
  );
}
