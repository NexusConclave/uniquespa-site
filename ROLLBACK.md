# Undo a release

Every live version is kept by Cloudflare Pages.

1. **Fastest:** Cloudflare dashboard > Workers & Pages > `unique-spa-house` > Deployments > pick the last good one > **Rollback**. Live in about a minute.
2. **Then fix the code:** open a pull request that reverts the bad change (`git revert <commit>`), let the checks pass, and approve it like any other release, so the next deploy doesn't bring the problem back.
3. **Old version from GitHub:** Actions > "Production" > Run workflow (branch `main`) with `ref` = an older commit **of main** (other commits are refused). If that commit's prices or specials differ from today's main, the run stops until you check them against Square and run it again with **prices_checked** ticked. Still needs Katy's approval.
