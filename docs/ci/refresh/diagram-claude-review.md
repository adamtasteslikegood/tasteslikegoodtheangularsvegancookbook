# Claude Independent-Model Review — decision flow

GitHub-renderable Mermaid source. Canonical context:
[SPEC-03-claude-independent-review.md](SPEC-03-claude-independent-review.md).

An **advisory** PR reviewer that runs in its own CI session with a **different,
cheaper model** than the authoring session (author works in Opus 4.8 / Fable 5;
reviewer uses an Opus 4.x < 4.8) — breaking the self-review monoculture at lower
cost. It reasons about scope, picks the review skill + reasoning effort, applies
fixes, and leaves a comment per fix. It is **never** a required check
(SPEC-02 rule 1) and **fails open**.

```mermaid
flowchart TD
    PR[PR opened / ready / labeled 'claude-review'] --> GUARD{same-repo &&<br/>not bot/Dependabot &&<br/>not draft?}
    GUARD -->|no| SKIP([skip cleanly — no secrets on forks])
    GUARD -->|yes| PICK["Pick model (deterministic):<br/>vars.CLAUDE_REVIEW_MODEL,<br/>default claude-opus-4-7<br/>(≠ authoring 4.8 / Fable 5 → cheaper + independent)"]
    PICK --> DIFF["Read the diff vs base branch"]
    DIFF --> REASON{"Reason about scope + risk"}
    REASON -->|"small / low-risk"| EFFLOW["effort: low–medium<br/>skill: /code-review"]
    REASON -->|"large / core logic"| EFFHIGH["effort: high–max<br/>skill: /code-review"]
    REASON -->|"touches auth / secrets /<br/>Dockerfile / deps / validation"| SEC["+ /security-review"]
    EFFLOW & EFFHIGH & SEC --> RUN["Run review --fix<br/>(apply fixes to working tree)"]
    RUN --> HASFIX{Fixes applied?}
    HASFIX -->|yes| PUSH["Commit + push to PR branch<br/>+ post ONE comment per fix<br/>(inline where possible)"]
    HASFIX -->|no| NOTE["Post 'no changes needed' note"]
    PUSH --> DONE([advisory result — never blocks merge])
    NOTE --> DONE
    style GUARD fill:#1d4ed8,color:#fff
    style DONE fill:#2d6a4f,color:#fff
    style SKIP fill:#6b7280,color:#fff
```

**Cost controls:** runs once per PR (`opened` / `ready_for_review`), on-demand via
the `claude-review` label or `workflow_dispatch` — **not** on every `synchronize`
push; `concurrency` cancels superseded runs; the model is always the cheaper
Opus 4.x tier.
