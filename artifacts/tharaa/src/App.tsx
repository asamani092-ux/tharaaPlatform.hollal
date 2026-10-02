import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { useGetMe } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { homePathForRole, isStaffRole, isSupervisorRole } from "@/lib/roles";

import Login from "@/pages/login";
import StudentPortal from "@/pages/student/index";
import SubmitLog from "@/pages/student/submit";
import AdminDashboard from "@/pages/admin/index";
import AdminUsers from "@/pages/admin/users";
import AdminAnalytics from "@/pages/admin/analytics";
import AdminStrugglers from "@/pages/admin/strugglers";
import AdminCurriculum from "@/pages/admin/curriculum";
import AdminSettings from "@/pages/admin/settings";
import AdminBatches from "@/pages/admin/batches";
import AdminSupervisors from "@/pages/admin/supervisors";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function AuthLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-12 h-12 animate-spin text-primary" />
    </div>
  );
}

function AuthGuard({
  children,
  requireRole,
}: {
  children: React.ReactNode;
  requireRole?: "staff" | "student" | "supervisor";
}) {
  const { data: session, isLoading } = useGetMe();
  const [location, setLocation] = useLocation();
  const isAuthenticated = !!session?.authenticated;
  const role = session?.user?.role;

  useEffect(() => {
    if (isLoading) return;

    const go = (to: string) => {
      if (location !== to) setLocation(to);
    };

    if (!isAuthenticated) {
      go("/login");
      return;
    }

    if (location === "/login") {
      go(homePathForRole(role));
      return;
    }

    if (requireRole === "staff" && !isStaffRole(role)) {
      go(homePathForRole(role));
      return;
    }

    if (requireRole === "supervisor" && !isSupervisorRole(role)) {
      go(homePathForRole(role));
      return;
    }

    if (requireRole === "student" && role !== "student") {
      go(homePathForRole(role));
      return;
    }

    if (location === "/") {
      go(homePathForRole(role));
    }
  }, [isLoading, isAuthenticated, role, location, requireRole, setLocation]);

  if (isLoading) return <AuthLoading />;

  if (!isAuthenticated && location !== "/login") return <AuthLoading />;

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login">
        <AuthGuard>
          <Login />
        </AuthGuard>
      </Route>

      <Route path="/student">
        <AuthGuard requireRole="student">
          <StudentPortal />
        </AuthGuard>
      </Route>
      <Route path="/student/submit">
        <AuthGuard requireRole="student">
          <SubmitLog />
        </AuthGuard>
      </Route>

      <Route path="/admin">
        <AuthGuard requireRole="staff">
          <AdminDashboard />
        </AuthGuard>
      </Route>
      <Route path="/admin/users">
        <AuthGuard requireRole="staff">
          <AdminUsers />
        </AuthGuard>
      </Route>
      <Route path="/admin/analytics">
        <AuthGuard requireRole="staff">
          <AdminAnalytics />
        </AuthGuard>
      </Route>
      <Route path="/admin/strugglers">
        <AuthGuard requireRole="staff">
          <AdminStrugglers />
        </AuthGuard>
      </Route>
      <Route path="/admin/curriculum">
        <AuthGuard requireRole="staff">
          <AdminCurriculum />
        </AuthGuard>
      </Route>
      <Route path="/admin/settings">
        <AuthGuard requireRole="staff">
          <AdminSettings />
        </AuthGuard>
      </Route>
      <Route path="/admin/batches">
        <AuthGuard requireRole="staff">
          <AdminBatches />
        </AuthGuard>
      </Route>
      <Route path="/admin/supervisors">
        <AuthGuard requireRole="supervisor">
          <AdminSupervisors />
        </AuthGuard>
      </Route>

      <Route path="/">
        <AuthGuard>
          <div />
        </AuthGuard>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster position="top-center" dir="rtl" richColors theme="dark" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
