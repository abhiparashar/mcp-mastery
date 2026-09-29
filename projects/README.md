# Projects

Projects are grouped by **the level that unlocks them**, so you always build immediately
after learning the concept. Size is a badge, not a grouping: `[S]` small (half a day to two
days), `[M]` medium (one to two weeks), `[L]` large capstone (three to six weeks).

Want to build first and learn the internals after? Use the
[top-down track](./top-down-track.md) instead of the table below. It points back here.
For big LiteLLM + MCP systems with production failure drills, see the
[production track](./production-track.md).

## Order of play

| Build after | File | Projects |
| --- | --- | --- |
| [L1 Protocol core](../roadmap/01-protocol-core.md) | [after-l1-foundations.md](./after-l1-foundations.md) | `[S]` S04 Bare-Metal JSON-RPC, `[S]` S06 Tiny Client CLI |
| [L2 Server primitives](../roadmap/02-server-primitives.md) | [after-l2-primitives.md](./after-l2-primitives.md) | `[S]` S01 Hello Tools, `[S]` S02 Notes Resources, `[S]` S03 Prompt Pack, `[M]` M01 Read-Only DB Gateway |
| [L3 Transports](../roadmap/03-transports.md) | [after-l3-transports.md](./after-l3-transports.md) | `[S]` S05 Streamable HTTP Deploy, `[S]` S07 Progress and Cancel, `[S]` S08 Subscriptions Watcher |
| [L4 Clients and hosts](../roadmap/04-clients-and-hosts.md) | [after-l4-clients.md](./after-l4-clients.md) | `[S]` S09 MRTR Elicitation, `[M]` M05 MCP Gateway/Router |
| [L5 Auth and security](../roadmap/05-auth-and-security.md) | [after-l5-security.md](./after-l5-security.md) | `[M]` M02 OAuth-Protected Remote Server, `[S]` S10 Server Smoke Suite |
| [L6 Production and scale](../roadmap/06-production-and-scale.md) | [after-l6-production.md](./after-l6-production.md) | `[M]` M06 Production Hardening Pack |
| [L7 Extensions and frontier](../roadmap/07-extensions-and-frontier.md) | [after-l7-frontier.md](./after-l7-frontier.md) | `[M]` M03 Long Jobs With the Tasks Extension, `[M]` M04 MCP App UI |
| Any level from L4 onward | [capstones.md](./capstones.md) | `[L]` L01 ContextOS, `[L]` L02 Protocol From Scratch, `[L]` L03 AgentBench, `[L]` L04 SecureMCP, `[L]` L05 Upstream Impact |

Each capstone states which level it needs. Never run two capstones at once.

## How every project is specified

- **Unlocked after** - the level whose concepts it exercises.
- **Goal** - one sentence, plain words.
- **Requirements** - the must-haves. Skipping one means the project is not done.
- **Acceptance** - observable proof. Something you can demo, not "it works on my machine".
- **Stretch** - optional, where the real learning usually is.
- **Mastery marker** - the detail that separates this from a tutorial copy.

## Rules that make projects count

1. **Write the README first.** Goal, tool list with rationale, protocol revisions
   supported, limits. If the README is vague, the server will be too.
2. **Hand-roll one layer per project.** Never let the SDK do the thing you are trying to
   learn.
3. **Break it before you ship it.** Every project ends with a "how I broke it" section:
   malformed `_meta`, mismatched version header, killed stream, tampered `requestState`.
4. **Numbers or it did not happen.** Tool-selection accuracy, `tools/list` token size, p95
   latency, cache hit rate. Put them in the README.
5. **Ship it public.** A repo with a README, tests in CI, and a one-paragraph design
   rationale. Private practice does not build reputation.
6. **Run the conformance suite** ([S10](./after-l5-security.md#s10--server-smoke-suite))
   against every server you build from then on.
