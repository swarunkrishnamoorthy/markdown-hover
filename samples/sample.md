# Unit test quality — sample with a hover glossary

View this file with `mdglossary view samples/sample.md` and hover the
dotted-underlined terms below. Each one shows a definition and an example in a
little card, without cluttering the prose.

The core problem is weak oracle strength: a suite can have high coverage yet
almost never check that the logic is right. Our biggest tell is the high
wildcard matcher share — most faked calls never assert the payload we send
downstream. A related, cheaper signal is state assertions per test: when it is
low, tests execute code without verifying results.

The CI gate makes this worse because patch coverage only asks whether new lines
executed, not whether a test would fail if the logic were wrong. When we finally
run mutation testing, we should skip every arid node (logging, metrics, DI
registration) and spend the budget on money-touching code.

Note how none of the paragraphs above had to stop and define these terms inline.
The definitions live once, at the bottom of the file, and the reader pulls them
up on demand.

<!-- glossary
terms:
  - term: oracle strength
    aliases: [oracle, weak oracle]
    definition: |
      Given that a test *reached* the code, would it actually notice if the code
      were wrong? Coverage measures reach; oracle strength measures whether the
      assertions would catch a defect.
    example: |
      Weak oracle — reached but unchecked:

      ```csharp
      var result = await handler.Handle(request);
      result.Should().NotBeNull();
      ```

      Strong oracle — checks the actual outcome:

      ```csharp
      result.Status.Should().Be(RefundEligibilityStatus.Eligible);
      ```

  - term: wildcard matcher
    aliases: [wildcard matchers, wildcard]
    definition: |
      A FakeItEasy argument matcher (`A<T>._`) that matches **any** value of a
      type. It verifies that a call happened but silently decides the payload
      does not matter — so a wrong argument still passes.
    example: |
      ```csharp
      // Wildcard: passes even if the wrong id is sent
      A.CallTo(() => client.Credit(A<long>._)).MustHaveHappened();

      // Constrained: only passes for the exact expected value
      A.CallTo(() => client.Credit(groupTargetId)).MustHaveHappenedOnceExactly();
      ```

  - term: state assertions per test
    aliases: [state assertion, state assertions]
    definition: |
      The average number of assertions that check a produced **value**
      (`.Should().Be(...)`, `Assert.AreEqual`) rather than that a call happened.
      Low numbers mean tests run logic without checking the result.
    example: |
      DevMon-wide average is **1.34** — roughly one real check per test. A test
      whose only assertion is `Is.Not.Null` contributes 0 here.

  - term: patch coverage
    definition: |
      The fraction of **newly changed** lines exercised by tests in a PR. A high
      patch target (e.g. 95%) is easy to satisfy with tests that execute code
      but assert nothing meaningful.
    example: |
      A test that calls the handler and asserts `Is.Not.Null` satisfies a 95%
      patch gate perfectly — while catching no logic error.

  - term: arid node
    aliases: [arid nodes]
    definition: |
      Code whose mutation is uninteresting by construction — logging, metrics
      counters, tracing, `ToString`, DI registration. Mutating it produces
      survivors nobody cares about, so it should be excluded from mutation runs.
    example: |
      ```csharp
      MetricsUtils.RefundEligibilityCheckCounter.Inc(); // arid — skip it
      ```

  - term: mutation testing
    aliases: [mutation score, mutant, mutants]
    definition: |
      Deliberately introduce small faults (mutants) into the code and check
      whether the suite fails. A surviving mutant is a concrete, actionable gap
      in oracle strength.
    link: https://stryker-mutator.io/docs/stryker-net/introduction/
-->
