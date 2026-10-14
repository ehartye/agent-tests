# Craft

How to write good tests, from a single function up to the suite. The doctrine (doctrine.md) says how much to test and how
often to run it; this file says what a good test looks like at each level. The test-audit skill reads it to judge whether a
test is sound, and test-strategy gives it to agents that write tests.

How to read a rule:
- `Claim:` is what the skills may assert.
- `Evidence:` cites a public URL and says what the page says. Every cited page was read when this file was written (2026-10-11); a page that has moved since may need a search for its title.
- `Opinion:` marks a rule, or part of one, that no source settles. It says what evidence would change the view.
- `Note:` lines record limits, disagreements between sources and where the evidence does not reach the claim.

Where reputable sources disagree (for example mockist and classicist test doubles), the claim states what both accept.

Examples use TypeScript with vitest or jest; the ideas hold for any language.


## Level: A function or class

## Rule: Assert observable behavior through the public seam, not internals
Claim: Call the unit the way production code does and assert on its return value, resulting state, or visible output. Do not reach into private fields, private methods, or internal state names, so a pure refactor never forces a test edit.
Evidence: https://abseil.io/resources/swe-book/html/ch12.html — Software Engineering at Google, ch. 12 (Unit Testing): says the ideal test is unchanging, defines a brittle test as one that fails on an unrelated production change, and advises testing through public APIs and preferring state over interactions.
Evidence: https://kentcdodds.com/blog/testing-implementation-details — Kent C. Dodds: tests tied to implementation details give false negatives (refactor breaks a test while the app works) and false positives (app breaks, test stays green); test what users and callers see.
Evidence: https://martinfowler.com/articles/mocksArentStubs.html — Martin Fowler: mockist-style tests are more coupled to how a method works, so changing collaborator calls tends to break them and hinder refactoring.
Note: The Google book and Fowler both allow interaction checks in specific cases (see the test-double rule); the claim is about the default, not an absolute ban.

## Rule: One behavior per test, and name it with the action and the expected outcome
Claim: Each test covers a single behavior (one reason to fail), not one test per method. Name it so the failure message alone says what broke, for example `withdraw_whenBalanceEmpty_throws`; if the name needs "and", split the test. Make the assertion's failure message say what was expected, what happened and the relevant inputs, so the cause is visible without opening the test.
Evidence: https://abseil.io/resources/swe-book/html/ch12.html — Software Engineering at Google, ch. 12: write a test per behavior rather than per method; one behavior per test; a name should summarize the behavior and state the action and expected outcome, with an "and" in the name hinting at multiple behaviors; failure messages should distinguish expected from actual so the cause is visible without opening the test.
Opinion: "One reason to fail" is allowed to mean several assertions about one behavior (for example, the fields of one returned object). The source's rule is one behavior, not one assertion statement. Evidence that would change this: a team style guide demanding a single `expect` per test.
Note: The book's example naming patterns are not the only valid ones; the shared requirement is that the name states action and outcome.

## Rule: Structure tests as arrange-act-assert, and never let a helper hide the assertion or the values that matter
Claim: Keep each test straight-line: set up, perform one action, assert, with no loops, conditionals, or recomputing the expected value in the test. Put values the test depends on in the test body, and use helpers only for irrelevant setup or for asserting one named fact.
Evidence: https://abseil.io/resources/swe-book/html/ch12.html — Software Engineering at Google, ch. 12: recommends given/when/then structure and straight-line code; warns that logic in tests can hide bugs (a string-concatenation example hid a doubled slash); says setup methods hide details, tests depending on specific values should state them, and validation helpers that run fixed checks on every test obscure intent.
Evidence: https://kentcdodds.com/blog/avoid-nesting-when-youre-testing — Kent C. Dodds: nested describe plus beforeEach forces readers to trace reassigned variables; prefer self-contained tests and plain setup functions that return fresh values.
Note: Google endorses descriptive duplication over strict DRY in tests ("DAMP"); this is a judgment call that trades some repetition for readability and is accepted by both sources here.

## Rule: Prefer real collaborators or fakes; use mocks only at boundaries you do not own
Claim: Use the real collaborator when it is fast and deterministic. Use a fake (working in-memory version) when it is not. Use stubs sparingly to force hard-to-reach states or errors. Use mocks or spies for interaction checks only for state-changing calls across a boundary with no real or fake alternative (network, clock, email, payment), and say which double you mean.
Evidence: https://martinfowler.com/bliki/TestDouble.html — Martin Fowler: defines dummy (passed but never used), fake (working shortcut implementation), stub (canned answers), spy (stub that records calls), and mock (pre-programmed with expectations).
Evidence: https://abseil.io/resources/swe-book/html/ch13.html — Software Engineering at Google, ch. 13 (Test Doubles): prefer real implementations when fast and deterministic, then fakes, use stubbing sparingly, avoid interaction testing and verify only state-changing calls; mocks are justified when no real or fake exists or when call count or order is the behavior (such as cache reads), and should be backed by larger tests against the real dependency.
Evidence: https://martinfowler.com/bliki/UnitTest.html — Martin Fowler: sociable tests use real collaborators and solitary tests use doubles; he uses doubles for awkward collaborators such as remote services and treats databases and filesystems as a guideline, not an absolute.
Evidence: https://vitest.dev/guide/mocking.html — Vitest docs: vi.fn, vi.spyOn and vi.mock replace behavior; mocks must be cleared or restored so state does not leak between tests, and vi.mock does not intercept calls inside the same module.
Opinion: "Boundaries you do not own" is a heuristic that combines Google's order (real, fake, stub, mock) with Fowler's awkward-collaborator test; neither source states it in those words.
Note: Mockists and classicists disagree. Fowler's article says mockists use mocks for any collaborator with interesting behavior and accept tighter coupling to internals; classicists prefer real objects and state checks. Both accept that the choice is case-by-case and that doubles suit awkward collaborators, which is what this claim relies on.

## Rule: Make every assertion capable of failing, and do not stop at "the mock was called"
Claim: Do not assert a value against itself, recompute the production formula in the test, or assert only that a mock was called (or that code ran without throwing). Assert the concrete output or state. Await async assertions, wrap throwing calls in a function for `toThrow`, and keep snapshots small and deterministic.
Evidence: https://abseil.io/resources/swe-book/html/ch12.html — Software Engineering at Google, ch. 12: shows an interaction test that would still pass if the record were deleted right afterward, and warns that logic in tests (re-deriving expectations) can hide bugs.
Evidence: https://jestjs.io/docs/expect — Jest docs: `.rejects` and `.resolves` must be returned or awaited or the test finishes before the assertion; `toThrow` needs the call wrapped in a function or the error is not caught; `expect.assertions` and `expect.hasAssertions` guard against assertions that never run.
Evidence: https://jestjs.io/docs/snapshot-testing — Jest docs: review snapshots like code, keep them short and focused, make them deterministic, and avoid regenerating snapshots instead of investigating failures, since that records buggy behavior.
Evidence: https://arxiv.org/abs/2609.05978 — VibeCheck (arXiv 2609.05978): a study of tests from three LLM coding agents on 15 repositories found generated tests are often runnable but frequently lack strong assertions and behavioral coverage.
Opinion: Treating "verify the mock was called" as a weak assertion by default is judgment built on the Google book's preference for state testing; the Google book itself permits it for state-changing calls with no other observable. A mutation-testing run showing such tests catch real faults would soften this.
Note: Jest and Vitest share these matcher semantics for the cases above; check Vitest docs for any difference in `expect.assertions` behavior before relying on it.
Opinion: For PNG/pixel and glyph oracles, require nonempty expected IDs and sampled regions/pixel counts before comparing
results. Derive concrete expectations from an independent specification or reviewed fixture, not the renderer's own
output or metadata. Use causal negative controls: remove a required glyph or alter a required region and confirm the
owning assertion fails for that defect. A zero-sample branch or a generic thrown error is not visual evidence. These
controls are project advice; demonstrated equivalent fault detection could justify a different oracle.

## Rule: Cover boundaries and error paths, and use table-driven tests for input variants
Claim: For each unit, test the edges (empty, zero, one, max, off-by-one, invalid type) and the documented error behavior, not only the happy path. When only the data changes, use `test.each` with descriptive titles instead of copying tests or looping inside one test.
Evidence: https://vitest.dev/api/#test-each — Vitest API docs: `test.each` runs one test body over rows given as arrays, objects, or a template literal, and titles can interpolate row values (`%s`, `$name`, `%#`), so each row reports separately.
Evidence: https://jestjs.io/docs/api#testeachtablename-fn-timeout — Jest API docs: the same table forms and title placeholders exist in Jest, and `$variable` interpolation cannot be mixed with printf placeholders.
Evidence: https://arxiv.org/abs/2609.05978 — VibeCheck (arXiv 2609.05978): reports missing edge-case coverage as a common weakness of LLM-agent-generated tests, more common than outright failures.
Evidence: https://fast-check.dev/docs/introduction/why-property-based/ — fast-check docs: example-based tests depend on the author anticipating edge cases, and values around 0, 1, -1 and range edges are typical sources of bugs.
Opinion: The specific checklist of edge categories (empty, zero, one, max, off-by-one) is judgment drawn from fast-check's examples, not a canonical list from any source here.
Note: A loop inside a single test merges rows into one failure; `test.each` keeps them separate. Rows should differ in data only; if a row needs different assertions, it is a different behavior and gets its own test.

## Rule: Reach for property-based tests (fast-check) when the input space is wide or invariants are clear
Claim: Add a fast-check property (`fc.assert(fc.property(...))`) for functions with an invariant that holds across inputs (round-trip, ordering preserved, never throws, idempotent), and keep a few example tests for named edge cases and documentation. Keep the failing seed and shrunk counterexample from a failure as a regression example.
Evidence: https://fast-check.dev/docs/introduction/why-property-based/ — fast-check docs: property tests generate many inputs, surface edge cases the author did not think of, document invariants, and shrink failures to a small counterexample; they work alongside Jest and Vitest.
Evidence: https://fast-check.dev/docs/introduction/getting-started/ — fast-check docs: a property is built with `fc.property(arbitraries..., predicate)` and run via `fc.assert`; on failure it searches for the smallest failing value; use `fc.asyncProperty` for async predicates.
Evidence: https://fast-check.dev/docs/tutorials/quick-start/read-test-reports/ — fast-check docs: failure reports include a seed, a path, and the shrunk counterexample, and passing seed, path, and endOnFailure to `fc.assert` replays the failure.
Evidence: https://arxiv.org/abs/2510.25297 — arXiv 2510.25297: on 16 HumanEval problems with Claude-4-sonnet, property-based and example-based suites each caught 68.75% of bugs and together caught 81.25%.
Note: The empirical result is small (16 problems, one model) and Python; read it as "complementary", not as "property tests beat examples". fast-check's docs say it complements example tests rather than replacing them. When no clear property exists, an example test is the better tool.

## Rule: Build test data with small builders or factories and give every test fresh state
Claim: Create the object under test with a helper that sets sensible defaults, and have each test override only the fields it cares about. Create data inside the test or a setup function that returns fresh values; do not share mutable variables reassigned in `beforeEach`, and restore any global, timer, or env stubs after each test.
Evidence: https://abseil.io/resources/swe-book/html/ch12.html — Software Engineering at Google, ch. 12: ambiguous shared constants make it hard to see why a value was chosen; recommends helpers or builders with reasonable defaults where each test overrides only the values it needs.
Evidence: https://kentcdodds.com/blog/avoid-nesting-when-youre-testing — Kent C. Dodds: top-level variables assigned in hooks and reassigned in nested hooks are hard to trace; prefer inline or setup-function data and use hooks for cleanup rather than for code reuse.
Evidence: https://vitest.dev/guide/mocking.html — Vitest docs: clear or restore mocks between tests; fake timers, stubbed globals, and `import.meta.env` changes persist across tests unless reset.
Note: Kent C. Dodds' article does not name test data builders; the builder pattern is supported by the Google book, and his setup-function advice is the closest match.

## Rule: For agent-written tests, treat mocking and weak assertions as defaults to fight
Claim: Agent-generated tests skew toward adding mocks, running without strong assertions, and having assertion-roulette or magic-number smells. Before finishing, check each test for a real collaborator that could replace a mock, for concrete expected values, and for edge cases, and confirm the test fails when the behavior is broken.
Evidence: https://arxiv.org/abs/2602.00409 — arXiv 2602.00409 (empirical study of 2,168 TypeScript, JavaScript and Python repositories): 36% of coding-agent commits added mocks to tests versus 26% of non-agent commits; the authors say heavy mocking harms maintainability and suggest putting mocking guidance in agent configuration files.
Evidence: https://arxiv.org/abs/2410.10628 — arXiv 2410.10628: LLM-generated Java unit tests consistently show Assertion Roulette and Magic Number Test smells, depending on model and prompting.
Evidence: https://arxiv.org/abs/2506.14297 — arXiv 2506.14297: most LLM-generated Python test suites had at least one error or smell; assertion errors were 64% of errors in that study.
Evidence: https://arxiv.org/abs/2609.05978 — VibeCheck (arXiv 2609.05978): tests from LLM IDE agents often run but lack strong assertions and edge-case coverage.
Opinion: The "make the test fail by breaking the code" check is a practical mutation-style safeguard recommended here on judgment; none of the sources prescribes it. Sources are observational and the Java and Python smell studies cover other languages, so the TypeScript-specific prevalence is only directly measured for mocks.
Note: The mock study measures how often agents add mocks, not whether those mocks were wrong in any given test. Mocks at real boundaries remain correct (see the test-double rule).

## Level: A feature

## Rule: Prefer narrow integration tests against real dependencies
Claim: For code that crosses a module or process boundary (database, filesystem, queue, serialization), write integration tests that run your service against a real or disposable dependency and stub only what lives in other services. Keep each test scoped to one seam so it runs as fast as a unit test.
Evidence: https://martinfowler.com/articles/practical-test-pyramid.html — The Practical Test Pyramid article on martinfowler.com says integration tests cover the application's contact with databases, filesystems and other services. He prefers running real dependencies locally and covers any code that serializes or deserializes data. He calls an in-memory substitute "risky business" when production uses a different database.
Evidence: https://martinfowler.com/bliki/IntegrationTest.html — Martin Fowler separates narrow integration tests, which exercise only your code that talks to another service using test doubles and run quickly, from broad ones that need live versions of every service and are slower and less reliable.
Evidence: https://abseil.io/resources/swe-book/html/ch13.html — Software Engineering at Google (Winters, Manshreck, Wright), testing doubles chapter: the first choice is to use the real implementation of a dependency. Overusing mocks makes tests brittle and hard to refactor.
Evidence: https://node.testcontainers.org/ — The Testcontainers for Node.js docs describe lightweight, throwaway instances of common databases running in Docker.
Note: Sources disagree on in-memory databases. Fowler warns about drift from the production database. The SWE-at-Google larger-tests chapter (https://abseil.io/resources/swe-book/html/ch14.html) lists in-memory databases as a way to keep a system under test small and hermetic. Both accept it as a trade-off, so use the in-memory option only where the behavior under test does not depend on production-specific SQL or engine semantics.

## Rule: Verify service boundaries with contract tests instead of deploying everything together
Claim: At a boundary you own or consume, test each side in isolation against a shared contract (consumer-driven contracts such as Pact, or checks that your test double matches the real service). Do not rely on a broad deployed test to prove two services agree.
Evidence: https://docs.pact.io/ — Pact docs say contract testing checks each application in isolation against a documented contract. The alternative they name for confirming applications work together is expensive and brittle integration tests. Pact contracts are generated from the consumer's own tests and cover only the parts of the provider that consumers use.
Evidence: https://docs.pact.io/faq/convinceme — Pact docs argue contract tests give faster feedback, fewer environment-caused failures and easier local debugging than end-to-end integration tests, and can reduce how many tests must run in a deployed environment.
Evidence: https://martinfowler.com/bliki/ContractTest.html — Martin Fowler says contract tests check that a test double behaves like the real external service. They run separately from the main suite, often about daily, and a failure should prompt updating the doubles and code. He recommends sharing consumer-driven contracts with the supplier.
Evidence: https://docs.pact.io/getting_started/what_is_pact_good_for — Pact docs say it fits services where you control both sides and the provider controls its data. It is not suited to public APIs, consumers that cannot be identified, or provider functional testing.
Opinion: "Replace broad end-to-end coverage" is a judgment synthesized from these pages. Pact presents contract tests as replacing integration tests, not as a complete substitute for end-to-end tests. Evidence of contract gaps (for example, defects only visible with the full deployed stack) would justify keeping more end-to-end tests.
Note: Pact is code-first and by-example. A static schema check (for example against an OpenAPI document) is narrower and, per the Pact docs, does not show that consumers call the provider correctly.

## Rule: Keep end-to-end tests to a few high-value user journeys
Claim: Write end-to-end tests only for a handful of critical user journeys (for example search, add to basket, check out) and push every edge case and branch down to unit and narrow integration tests. Treat a failing end-to-end test as a signal that a lower-level test is missing.
Evidence: https://martinfowler.com/articles/practical-test-pyramid.html — The Practical Test Pyramid article on martinfowler.com: reduce end-to-end tests to a bare minimum because they are flaky, slow and costly to maintain. Cover only a few valuable user journeys, and push tests as far down the pyramid as you can.
Evidence: https://martinfowler.com/bliki/BroadStackTest.html — Martin Fowler says broad-stack tests are harder to maintain and slower than component tests, so write fewer. Use doubles for remote systems and check those doubles with contract tests. They can reveal integration bugs that component tests cannot.
Evidence: https://abseil.io/resources/swe-book/html/ch14.html — SWE at Google, larger tests chapter: larger tests are slow and often nonhermetic, which makes them nondeterministic. Prefer a handful of large tests to one enormous one. They complement unit tests and do not replace them.
Evidence: https://martinfowler.com/bliki/TestPyramid.html — Martin Fowler calls high-level tests a second line of defense, and says to reproduce a bug found there with a unit test before fixing it.
Note: Fowler's pyramid page adds that if high-level tests were fast, reliable and cheap, fewer lower-level tests would be needed. Spotify's honeycomb (https://engineering.atspotify.com/2018/01/testing-of-microservices) argues for emphasizing service-level integration tests and having none that depend on another system's correctness. The pages agree that tests whose outcome depends on other live systems should be the fewest.

## Rule: Turn each acceptance criterion into one journey test, not one test per branch
Claim: Express a feature's acceptance criteria as a given/when/then journey that a user could perform, at the lowest layer that can run it faithfully. Cover alternative branches and edge cases in lower-level tests rather than additional journeys.
Evidence: https://martinfowler.com/articles/practical-test-pyramid.html — The Practical Test Pyramid article on martinfowler.com: acceptance tests verify that a feature works from the user's perspective, often in given/when/then form. The label matters less than having them, and a lower-level acceptance test beats none. Lower-level tests should cover edge cases.
Evidence: https://docs.cypress.io/app/core-concepts/best-practices — Cypress docs advise a middle ground between one giant test and many tiny ones with shared long setup. Each test should cover one meaningful behavior, named so a failure is clear, and begin from a programmatically prepared state.
Opinion: "One journey per feature" is judgment, not a stated rule in these pages. They support few journeys and edge cases lower down. They do not fix a count. A feature with several independent high-risk outcomes may justify more than one journey.
Opinion: Exercise the actual current renderer and identify the served build and final assets for a native journey.
After a version change, review old renderer-specific branches against current obligations rather than letting them
silently pass or skip. A native integration owner must still prove loading/rendering when pure metadata helpers are
tested separately; metadata validity alone cannot replace that coverage.

## Rule: Make end-to-end tests deterministic with auto-waiting assertions and per-test data
Claim: Never use fixed sleeps. Use retrying assertions or polling that wait for an observable outcome, assert on what the user sees, and have each test create its own data and state instead of depending on another test. Do not drive third-party sites you do not control.
Evidence: https://playwright.dev/docs/best-practices — Playwright docs: test user-visible behavior, not implementation details. Each test should run independently with its own storage, cookies and data. Web-first assertions such as toBeVisible wait and retry, unlike isVisible, which does not wait. Mock third-party dependencies and test only what you control.
Evidence: https://playwright.dev/docs/test-assertions — Playwright docs: auto-retrying assertions re-check until the condition holds or a timeout is reached, and expect.poll and expect.toPass retry more complex conditions. Non-retrying assertions can make tests flaky.
Evidence: https://docs.cypress.io/app/core-concepts/best-practices — Cypress docs: you almost never need a cy.wait for an arbitrary time. Wait on an aliased route or a retrying assertion, set up state through code rather than the UI, and stub or avoid third-party login pages.
Evidence: https://martinfowler.com/articles/nonDeterminism.html — Martin Fowler: fixed sleeps either waste time or fail falsely. Prefer a callback, or polling at short intervals with a generous overall timeout. Lack of isolation lets tests corrupt each other, and quarantining non-deterministic tests keeps the rest of the suite trustworthy.
Note: The Playwright assertions page does not itself say fixed waits are discouraged. That position comes from the Cypress and Fowler pages.
Opinion: For native control collectors, assert exact declared control IDs, including missing and unexpected IDs, and
their roles. Declare coordinate spaces (logical, CSS or device pixels), transforms, horizontal/vertical scroll axes
and clipping bounds. Check hit targets before and after scrolling; horizontal header navigation is not a pinned
action merely because it stays visible. Exercise disposal so removed controls and subscriptions stop participating.
These checks follow the application's declared contract; appearance alone cannot establish control semantics.

## Rule: Control time and asynchronous work with fake timers or an injected clock
Claim: For timeouts, retries, debouncing, schedules and expiry, fake the timer or clock (or inject a clock) and advance it explicitly, asserting both the state before and after the time passes. Do not wait in real time, and do not touch the real network.
Evidence: https://jestjs.io/docs/timer-mocks — Jest docs: native timers depend on real time and are less than ideal for tests. Fake timers let tests run instantly, control when time passes, and assert intermediate and final states. runAllTimers on a recursive timer can loop until Jest aborts.
Evidence: https://vitest.dev/api/vi.html — Vitest API docs: vi.useFakeTimers fakes setTimeout, setInterval, setImmediate and Date by default (not process.nextTick or queueMicrotask). vi.advanceTimersByTimeAsync also runs timers set asynchronously, and vi.useRealTimers restores real implementations.
Evidence: https://nodejs.org/api/test.html — Node.js test runner docs: mock.timers can fake setTimeout and Date. tick() advances a shared clock, and a mock created through the test context is restored when the test finishes.
Evidence: https://martinfowler.com/articles/nonDeterminism.html — Martin Fowler: wrap direct system-clock calls so tests can control and freeze the time they see, and reset the stub so it does not leak into other tests.
Note: Fake timers do not make real I/O deterministic. Pair them with a fake server or boundary stub for network calls. Check which timer APIs your runner fakes; promise microtasks and nextTick are separate.

## Rule: Isolate every test's resources so tests run in parallel and beside other checkouts
Claim: Give each test or worker its own temp directory, database or schema, and unique record IDs, and bind servers to port 0 so the OS assigns a free port. Do not rely on test order, module-level state or fixed ports.
Evidence: https://nodejs.org/api/net.html — Node.js docs: listening with port 0 makes the operating system assign an arbitrary unused port, readable through server.address() once 'listening' fires.
Evidence: https://playwright.dev/docs/test-parallel — Playwright docs: workers are separate processes that cannot share state. A test that depends on another test's side effects may pass in order and fail in parallel. Derive unique IDs per test and use per-test output paths.
Evidence: https://vitest.dev/guide/parallelism — Vitest docs: test files run in parallel, each in its own isolated environment. Tests within a file run in order unless marked concurrent.
Evidence: https://martinfowler.com/articles/nonDeterminism.html — Martin Fowler: properly isolated tests can run in any sequence. Rebuilding the starting state for each test, or cleaning up after it, prevents tests corrupting each other.
Evidence: https://nodejs.org/api/test.html — Node.js test runner docs: by default each test file runs in its own process. With isolation set to none, files share global state and can interfere with each other.
Opinion: Running safely beside another git worktree follows from these practices (no shared fixed ports, directories or database names), but none of these pages discuss worktrees. The inference holds only if no resource outside the process, such as a shared local database name or fixed port, is hardcoded.
Opinion: Put capture teardown in a finally path so assertion or screenshot failures still dispose collectors,
subscriptions, pages and contexts and close owned browser/server resources. Record cleanup outcome even on failure;
preserve the original failure alongside capture or cleanup errors. Verify this failure path before relying on reuse.

## Rule: Size a feature's test set by risk and do not re-test lower layers from above
Claim: Decide what a feature needs by what could go wrong at each seam. Cover logic branches in unit tests, each external seam with one or a few narrow integration or contract tests, and cross-system wiring with a thin journey. Skip assertions at a higher layer that a lower layer already proves.
Evidence: https://martinfowler.com/articles/practical-test-pyramid.html — The Practical Test Pyramid article on martinfowler.com: avoid duplicating tests across layers. If a higher-level test finds something a lower-level test could have caught, move the test down. Higher-level tests should check only what lower ones cannot.
Evidence: https://abseil.io/resources/swe-book/html/ch14.html — SWE at Google: choose larger tests by the risk being addressed. Functional tests cover multi-binary interactions, and end-to-end scenarios grow combinatorially, so chain smaller pairwise integration tests to keep coverage manageable.
Evidence: https://engineering.atspotify.com/2018/01/testing-of-microservices — Spotify Engineering: integration tests of a service through its inputs and outputs with realistic fixtures survive internal refactoring. Implementation-detail tests are reserved for isolated code with complex internals.
Opinion: There is no published ratio or per-feature count in these sources. The "by risk" sizing is judgment. The sources only say tests should be few at the top and should not repeat lower-layer coverage.

## Rule: Test failure modes at integration seams by injecting faults
Claim: For each seam with a network or process boundary, add tests for the failures that boundary can produce, such as error responses, timeouts, slow or dribbled responses, dropped connections and malformed bodies. Assert on the caller's visible behavior (error shown, retry made, fallback used).
Evidence: https://wiremock.org/docs/simulating-faults/ — WireMock docs list fault simulation: fixed or random delays, chunked slow responses for testing timeouts, and fault responses (empty response, malformed chunk, random data then close, connection reset).
Evidence: https://mswjs.io/docs/best-practices/network-behavior-overrides — Mock Service Worker docs: a runtime handler override can make one test see an error such as a 500 response, can apply once, and should be reset after each test.
Evidence: https://playwright.dev/docs/network — Playwright docs: route.abort fails a matched request, and route.fulfill can supply a modified response.
Opinion: Which failures to cover and what behavior to assert (how many retries, which fallback) are judgment from the system's requirements. These pages document how to inject faults, not which ones matter. Combine with fake timers so retry and backoff tests need no real waiting.
Note: WireMock notes that its connection-reset fault may hang on Windows. Check what each injection tool supports on your platform.

## Rule: Handle third-party APIs with a controlled fake or recording, and check it for staleness
Claim: Do not call a live third-party API from automated tests. Use a sandbox, a fake server, or recorded responses, and add a separate scheduled check that the fake or recording still matches the real service. Re-record when requests stop matching.
Evidence: https://martinfowler.com/bliki/SelfInitializingFake.html — Martin Fowler: a self-initializing fake forwards the first call to the real service and replays the saved response afterwards, like record/replay. It never invalidates entries, so a separate suite should compare live responses with saved ones. Fast stages use the fake and the slowest stage uses the real service.
Evidence: https://martinfowler.com/bliki/ContractTest.html — Martin Fowler: contract tests check that your doubles match the real service. They are best run separately on the pace of the supplier's changes, and a test instance of the service is preferred over production.
Evidence: https://abseil.io/resources/swe-book/html/ch14.html — SWE at Google: mocks written by someone who did not write the real component can go stale unnoticed. Google uses record/replay, where larger tests record external traffic and smaller tests replay it, and tests must be re-recorded when requests no longer match.
Evidence: https://playwright.dev/docs/mock — Playwright docs: routeFromHAR records live traffic into a HAR file when update is on and replays it when off, with strict matching on URL, method and POST payload. Running with update refreshes the recording.
Evidence: https://playwright.dev/docs/best-practices — Playwright docs: avoid depending on live third-party services and use the Network API to supply responses.
Note: Fowler says tests usually need repeatable answers more than current data, so old recorded values are often fine. SWE at Google is more cautious about unmaintained doubles. Both accept recordings if something detects drift. The Pact docs say Pact is poorly suited to public third-party APIs, so for those use recordings or a fake checked against the real API rather than consumer-driven contracts.

## Level: The suite and the process around it

## Rule: Give each behavior one owning test, named by its subject
Claim: Assert each behavior at the lowest level that can show it, in one place, and name the test file after the unit or subject it covers (for example `parse-config.test.ts`). When a higher-level test finds a bug no lower test caught, add the lower test instead of duplicating at both levels. When you remove a behavior, delete its tests in the same change.
Evidence: https://martinfowler.com/articles/practical-test-pyramid.html — Martin Fowler's site (Ham Vocke): push tests as far down as possible, do not repeat edge cases a lower level covers, remove high-level tests that add nothing, keep one test class per production class, and add a lower-level test for bugs found higher up.
Evidence: https://jestjs.io/docs/configuration — Jest documentation: tests are discovered by the `.test`/`.spec` suffix or a `__tests__` folder, so a file's location is a convention, not a requirement.
Evidence: https://vitest.dev/config/include — Vitest documentation: default discovery is any `*.test` or `*.spec` file under the root, which works equally for colocated and mirrored layouts.
Opinion: Colocating tests next to the source (rather than a separate mirrored tree) is judgment. The tools accept both and I found no empirical study comparing them. Follow the layout the repo already uses. Also judgment: deleting tests together with the removed behavior. Fowler's page supports deleting redundant tests, and Google's testing chapter says a test that breaks on a requirement change signals stale documentation, but neither page states the rule directly.
Note: Fowler's page is about layers within a pyramid. Applying "one owner per behavior" within a single layer is an extension of it.

## Rule: Make tests hermetic and deterministic, and keep them fast by design
Claim: Each test builds and tears down everything it needs. It uses no shared mutable state, no dependence on test order, and no real network, and it takes time from an injected or faked clock and randomness from a fixed seed. Make tests fast by keeping them small (one process, no real I/O or sleeping), and share expensive setup only when the tests never mutate it.
Evidence: https://martinfowler.com/articles/nonDeterminism.html — Martin Fowler: lists lack of isolation, async behavior, remote services, time, and resource leaks as causes of non-determinism. Advises rebuilding start state per test, wrapping the system clock so tests can substitute a fixed value, and using test doubles for unstable remote systems.
Evidence: https://abseil.io/resources/swe-book/html/ch11.html — Software Engineering at Google (Winters, Manshreck, Wright), ch. 11: hermetic tests carry their own setup and teardown and must not rely on shared state or test order. Small tests avoid sleeping, I/O and blocking calls and run in a single process.
Evidence: https://vitest.dev/config/sequence — Vitest documentation: `sequence.shuffle` randomizes test order to reveal tests that depend on others having run, and `sequence.seed` sets the seed for that order.
Evidence: https://jestjs.io/docs/configuration — Jest documentation: `fakeTimers` config controls the faked clock (including the `now` time), and `randomize` shuffles test order within a file.
Evidence: https://dora.dev/capabilities/test-automation/ — DORA: developers should get automated test feedback in under ten minutes, locally and in CI.
Opinion: "Share expensive setup only when read-only" is judgment that combines the isolation advice above with the Google chapter 12 warning that hidden setup values make tests hard to read. No page I fetched states the read-only condition. Evidence that would change it: a study showing shared mutable fixtures do not raise order-dependent failures.
Note: Google's chapter 14 and Fowler's page both accept that real network or database use is sometimes needed. Keep those in a separate, clearly labeled larger test rather than in the default fast suite.

## Rule: Maintain tests like production code, with a clear owner
Claim: Refactor tests, remove redundant ones, and fix slow or brittle ones as part of normal changes. Assign each test the same ownership as the code it covers, so a failing or outdated test is fixed by whoever changes the code.
Evidence: https://abseil.io/resources/swe-book/html/ch11.html — Software Engineering at Google, ch. 11: advises treating tests like production code, refactoring slow or brittle ones, and warns that a suite that becomes a productivity drain gets skipped.
Evidence: https://martinfowler.com/articles/practical-test-pyramid.html — Martin Fowler's site (Ham Vocke): test code is as important as production code, "this is only test code" is no excuse for sloppiness, and redundant high-level tests should be removed.
Evidence: https://dora.dev/capabilities/test-automation/ — DORA: when a separate group owns test automation, pipelines tend to stay broken until that group fixes the tests, and developers who do not own tests tend to write hard-to-test code. Developers should be the primary authors and maintainers.
Evidence: https://martinfowler.com/bliki/TestDrivenDevelopment.html — Martin Fowler: the most common TDD mistake is skipping the refactor step, which leaves messy code (though still tested).
Note: DORA's page is about team-level capability and does not give a per-file ownership rule. For an agent, the practical reading is that the author of a change owns the test changes in the same commit.

## Rule: Use coverage to find untested code, never as the quality target
Claim: Run coverage to see which code no test exercises, then decide whether it matters. Do not add tests merely to raise a percentage, and do not report a coverage number as evidence the tests are good.
Evidence: https://martinfowler.com/bliki/TestCoverage.html — Martin Fowler: coverage is useful for finding untested parts of a codebase but of little use as a numeric statement of quality. Coverage targets invite weak tests, and he is suspicious of 100%.
Evidence: https://abseil.io/resources/swe-book/html/ch11.html — Software Engineering at Google, ch. 11: coverage only measures that a line was invoked, not that it was verified, and a coverage target can become a ceiling rather than a floor.
Note: The sources agree on the claim. Fowler gives rough numeric expectations (low coverage is a warning sign; upper 80s to 90s is plausible for careful testing); Google gives no number. Treat such numbers as his opinion, not a threshold.

## Rule: Reproduce a bug with a failing test before fixing it
Claim: For a bug fix, first write a test that fails for the reported reason, confirm it fails, then fix the code and watch it pass. Use tests-first more generally when the expected behavior is clear before implementation.
Evidence: https://martinfowler.com/bliki/SelfTestingCode.html — Martin Fowler: the usual response to a production bug is to write a test that reproduces it before fixing it, which stops the bug returning and treats the bug as a testing gap. He also says TDD is one route to self-testing code, and tests written afterwards also work if the work is not done until they pass.
Evidence: https://martinfowler.com/bliki/TestDrivenDevelopment.html — Martin Fowler: TDD is a red-green-refactor loop. Writing the test first makes you consider how code will be used before how it is built.
Evidence: https://arxiv.org/abs/2406.12952 — SWT-Bench (Mündler et al., arXiv): LLMs are fairly good at writing tests that reproduce reported issues, and using generated reproduction tests to screen candidate fixes roughly doubled one agent's precision.
Evidence: https://code.claude.com/docs/en/best-practices — Anthropic, Claude Code documentation: give the agent a check it can run, and for a bug describe the symptom and ask for a failing test that reproduces it, then the fix.
Evidence: https://arxiv.org/abs/2402.13521 — Mathews and Nagappan, arXiv: supplying tests with the problem statement improved LLM-generated code correctness on MBPP and HumanEval.
Note: Fowler does not require strict TDD for all work; the bug-reproduction step is the part to apply universally. The two arXiv results are benchmark-based (small function-level or issue-level tasks) and may not transfer to every codebase.

## Rule: Start from characterization tests and add tests where change happens in untested code
Claim: Before changing legacy code that has no tests, write characterization tests that record what the code does today (run it, then assert the observed output). Introduce a seam so slow or external dependencies can be replaced in tests. Then refactor or change behavior deliberately.
Evidence: https://michaelfeathers.silvrback.com/characterization-testing — Michael Feathers: characterization tests document actual behavior rather than intended behavior. Write a test, let the failure reveal the real output, then paste it in as the expectation. Keep a test for odd-looking behavior you have not confirmed as a bug, since users may depend on it.
Evidence: https://martinfowler.com/bliki/LegacySeam.html — Martin Fowler: a seam lets you alter behavior without editing the code at that spot (for example passing a slow dependency in as a parameter), which is how legacy code gets under test. Each seam needs an enabling point, and getting a system under control can take months.
Evidence: https://martinfowler.com/articles/practical-test-pyramid.html — Martin Fowler's site (Ham Vocke): write an automated test for each bug found by exploratory or higher-level testing.
Opinion: "Add tests where change happens" rather than trying to cover everything first is judgment. The pages support the building blocks (characterization tests, seams, test per bug) but do not state the sequencing. Evidence that would change it: a study of retrofitting tests onto legacy codebases comparing incremental and big-bang approaches.
Note: Feathers' page is a short post; the fuller treatment is his book, which was not fetched here.

## Rule: Where users depend on the code, add post-release checks and observability
Claim: Pre-release tests cannot see production scale, real configuration, or real traffic. Where users depend on the code, pair the test suite with read-only probes or canary checks and enough monitoring to tell what a release broke and why. Treat these as a complement that catches what escaped, not a replacement for tests that gate the merge.
Evidence: https://abseil.io/resources/swe-book/html/ch14.html — Software Engineering at Google, ch. 14 (Larger Testing): read-only probers and canary analysis against live systems catch major problems early. Drawbacks: problems already reach users, writes change real state, and production tests cannot gate a release. Unit tests with doubles can miss configuration, load, and emergent behavior.
Evidence: https://www.honeycomb.io/blog/testing-in-production — Honeycomb (Charity Majors): every deploy is in effect a test in production. Staging cannot reproduce production scale and traffic and can create false confidence. She lists observability, feature flags, canaries, and fast deploys with fast rollback as the practices that address its risks.
Evidence: https://dora.dev/capabilities/monitoring-and-observability/ — DORA: monitoring should show quickly what is broken and why, helps debug bugs and unexpected side effects of changes, and observability helps find unanticipated problems.
Opinion: Whether a project needs this at all depends on how many users rely on it and how costly a bad release is. Neither Google nor Majors gives a threshold, so an agent should apply it only when the project says users depend on it.
Note: Majors argues strongly for testing in production; Google lists it as useful but with real risks and no gating power. Both agree it needs safeguards (read-only checks, flags, canaries, rollback).

## Rule: Do not trust agent-written passing tests as proof; supply the specification and an independent check
Claim: A passing suite written or satisfied by an agent can still hide wrong behavior. Give the agent explicit expected behavior or acceptance examples up front, have a reader check that the tests assert that behavior, and verify with an independent check, not only the agent's own tests.
Evidence: https://arxiv.org/abs/2503.15223 — Wang et al., arXiv ("Are 'Solved Issues' in SWE-bench Really Solved Correctly?"): some patches pass SWE-bench's tests yet fail the developers' own tests (7.8% of patches), and weak tests inflate reported resolution rates by about 6.2 percentage points.
Evidence: https://arxiv.org/abs/2410.06992 — SWE-Bench+ (Aleithan et al., arXiv): about 31% of passing patches were suspicious because the tests were too weak, and about 33% of successful patches had the answer leaked in the issue text. Removing these problem cases dropped one agent's resolution rate from 12.47% to 3.97%.
Evidence: https://code.claude.com/docs/en/best-practices — Anthropic, Claude Code documentation: give the agent concrete verification criteria such as example test cases, and use a second session or reviewer so the agent that wrote the work does not grade it.
Evidence: https://arxiv.org/abs/2402.13521 — Mathews and Nagappan, arXiv: giving LLMs the tests along with the problem statement improved the correctness of generated code on two benchmarks.
Opinion: Having humans review tests more carefully than implementation code is judgment. I found no empirical study showing that split is better, so treat it as a reasonable heuristic: tests encode the specification, so errors there pass silently. Evidence that would change it: a study comparing defect escape rates under test-first versus code-first human review of agent output.
Note: The SWE-bench studies measure benchmark validity, not everyday agent practice, and benchmark numbers should not be quoted as general failure rates. They do show that passing tests alone can be an unreliable signal when the tests are weak.
