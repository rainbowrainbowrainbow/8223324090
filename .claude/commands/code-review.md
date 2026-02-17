---
allowed-tools: Bash(gh issue view:*), Bash(gh search:*), Bash(gh issue list:*), Bash(gh pr comment:*), Bash(gh pr diff:*), Bash(gh pr view:*), Bash(gh pr list:*)
description: Code review a pull request
---

Provide a code review for the given pull request.

**Agent assumptions (applies to all agents and subagents):**
- All tools are functional and will work without error. Do not test tools or make exploratory calls.
- Only call a tool if it is required to complete the task. Every tool call should have a clear purpose.

To do this, follow these steps precisely:

1. Launch a haiku agent to check if any of the following are true:
   - The pull request is closed
   - The pull request is a draft
   - The pull request does not need code review (e.g. automated PR, trivial change)
   - Claude has already commented on this PR

   If any condition is true, stop and do not proceed.

2. Launch a haiku agent to return a list of file paths for all relevant CLAUDE.md files including:
   - The root CLAUDE.md file
   - Any CLAUDE.md files in directories containing files modified by the PR

3. Launch a sonnet agent to view the pull request and return a summary of the changes

4. Launch 4 agents in parallel to independently review the changes:

   Agents 1 + 2: CLAUDE.md compliance sonnet agents
   Audit changes for CLAUDE.md compliance in parallel.

   Agent 3: Opus bug agent
   Scan for obvious bugs. Focus only on the diff itself. Flag only significant bugs.

   Agent 4: Opus bug agent
   Look for problems in introduced code — security issues, incorrect logic, etc.

   **CRITICAL: We only want HIGH SIGNAL issues.** Flag issues where:
   - Code will fail to compile or parse
   - Code will definitely produce wrong results
   - Clear CLAUDE.md violations where you can quote the exact rule

   Do NOT flag:
   - Code style or quality concerns
   - Potential issues depending on specific inputs
   - Subjective suggestions

5. For each issue found, launch parallel subagents to validate the issue.

6. Filter out unvalidated issues.

7. Output a summary of findings:
   - If issues found, list each with description
   - If no issues, state: "No issues found. Checked for bugs and CLAUDE.md compliance."

   If `--comment` argument provided and issues found, continue to step 8.

8. Post inline comments for each validated issue.
