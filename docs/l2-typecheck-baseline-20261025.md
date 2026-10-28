# Typecheck baseline comparison

Command on both worktrees: `node node_modules/typescript/bin/tsc --noEmit --incremental false`.
Base `ea26b78faed2e0d287151322a9e1a9e1bfa00165`; first repair `ac7ab82204ee9e8beac50a9c3484cfc4f50c2002`.
Same existing dependency directory, matching package lock, no install. Both exit 2. Full diagnostics match exactly: 54 errors (34 bundled skill examples/fixtures; 20 application diagnostics). This does not make full typecheck pass. No tsconfig exclusions, stub types, or example rewrites were added.

The minimum data-contract repair introduces no new TypeScript diagnostics. Fixing the unrelated Remotion fixture dependencies requires a separately scoped dependency decision; existing application diagnostics remain tracked below rather than silently suppressed.

```text
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-1-title-card/remotion-src/remotion.config.ts(1,24): error TS2307: Cannot find module '@remotion/cli/config' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-1-title-card/remotion-src/src/index.ts(1,30): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-1-title-card/remotion-src/src/Root.tsx(1,29): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-1-title-card/remotion-src/src/TitleCard.tsx(1,60): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-2-multi-scene/remotion-src/remotion.config.ts(1,24): error TS2307: Cannot find module '@remotion/cli/config' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-2-multi-scene/remotion-src/src/index.ts(1,30): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-2-multi-scene/remotion-src/src/MultiScene.tsx(11,8): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-2-multi-scene/remotion-src/src/Root.tsx(1,29): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-3-data-driven/remotion-src/remotion.config.ts(1,24): error TS2307: Cannot find module '@remotion/cli/config' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-3-data-driven/remotion-src/src/components/AnimatedNumber.tsx(1,46): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-3-data-driven/remotion-src/src/components/StatCard.tsx(1,70): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-3-data-driven/remotion-src/src/components/UnderlinedText.tsx(1,46): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-3-data-driven/remotion-src/src/index.ts(1,30): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-3-data-driven/remotion-src/src/Root.tsx(1,29): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-3-data-driven/remotion-src/src/scenes/OutroScene.tsx(1,30): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-3-data-driven/remotion-src/src/scenes/StatsScene.tsx(1,30): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-3-data-driven/remotion-src/src/scenes/TitleScene.tsx(1,84): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-3-data-driven/remotion-src/src/Stargazed.tsx(1,40): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-4-escape-hatch/cases/01-use-state.tsx(12,47): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-4-escape-hatch/cases/02-use-effect-deps.tsx(11,47): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-4-escape-hatch/cases/03-async-metadata.tsx(13,47): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-4-escape-hatch/cases/04-third-party-react.tsx(14,24): error TS2307: Cannot find module '@mui/material' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-4-escape-hatch/cases/04-third-party-react.tsx(15,60): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-4-escape-hatch/cases/05-lambda-config.tsx(15,37): error TS2307: Cannot find module '@remotion/lambda' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-4-escape-hatch/cases/05-lambda-config.tsx(16,60): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-4-escape-hatch/cases/06-warnings-only.tsx(14,89): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-4-escape-hatch/cases/07-custom-hook.tsx(13,60): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-4-escape-hatch/cases/08-mixed.tsx(12,47): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/assets/test-corpus/tier-4-escape-hatch/cases/08-mixed.tsx(13,22): error TS2307: Cannot find module '@chakra-ui/react' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/scripts/tests/fixtures/blocker.tsx(2,76): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/scripts/tests/fixtures/blocker.tsx(3,24): error TS2307: Cannot find module '@mui/material' or its corresponding type declarations.
agent/skills/remotion-to-hyperframes/scripts/tests/fixtures/blocker.tsx(35,19): error TS2322: Type 'Promise<Response>' is not assignable to type 'void | Destructor'.
agent/skills/remotion-to-hyperframes/scripts/tests/fixtures/blocker.tsx(36,25): error TS2322: Type 'string' is not assignable to type 'void | Destructor'.
agent/skills/remotion-to-hyperframes/scripts/tests/fixtures/clean.tsx(12,8): error TS2307: Cannot find module 'remotion' or its corresponding type declarations.
app/api/trading-desk-snapshot/route.ts(59,5): error TS2353: Object literal may only specify known properties, and 'code' does not exist in type '{ market?: null | undefined; context?: null | undefined; events?: null | undefined; minutes?: never[] | undefined; historicalSessions?: never[] | undefined; l2?: null | undefined; marketDate?: null | undefined; phase?: null | undefined; now?: Date | undefined; }'.
app/authenticated-app.tsx(250,30): error TS1117: An object literal cannot have multiple properties with the same name.
app/authenticated-app.tsx(2277,71): error TS2345: Argument of type 'TObservationGuidance | null' is not assignable to parameter of type 'null | undefined'.
  Type 'TObservationGuidance' is not assignable to type 'null | undefined'.
app/authenticated-app.tsx(2278,66): error TS2345: Argument of type 'TObservationGuidance | null' is not assignable to parameter of type 'null | undefined'.
  Type 'TObservationGuidance' is not assignable to type 'null | undefined'.
app/authenticated-app.tsx(2280,64): error TS2345: Argument of type 'TObservationGuidance | null' is not assignable to parameter of type 'null | undefined'.
  Type 'TObservationGuidance' is not assignable to type 'null | undefined'.
app/authenticated-app.tsx(2282,66): error TS2345: Argument of type 'TObservationGuidance | null' is not assignable to parameter of type 'null | undefined'.
  Type 'TObservationGuidance' is not assignable to type 'null | undefined'.
app/authenticated-app.tsx(2283,72): error TS2345: Argument of type 'TObservationGuidance | null' is not assignable to parameter of type 'null | undefined'.
  Type 'TObservationGuidance' is not assignable to type 'null | undefined'.
app/authenticated-app.tsx(2308,59): error TS2352: Conversion of type '{ id: string; level: "info"; title: string; message: string; createdAt: string; rabbit: "buy"; }' to type 'TradeAlertToast' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Types of property 'level' are incompatible.
    Type '"info"' is not comparable to type '"signal" | "candidate" | "risk"'.
app/authenticated-app.tsx(2457,123): error TS2353: Object literal may only specify known properties, and 'key' does not exist in type '{ timeoutMs?: number | undefined; }'.
app/authenticated-app.tsx(6388,154): error TS2353: Object literal may only specify known properties, and 'key' does not exist in type '{ timeoutMs?: number | undefined; }'.
app/authenticated-app.tsx(6895,7): error TS2322: Type '{ code: string; name: string; price: number | null; previousClose?: number | null | undefined; change: number | null; changePercent: number | null; open: number | null; high: number | null; low: number | null; volume?: number | ... 1 more ... | undefined; amount?: number | ... 1 more ... | undefined; } | undefined' is not assignable to type 'Quote'.
  Type 'undefined' is not assignable to type 'Quote'.
app/authenticated-app.tsx(7106,1007): error TS2322: Type '{ children: Element[]; xmlns: string; }' is not assignable to type 'DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>'.
  Property 'xmlns' does not exist on type 'DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>'.
app/authenticated-app.tsx(7114,846): error TS2322: Type '{ children: Element[]; xmlns: string; }' is not assignable to type 'DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>'.
  Property 'xmlns' does not exist on type 'DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>'.
app/authenticated-app.tsx(7115,1285): error TS2322: Type '{ children: Element[]; xmlns: string; }' is not assignable to type 'DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>'.
  Property 'xmlns' does not exist on type 'DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>'.
app/authenticated-app.tsx(7116,2342): error TS2322: Type '{ children: Element[]; xmlns: string; }' is not assignable to type 'DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>'.
  Property 'xmlns' does not exist on type 'DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>'.
app/authenticated-app.tsx(7117,1654): error TS2322: Type '{ children: Element[]; xmlns: string; }' is not assignable to type 'DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>'.
  Property 'xmlns' does not exist on type 'DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>'.
app/authenticated-app.tsx(7121,1483): error TS2322: Type '{ children: Element[]; xmlns: string; }' is not assignable to type 'DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>'.
  Property 'xmlns' does not exist on type 'DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>'.
app/slice-score-panel.tsx(12,460): error TS2532: Object is possibly 'undefined'.
app/slice-score-panel.tsx(12,488): error TS2532: Object is possibly 'undefined'.
app/slice-score-panel.tsx(12,536): error TS2532: Object is possibly 'undefined'.

```
