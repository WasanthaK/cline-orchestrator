# M19E4B — Native accessibility baseline

**Review-only candidate** stacked on PR #66. Seven WinForms surfaces now set
explicit accessible names and descriptions for every interactive control,
status labels have contextual accessible names, and Escape activates Close in
each form.

The compiled launcher supports exactly one nonmutating diagnostic argument,
`--accessibility-self-check`. This constructs and disposes all seven forms
in the STA thread without showing them; no `Shown` event, browser session,
model, task, daemon, config, registry, service or file write occurs. It exits
nonzero if focusable controls are missing names/descriptions, a key labeled
control is absent, or a dialog lacks CancelButton. The disposable Windows
installer workflow runs this check using the installed launcher executable.

This check does **not** prove human accessibility. Release acceptance requires
keyboard-only onboarding/closing and real screen-reader focus announcements,
high contrast and 125%-200% display scaling, form resize and error-state
readability, and manual Windows operator review. M19E4A real llama.cpp/Cline
task remains unexecuted, M19E binary update/rollback and signing remain gated.
