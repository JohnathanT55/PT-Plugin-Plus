import {
  MV3Response,
  OffscreenRequest,
  errorResponse
} from "../messages/protocol";

function isOffscreenRequest(value: any): value is OffscreenRequest {
  return !!value && typeof value.type === "string" && value.type.indexOf("ptpp.offscreen.") === 0;
}

async function handleRequest(request: OffscreenRequest): Promise<MV3Response> {
  switch (request.type) {
    case "ptpp.offscreen.ping":
      return { ok: true, data: { alive: true } };
    case "ptpp.offscreen.parse-html": {
      const document = new DOMParser().parseFromString(request.html, "text/html");
      return {
        ok: true,
        data: {
          title: document.title || "",
          text: document.body ? document.body.textContent || "" : ""
        }
      };
    }
    case "ptpp.offscreen.clipboard-write":
      await navigator.clipboard.writeText(request.text);
      return { ok: true, data: { written: true } };
  }
}

chrome.runtime.onMessage.addListener(
  (request: any, _sender: chrome.runtime.MessageSender, sendResponse: Function) => {
    if (!isOffscreenRequest(request)) {
      return false;
    }
    handleRequest(request)
      .then(response => sendResponse(response))
      .catch(error => sendResponse(errorResponse("offscreen-request-failed", error)));
    return true;
  }
);
