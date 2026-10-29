# Local model and connector setup repair

## Intent and scope

Make local Cloud OS usable from an embedded/mobile browser for the existing prompt-to-UI MCP gadget workflow. The observed defects are an OpenAI base URL lacking `/v1`, a case-sensitive model identifier entered incorrectly, and blank popups blocked by T3. Success requires an actual model response, authorized catalog/tool access, and a visibly rendered gadget; these are separate proofs.

Work in the existing TheLobbi/cloudflare-os fork, in an isolated checkout. Do not patch the deployment submodule or installed T3. Do not deploy to production, change firewall rules, copy browser sessions, bypass authentication, or silently retarget stored credentials. Full-send authorizes implementation and review/merge decisions; choices below are the acting agent's defaults, not prior user design decisions.

## Approaches and decision

1. Manual repair plus external Chrome: smallest operational workaround, but repeats URL/credential setup and does not serve mobile embedded browsers.
2. Patch installed T3: couples the application to a host release and leaves incorrect model settings undetected.
3. Improve Cloud OS's existing setup flows in the owned fork: chosen. Preserve the existing APIs, ticket redemption, and endpoint-bound secrets; supply a connector fallback and validate model requests before saving.

## Connector flow

Keep native authentication and supported popups as the preferred paths. When the blank popup is blocked, offer an explicit Continue in this tab action for authenticated connector setup only. Do not redirect generic sign-in: its token-receiving capability remains in the initiating live RPC session and cannot survive navigation.

The fallback uses a first-party gatekeeper URL only. Store the connect nonce, a bounded lifetime in this tab's sessionStorage immediately before navigation. No nonce or session token enters a URL, logs, remote storage, or external browser. Disown any opener before leaving. Reuse /connect/handoff and completeConnectHandoff over the returning browser's normally authenticated session; server-side ticket/nonce/identity and reconnect staging checks remain authoritative. On successful redemption return to the fixed `/gatekeepers` route rather than closing the tab. On failure show the existing failure and a safe return action. Consume the client record once, strip the ticket fragment, expire abandoned records, and remove stale records on normal app entry before additional windows can inherit them. Cancellation leaves no completion claim. Do not auto-connect or make resources ambient.

The fallback must not discard an in-progress form or pretend to resume an unpersisted operation. Offer it from the Connectors setup surface and explain that the user returns there; other call sites retain their existing behavior unless they can preserve their state. This bounds the first slice to the reported MCP setup case.

## Model flow

Test direct OpenAI-compatible models before saving through an authenticated RPC using the existing provider adapter. Send a bounded response request (up to 256 output tokens, 30-second deadline), return sanitized status/reason only, and prevent saving on failure. Preserve the exact model and endpoint. For host-only HTTP(S) URLs offer an explicit /v1 suggestion; never silently normalize URLs or model names. Endpoint-bound withheld secrets remain authoritative and a changed endpoint requires re-entry. Ignore deployment-only configuration fields exactly as saving does. Cancelled/unmounted forms cannot save after a delayed probe. A successful response test does not claim tools or gadget rendering work.

## Verification and delivery

Reproduce each original failure; test blocked-popup fallback with real browser navigation and ticket/nonce redemption; verify replay rejection, cross-origin return rejection, storage denial, expiry, cancellation, and endpoint-secret rebinding through existing focused test harnesses. Observe UI at mobile size. Run repository-required lint/build and focused regressions, measure changed shared functions with Sonar S3776 or equivalent (maximum 15), then Sol review. Open PR against the owned fork and merge only after its checks/review gates pass. Deployment adoption remains separate.

Backend work runs in Brood per workspace policy. Frontend work and its local browser runtime run on this host. If the backend environment or proof path is unavailable, retain the incomplete work and report the exact blocker without claiming the pipeline works.
