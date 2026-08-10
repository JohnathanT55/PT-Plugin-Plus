import { AppSettings } from "../model/schema";
import { sendToOffscreen } from "./offscreen";

export const ALARM_NAMES = {
  userRefresh: "ptpp.mv3.user-refresh",
  webDavBackup: "ptpp.mv3.webdav-backup"
};

function setPeriodicAlarm(
  name: string,
  enabled: boolean,
  intervalMinutes: number,
  nextRunAt?: number
) {
  if (!enabled) {
    chrome.alarms.clear(name);
    return;
  }
  const alarmInfo: chrome.alarms.AlarmCreateInfo = {
    periodInMinutes: Math.max(1, intervalMinutes)
  };
  if (nextRunAt && nextRunAt > Date.now()) {
    alarmInfo.when = nextRunAt;
  } else {
    alarmInfo.delayInMinutes = 1;
  }
  chrome.alarms.create(name, alarmInfo);
}

export function configureAlarms(settings: AppSettings) {
  setPeriodicAlarm(
    ALARM_NAMES.userRefresh,
    settings.userRefresh.enabled,
    settings.userRefresh.intervalMinutes,
    settings.userRefresh.nextRunAt
  );
  setPeriodicAlarm(
    ALARM_NAMES.webDavBackup,
    settings.webDavBackup.enabled,
    settings.webDavBackup.intervalMinutes,
    settings.webDavBackup.nextRunAt
  );
}

export async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (
    alarm.name !== ALARM_NAMES.userRefresh &&
    alarm.name !== ALARM_NAMES.webDavBackup
  ) {
    return;
  }

  // The business handlers are wired in later phases. This durable wake-up path
  // deliberately proves that DOM work can be delegated without relying on a
  // persistent background page or in-memory timer.
  const response = await sendToOffscreen({ type: "ptpp.offscreen.ping" });
  if (!response.ok) {
    throw new Error(response.error.message);
  }
}
