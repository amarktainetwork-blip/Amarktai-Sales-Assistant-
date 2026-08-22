import { runDueDailyReports } from "./dailyReports";

runDueDailyReports()
  .then(outcomes => {
    console.log(JSON.stringify({ ranAt: new Date().toISOString(), outcomes }));
  })
  .catch(error => {
    console.error("Manual daily report run failed", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  });
