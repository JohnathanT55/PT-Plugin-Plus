import { MV3Request, MV3Response } from "../messages/protocol";

const OFFSCREEN_PATH = "offscreen.html";
let creatingDocument: Promise<void> | undefined;

function runtimeApi(): any {
  return chrome.runtime as any;
}

function offscreenApi(): any {
  return (chrome as any).offscreen;
}

async function documentExists(): Promise<boolean> {
  const runtime = runtimeApi();
  if (typeof runtime.getContexts === "function") {
    const contexts = await runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [runtime.getURL(OFFSCREEN_PATH)]
    });
    return contexts.length > 0;
  }
  const offscreen = offscreenApi();
  return typeof offscreen.hasDocument === "function"
    ? offscreen.hasDocument()
    : false;
}

export async function ensureOffscreenDocument(): Promise<void> {
  if (await documentExists()) {
    return;
  }
  if (!creatingDocument) {
    creatingDocument = offscreenApi()
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: ["DOM_PARSER", "CLIPBOARD", "BLOBS"],
        justification:
          "Parse tracker pages and perform Blob/clipboard work outside the MV3 service worker"
      })
      .then(() => undefined)
      .finally(() => {
        creatingDocument = undefined;
      });
  }
  await creatingDocument;
}

export async function sendToOffscreen<T extends MV3Response>(
  request: MV3Request
): Promise<T> {
  await ensureOffscreenDocument();
  return new Promise<T>((resolve, reject) => {
    chrome.runtime.sendMessage(request, (response: T) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}
