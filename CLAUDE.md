# Redline

Project rules live in `README.md` (section «Правила»). The full specification is linked there.

## Final State, Not History

This principle applies to all descriptions and explanations — documentation, specification, code
comments, design notes. Describe the final version of decisions, not how they got there. Describe
the system as it is — no "previously / used to be / changed from" comparisons, no migration
narratives, no changelog-in-prose. State rationale as a present-tense property of the design,
never as a contrast with a superseded model. History lives in git, not in descriptions.

Code that converts stored data of an earlier version (`adapters/idb/task-records-v*.ts`, fragment
migrations) describes its input and output formats as its contract; that is not history.
