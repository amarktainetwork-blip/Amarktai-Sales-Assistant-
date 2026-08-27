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
import CompanyIntelligence from "./pages/CompanyIntelligence";
import CompanySetup from "./pages/CompanySetup";
import Calls from "./pages/Calls";
import PricingPage from "./marketing/PricingPage";
import HomePage from "./marketing/HomePage";

function MetadataSync() {
  const [location] = useLocation();
  useEffect(() => {
    const pathname = location.split(/[?#]/, 1)[0];
    const metadata = publicPageMetadata[pathname];
    if (!metadata) return;
    document.title = metadata.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) description.content = metadata.description;
  }, [location]);
  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="system">
        <TooltipProvider>
          <MetadataSync />
          <Switch>
            <Route path="/" component={HomePage} />
            <Route path="/product" component={ProductPage} />
            <Route path="/how-it-works" component={HowItWorksPage} />
            <Route path="/individuals" component={IndividualsPage} />
            <Route path="/teams" component={TeamsPage} />
            <Route path="/integrations" component={IntegrationsPage} />
            <Route path="/pricing" component={PricingPage} />
            <Route path="/contact" component={ContactPage} />
            <Route path="/auth" component={Auth} />
            <Route path="/onboarding" component={Onboarding} />
            <Route path="/dashboard" component={Today} />
            <Route path="/today" component={Today} />
            <Route path="/customers" component={Customers} />
            <Route path="/calls" component={Calls} />
            <Route path="/live-calls" component={LiveCalls} />
            <Route path="/agents" component={AgentDesk} />
            <Route path="/assistant" component={AgentDesk} />
            <Route path="/command-centre" component={CommandCentre} />
            <Route path="/knowledge" component={KnowledgeHub} />
            <Route path="/workflows" component={WorkflowStudio} />
            <Route path="/automation" component={SalesAutomation} />
            <Route path="/reports" component={Reports} />
            <Route path="/team" component={TeamManagement} />
            <Route path="/team-intelligence" component={TeamIntelligence} />
            <Route path="/connections" component={ConnectionsV2} />
            <Route path="/crm" component={CrmWorkspace} />
            <Route path="/company-intelligence" component={CompanyIntelligence} />
            <Route path="/company-setup" component={CompanySetup} />
            <Route path="/admin" component={AdminControls} />
            <Route path="/settings" component={Home} />
            <Route path="/billing" component={Pricing} />
            <Route component={NotFound} />
          </Switch>
          <Toaster richColors />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
