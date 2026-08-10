import { resolveDownloadTarget } from "../model/downloadTarget";
import {
  BackgroundRequest,
  MV3Response,
  ResolveDownloadTargetRequest,
  errorResponse
} from "../messages/protocol";
import { MV3Repository } from "../storage/repository";

function isBackgroundRequest(value: any): value is BackgroundRequest {
  return (
    !!value &&
    (value.type === "ptpp.runtime.status" ||
      value.type === "ptpp.download-target.resolve")
  );
}

export function registerMessageRouter(repository: MV3Repository) {
  chrome.runtime.onMessage.addListener(
    (request: any, sender: chrome.runtime.MessageSender, sendResponse: Function) => {
      if (!isBackgroundRequest(request)) {
        return false;
      }

      if (sender.id && sender.id !== chrome.runtime.id) {
        sendResponse(errorResponse("forbidden", "Unknown extension sender"));
        return false;
      }

      repository
        .initialize()
        .then(state => {
          let response: MV3Response;
          if (request.type === "ptpp.runtime.status") {
            response = {
              ok: true,
              data: {
                schemaVersion: state.metadata.schemaVersion,
                migratedAt: state.metadata.legacyImportedAt,
                warningCount: state.metadata.warnings.length
              }
            };
          } else {
            const resolveRequest = request as ResolveDownloadTargetRequest;
            response = {
              ok: true,
              data: resolveDownloadTarget(
                resolveRequest.siteId,
                resolveRequest.downloaderId,
                state.siteDownloadProfiles,
                state.downloaders,
                state.settings
              )
            };
          }
          sendResponse(response);
        })
        .catch(error =>
          sendResponse(errorResponse("background-request-failed", error))
        );
      return true;
    }
  );
}
