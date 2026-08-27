import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { publicPageMetadata } from "@/marketing/site";
import NotFound from "@/pages/NotFound";
import { useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import "./app-final.css";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import "./dashboard-v2.css";
import "./dashboard-v3.css";
import "./dashboard-handover.css";
import "./dashboard-v6.css";
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
import Auth from "./pages/Auth";
import ConnectionsV2 from "./pages/ConnectionsV2";
import CrmWorkspace from "./pages/CrmWorkspace";
import Customers from "./pages/Customers";
import Home from "./pages/Home";
import LiveCalls from "./pages/LiveCalls";
import Onboarding from "./pages/Onboarding";
import Pricing from "./pages/Pricing";
import Reports from "./pages/Reports";
import SalesAutomation from "./pages/SalesAutomation";
import TeamIntelligence from "./pages/TeamIntelligence";
import TeamManagement from "./pages/TeamManagement";
import Today from "./pages/Today";
import {
  AgentDesk,
  CommandCentre,
  KnowledgeHub,
  WorkflowStudio,
} from "./pages/Workspace";

function Router() {
  return (
    <>
      <PageMetadata />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/product" component={ProductPage} />
        <Route path="/how-it-works" component={HowItWorksPage} />
        <Route path="/individuals" component={IndividualsPage} />
        <Route path="/teams" component={TeamsPage} />
        <Route path="/integrations" component={IntegrationsPage} />
        <Route path="/pricing" component={Pricing} />
        <Route path="/about" component={AboutPage} />
        <Route path="/contact" component={ContactPage} />
        <Route path="/auth" component={Auth} />
        <Route path="/dashboard" component={Today} />
        <Route path="/today" component={Today} />
        <Route path="/sell" component={Today} />
        <Route path="/customers" component={Customers} />
        <Route path="/reports" component={Reports} />
        <Route path="/automation" component={SalesAutomation} />
        <Route path="/team" component={TeamIntelligence} />
        <Route path="/team/manage" component={TeamManagement} />
        <Route path="/admin-controls" component={AdminControls} />
        <Route path="/workspace" component={CommandCentre} />
        <Route path="/workflows" component={WorkflowStudio} />
        <Route path="/agents" component={AgentDesk} />
        <Route path="/calls" component={LiveCalls} />
        <Route path="/knowledge" component={KnowledgeHub} />
        <Route path="/connections" component={ConnectionsV2} />
        <Route path="/crm/:connectedSystemId" component={CrmWorkspace} />
        <Route path="/crm" component={CrmWorkspace} />
        <Route path="/company-setup" component={Onboarding} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

function PageMetadata() {
  const [location] = useLocation();
  useEffect(() => {
    const metadata =
      publicPageMetadata[location] ??
      (location === "/auth"
        ? {
            title: "Sign In | Amarktai Sales Assistant",
            description:
              "Sign in to the protected Amarktai Sales Assistant workspace.",
          }
        : {
            title: "Amarktai Sales Assistant | Part of Amarktai Network",
            description: "Open the protected Amarktai Sales Assistant workspace.",
          });
    document.title = metadata.title;
    let tag = document.querySelector<HTMLMetaElement>('meta[name="description"]');
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
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
