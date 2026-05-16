# Branch Protection

Protect `main` before merging production work.

## Required Rules

- Require a pull request before merging.
- Require at least 1 approval.
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution.
- Require status checks to pass before merging:
  - `test`
  - `typecheck`
- Require branches to be up to date before merging once CI is stable.
- Block force pushes.
- Block branch deletion.
- Restrict direct pushes to maintainers/admins only.

## Recommended Follow-Up

- Add CODEOWNERS after the GitHub org team names are confirmed.
- Add a Solidity contract check once the escrow contract moves from skeleton to deployed artifact.
- Add deployment environments for testnet and mainnet so custody changes require manual approval.

## GitHub API Payload

Use this after authenticating with an admin/maintainer token:

```bash
gh api \
  --method PUT \
  repos/KASPACOM/pearl-infra/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["test", "typecheck"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": true
}
JSON
```
