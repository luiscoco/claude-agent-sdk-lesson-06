# Manual live verification

Verified on **2 November 2026**, Windows, Node.js 24, SDK **0.3.310**, using **claude-haiku-5-5** and a locally configured server-side key. No credential or raw environment data is included here.

`npm run live:smoke -- --all` completed four actual SDK queries and private history operations:

| Step                        | Observed evidence                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New SDK-hosted conversation | The retained query initialized, dynamically attached the project server, inspected connected status, discovered risk-reviewer, and read a project note. |
| Resume                      | The same session remembered Aurora Tasks and ORBIT-42 without another tool read.                                                                        |
| Rename and tag              | Actual SDK metadata operations updated the owned session.                                                                                               |
| Fork and resume fork        | The new ID continued the copied context, while the source message count stayed unchanged.                                                               |
| Delegated stdio review      | The local stdio MCP server connected; one risk-reviewer actually started and completed a project-note read.                                             |
| Specialist history          | listSubagents and getSubagentMessages returned a non-empty specialist transcript from the private mirror.                                               |
| Delete owned fork           | The test-created mirrored fork was removed; the original remained in the library.                                                                       |

Both local transport inspections also completed actual MCP initialize/list/call exchanges without a model request. Recorded fixtures support real SDK history operations but remain explicitly labeled as fixtures.

These are manual observations, not fixed expected model wording, token counts, or billing totals. Automated tests use real local MCP and SDK history operations plus injected query handles; they do not use model credentials.

A real SDK-hosted delegation was also verified through the browser: one specialist start, one completed tool read, and one readable specialist transcript. Direct development-server requests for .env and the private history registry returned HTTP 403.
