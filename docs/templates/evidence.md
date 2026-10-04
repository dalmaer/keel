# Evidence: <phase> — <claim>

- Date:
- Phase:
- Revision: the phase's commit (its title), or the base commit and 'working tree'
- Claim being checked:

## Automated checks

Exact command, exit code, the line that says so. "Not run" is a valid result.
The whole gate runs after this file is written: name its command and what it
covers here; its result line goes in the commit body. A proof that needs the
commit (a clean checkout of the committed tree) is walked after it, and its
result is added here in the next commit.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| | | Not run | |

## Gaps and decision

What remains unverified, and whether this supports built or lived-in. Never
fill this template with expectations in place of observations.
