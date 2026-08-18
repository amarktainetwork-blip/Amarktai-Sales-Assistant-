import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Auth from "./pages/Auth";
import Connections from "./pages/Connections";
import Dashboard from "./pages/Dashboard";
import Home from "./pages/Home";
import { AgentDesk, CallDesk, CommandCentre, KnowledgeHub, WorkflowStudio } from "./pages/Workspace";

function Router() {
  return <Switch>
    <Route path="/" component={Home} />
    <Route path="/auth" component={Auth} />
    <Route path="/dashboard" component={Dashboard} />
    <Route path="/workspace" component={CommandCentre} />
    <Route path="/workflows" component={WorkflowStudio} />
    <Route path="/agents" component={AgentDesk} />
    <Route path="/calls" component={CallDesk} />
    <Route path="/knowledge" component={KnowledgeHub} />
    <Route path="/connections" component={Connections} />
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch>;
}

function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><Toaster /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}

export default App;
