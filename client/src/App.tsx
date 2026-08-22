import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import AdminControls from "./pages/AdminControls";
import Auth from "./pages/Auth";
import ConnectionsV2 from "./pages/ConnectionsV2";
import Dashboard from "./pages/Dashboard";
import Home from "./pages/Home";
import LiveCalls from "./pages/LiveCalls";
import Onboarding from "./pages/Onboarding";
import Pricing from "./pages/Pricing";
import SalesAutomation from "./pages/SalesAutomation";
import TeamIntelligence from "./pages/TeamIntelligence";
import TeamManagement from "./pages/TeamManagement";
import Today from "./pages/Today";
import { AgentDesk, CommandCentre, KnowledgeHub, WorkflowStudio } from "./pages/Workspace";

function Router() {
  return <Switch>
    <Route path="/" component={Home} />
    <Route path="/pricing" component={Pricing} />
    <Route path="/auth" component={Auth} />
    <Route path="/dashboard" component={Dashboard} />
    <Route path="/today" component={Today} />
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
    <Route path="/company-setup" component={Onboarding} />
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch>;
}

function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><Toaster /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}

export default App;
