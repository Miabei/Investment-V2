@AGENTS.md

# Language policy

**English everywhere except user-facing UI strings.**

| What | Language |
| --- | --- |
| Chat replies / explanations / summaries | English |
| Markdown docs I create (PRDs, READMEs, design notes, commit messages, code review comments) | English |
| Code comments | English |
| Variable / function / type names | English (default) |
| **UI strings rendered to the end user in the browser** (page titles, button labels, form placeholders, error messages, table headers, toast text) | **Chinese (zh-CN)** |
| Schema / DB enum values, log messages, internal IDs | English |

The user is the only end-user of this app and reads Chinese on screen, but communicates with me in English in chat.

## Don't churn existing files

Files written before this policy contain Chinese comments and Chinese chat-style descriptions. **Do not retroactively translate them.** Apply this policy only to new content. The existing Chinese in old files is fine and stays.
