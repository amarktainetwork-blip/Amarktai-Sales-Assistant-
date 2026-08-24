import "dotenv/config";
import { verifyVoiceAcceptance } from "./voice/acceptance";

verifyVoiceAcceptance()
  .then(result => {
    console.log(JSON.stringify({ event: "voice_acceptance", status: "LIVE_PROVEN", result }, null, 2));
  })
  .catch(error => {
    console.error(JSON.stringify({ event: "voice_acceptance", status: "FAILED", reason: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  });
