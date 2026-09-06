import AppShell from "../../components/AppShell";
import StrategyWorkspace from "../../components/StrategyWorkspace";

export default function AnomalyPage() {
  return <AppShell title="A档异动扫描" eyebrow="STRATEGY WORKSPACE / 01"><StrategyWorkspace mode="anomaly" /></AppShell>;
}
