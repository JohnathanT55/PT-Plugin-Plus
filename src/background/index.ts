import { MV3_SCHEMA_VERSION } from "../model/schema";
import { MV3Repository } from "../storage/repository";
import { configureAlarms, handleAlarm } from "./alarms";
import { registerMessageRouter } from "./router";

const repository = new MV3Repository();

async function initializeRuntime(configureSchedules: boolean = false) {
  const state = await repository.initialize();
  if (configureSchedules) {
    configureAlarms(state.settings);
  }
  return state;
}

// Register every listener synchronously. MV3 may terminate this worker between
// events, so durable state is always rehydrated through the repository.
registerMessageRouter(repository);

chrome.runtime.onInstalled.addListener(() => {
  initializeRuntime(true).catch(error => console.error("MV3 install failed", error));
});

chrome.runtime.onStartup.addListener(() => {
  initializeRuntime(true).catch(error => console.error("MV3 startup failed", error));
});

chrome.alarms.onAlarm.addListener(alarm => {
  handleAlarm(alarm).catch(error => console.error("MV3 alarm failed", error));
});

const action = (chrome as any).action;
if (action && action.onClicked) {
  action.onClicked.addListener(() => {
    console.info(
      "PTPP MV3 foundation is active (schema " + MV3_SCHEMA_VERSION + ")"
    );
  });
}

initializeRuntime().catch(error => console.error("MV3 init failed", error));
