import { useAuth } from "@/_core/hooks/useAuth";
import MemberOnboardingGate from "@/components/MemberOnboardingGate";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { publicPageMetadata } from "@/marketing/site";
import NotFound from "@/pages/NotFound";
import { useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { DashboardLayoutSkeleton } from "./components/DashboardLayoutSkeleton";
import { ThemeProvider } from "./contexts/ThemeContext";
import "./dashboard-final.css";
import AboutPage from "./marketing/AboutPage";
import ContactPage from "./marketing/ContactPage";
import {
  HowItWorksPage,
  IndividualsPage,
  IntegrationsPage,
  ProductPage,
  TeamsPage,
} from "./marketing/SecondaryPages";
import AdminControls from "./pages/AdminControls";
import Assistant from "./pages/Assistant";
import Auth from "./pages/Auth";
import CompanySetup from "./pages/CompanySetup";
import ConnectionsV2 from "./pages/ConnectionsV2";
import CrmWorkspace from "./pages/CrmWorkspace";
import Customers from "./pages/Customers";
import Home from "./pages/Home";
import Knowledge from "./pages/Knowledge";
import LiveCalls from "./pages/LiveCalls";
import Pricing from "./pages/Pricing";
import Reviews from "./pages/Reviews";
import Settings from "./pages/Settings";
import TeamIntelligence from "./pages/TeamIntelligence";
import TeamManagement from "./pages/TeamManagement";
import Today from "./pages/Today";

const workspacePrefixes = [
  "/dashboard",
  "/today",
  "/assistant",
  "/agents",
  "/sell",
  "/customers",
  "/calls",
  "/crm",
  "/reviews",
  "/team",
  "/settings",
  "/connections",
  "/company-setup",
  "/knowledge",
  "/admin-controls",
  "/reports",
  "/workspace",
  "/workflows",
  "/automation",
];

function LegacyRedirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => navigate(to, { replace: true }), [navigate, to]);
  return <DashboardLayoutSkeleton />;
}

function PersonalSetupBoundary() {
  const [location] = useLocation();
  const { user, loading } = useAuth();
  const security = trpc.security.status.useQuery(undefined, {
    enabled: Boolean(user),
    retry: false,
  });
  const pathname = location.split(/[?#]/, 1)[0];
  const workspace = workspacePrefixes.some(
    prefix => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (
    !workspace ||
    loading ||
    !user ||
    security.isLoading ||
    !security.data?.verified
  )
    return null;

  return <MemberOnboardingGate />;
}

function ManagementOnly({
  children,
  platformAdminOnly = false,
}: {
  children: React.ReactNode;
  platformAdminOnly?: boolean;
}) {
  const [, navigate] = useLocation();
  const { user, loading } = useAuth();
  const security = trpc.security.status.useQuery(undefined, {
    enabled: Boolean(user),
  });
  const organisation = trpc.organisation.current.useQuery(undefined, {
    enabled: Boolean(user && security.data?.verified),
    retry: false,
  });
  const allowed = platformAdminOnly
    ? user?.role === "admin"
    : organisation.data?.role === "owner" ||
      organisation.data?.role === "manager" ||
      user?.role === "admin";

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth", { replace: true });
      return;
    }
    if (!loading && user && security.data && !security.data.verified) {
      navigate("/assistant", { replace: true });
      return;
    }
    if (
      !loading &&
      user &&
      security.data?.verified &&
      !organisation.isLoading &&
      !allowed
    )
      navigate("/assistant", { replace: true });
  }, [
    allowed,
    loading,
    navigate,
    organisation.isLoading,
    security.data?.verified,
    user,
  ]);

  if (loading || security.isLoading || organisation.isLoading || !allowed)
    return <DashboardLayoutSkeleton />;
  return <>{children}</>;
}

function Router() {
  return (
    <>
      <PageMetadata />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/how-it-works" component={HowItWorksPage} />
        <Route path="/pricing" component={Pricing} />
        <Route path="/about" component={AboutPage} />
        <Route path="/contact" component={ContactPage} />
        <Route path="/product" component={ProductPage} />
        <Route path="/individuals" component={IndividualsPage} />
        <Route path="/teams" component={TeamsPage} />
        <Route path="/integrations" component={IntegrationsPage} />
        <Route path="/auth" component={Auth} />

        <Route path="/dashboard" component={Today} />
        <Route path="/today" component={Today} />
        <Route path="/assistant" component={Assistant} />
        <Route path="/agents">{() => <LegacyRedirect to="/assistant" />}</Route>
        <Route path="/sell">{() => <LegacyRedirect to="/today" />}</Route>
        <Route path="/customers" component={Customers} />
        <Route path="/calls" component={LiveCalls} />
        <Route path="/crm/:connectedSystemId" component={CrmWorkspace} />
        <Route path="/crm" component={CrmWorkspace} />
        <Route path="/reviews" component={Reviews} />

        <Route path="/team">
          {() => (
            <ManagementOnly>
              <TeamIntelligence />
            </ManagementOnly>
          )}
        </Route>
        <Route path="/team/manage">
          {() => (
            <ManagementOnly>
              <TeamManagement />
            </ManagementOnly>
          )}
        </Route>
        <Route path="/settings">
          {() => (
            <ManagementOnly>
              <Settings />
            </ManagementOnly>
          )}
        </Route>
        <Route path="/connections">
          {() => (
            <ManagementOnly>
              <ConnectionsV2 />
            </ManagementOnly>
          )}
        </Route>
        <Route path="/company-setup">
          {() => (
            <ManagementOnly>
              <CompanySetup />
            </ManagementOnly>
          )}
        </Route>
        <Route path="/knowledge">
          {() => (
            <ManagementOnly>
              <Knowledge />
            </ManagementOnly>
          )}
        </Route>
        <Route path="/admin-controls">
          {() => (
            <ManagementOnly platformAdminOnly>
              <AdminControls />
            </ManagementOnly>
          )}
        </Route>

        <Route path="/reports">{() => <LegacyRedirect to="/team" />}</Route>
        <Route path="/workspace">
          {() => <LegacyRedirect to="/assistant" />}
        </Route>
        <Route path="/workflows">
          {() => <LegacyRedirect to="/assistant" />}
        </Route>
        <Route path="/automation">
          {() => <LegacyRedirect to="/assistant" />}
        </Route>

        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

function PageMetadata() {
  const [location] = useLocation();
  useEffect(() => {
    const pathname = location.split(/[?#]/, 1)[0];
    const metadata =
      publicPageMetadata[pathname] ??
      (pathname === "/auth"
        ? {
            title: "Secure Access | AmarktAI Network Sales Assistant",
            description:
              "Sign in to the protected AmarktAI Network Sales Assistant workspace.",
          }
        : {
            title: "AmarktAI Network Sales Assistant",
            description: "Open the protected Sales Assistant workspace.",
          });
    document.title = metadata.title;
    let tag = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]'
    );
    if (!tag) {
      tag = document.createElement("meta");
      tag.name = "description";
      document.head.appendChild(tag);
    }
    tag.content = metadata.description;
  }, [location]);
  return null;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <PersonalSetupBoundary />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
