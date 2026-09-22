# Repository instructions

- Create a pull request to `origin` after completing a task when `origin` is a cormoran repository.
- Monitor pull-request CI until it passes. Fix any failing checks or merge conflicts.
- If linting or formatting changes code, commit those changes too so the repository remains consistently formatted.
- When adding or changing a user-facing feature, provide both Japanese and English UI copy. Keep visible text, status messages, accessibility labels, page metadata, and form choices in the shared localization layer; do not add new hard-coded UI strings in a component.
- Preserve the language behavior: use the browser preference only when the user has no saved choice, offer an in-app language setting, and persist an explicit choice across reloads.
