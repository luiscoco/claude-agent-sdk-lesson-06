# Lesson 6 classroom walkthrough

**MCP, Subagents and Sessions · SDK 0.3.310**

Allow 30–40 minutes. The transport lab and labeled recorded fixtures need no model account. Live workflows use your own server-side key.

## 1. Connect the same capability two ways

Inspect the SDK-hosted transport, then stdio. Identify `get_project_note` in raw MCP discovery and `mcp__project__get_project_note` in query registration.

**Explain:** SDK-hosted tools run in the application process; stdio communicates with a separate local process. HTTP/SSE are remote configuration examples only here. The UI's live event stream is separate from MCP SSE transport.

Read `mcp.ts` and `mcp-stdio.ts`. Find the positional tool contract, fixed file enum, real-path check, and MCP content envelope. Do not write console banners to a stdio server's stdout.

## 2. Inspect and organize a recorded conversation

Load a recorded fixture in the session library. Confirm the **RECORDED FIXTURE · NO MODEL RUN** label. Read its two messages and the codeword ORBIT-42.

Rename it and apply a tag. Refresh the library and verify the metadata persists. These are actual SDK history operations against a private adapter, not model queries.

**Version note:** The workshop deliberately adopts the pinned alpha SessionStore interface for scoping. Its recorded entries are a version-pinned fixture, not a supported production transcript schema. Live entries pass through the adapter unchanged.

## 3. Branch without replacing the source

Fork the recorded conversation and give the branch a distinct title. Compare IDs, messages, and the parent label. Select the original again and verify it still has its conversation.

Delete the branch only after reviewing the exact title and UUID in the confirmation. Check the original remains.

**Explain:** A fork copies conversation context into a new identity. It does not undo file changes or copy file-history checkpoints. Deleting through this SessionStore removes the workshop mirror; the SDK's separate ignored local copy remains.

## 4. Create and resume real work

With your own key configured, create a live session using either executable transport. Inspect the initialization, `setMcpServers`, connection status, and `supportedAgents` events.

Find the live session in the library and ask what project and codeword were discussed. Resume should continue the same identity and remember Aurora Tasks / ORBIT-42.

Fork that live session, then resume the fork with an alternative next-step question. Reopen the source to verify the branch's extra conversation did not replace the original.

## 5. Separate discovery from delegation

Run **Delegate a risk review**. Observe the actual Agent request and `SubagentStart`. Compare one discovered specialist with the actual start counter.

Open the saved session, expand specialist history, and read the separate transcript.

**Explain:** `agents` defines the specialist, `supportedAgents()` discovers availability, and the Agent tool actually delegates. The specialist has its own instructions and only the bounded project MCP capability. This lab permits one invocation and no recursive delegation.

## 6. Trace ownership and cleanup

Read `history.ts` and `store.ts`. Locate the explicit `sessionStore` and fixed `dir` passed to each SDK history API. Follow the separate ownership registry check before any read, mutation, or live resume.

Stop an active workflow. Explain why cancellation closes active resources while saved history remains. If the response ends before a final report, execution counters are unknown rather than proof that nothing happened.

## Student extension

Add a second read-only specialist that summarizes storage risks. Make its available tools explicit, update the allowed delegation policy deliberately, and test that discovery still does not increment execution counters. Keep the history adapter scoped to this workshop.

## Exit questions and answers

1. When is stdio useful? **For a local tool process communicating over stdin/stdout.**
2. What does an SDK-hosted server expose? **Application-defined capabilities through MCP.**
3. Subagent discovery versus tool discovery? **Specialized agent availability versus connected server/tool capabilities. Neither is execution.**
4. Why fork? **To explore another conversation branch while retaining the source context.**

Complete the in-app knowledge check and export a live workflow trace if you ran one.
