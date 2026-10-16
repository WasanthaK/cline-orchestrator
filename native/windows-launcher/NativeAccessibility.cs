using System.Windows.Forms;

namespace ClineOrchestrator.Launcher;

/// <summary>
/// Offline WinForms accessibility smoke. Each form is constructed without
/// showing it; no Shown handlers or child processes are invoked.
/// Status codes are fixed numbers only, never secrets, paths or user text.
/// </summary>
internal static class NativeAccessibility
{
    internal static void Name(Control control, string label, string description)
    {
        if (string.IsNullOrWhiteSpace(label) || string.IsNullOrWhiteSpace(description))
            throw new ArgumentException("Accessibility text must not be empty.");
        control.AccessibleName = label;
        control.AccessibleDescription = description;
    }

    private static IEnumerable<Control> Flatten(Control parent)
    {
        foreach (Control control in parent.Controls)
        {
            yield return control;
            // NumericUpDown is a semantic input with framework-owned
            // editing/buttons. These internal controls are not independently
            // presented or labeled by the application.
            if (control is NumericUpDown) continue;
            foreach (Control nested in Flatten(control)) yield return nested;
        }
    }

    private static bool Verify(Form form, params string[] required)
    {
        if (form.CancelButton is null) return false;
        var controls = Flatten(form).Where(c => c is Button or TextBox or
            ComboBox or ListBox or NumericUpDown).ToArray();
        if (controls.Length == 0 ||
            controls.Any(c => string.IsNullOrWhiteSpace(c.AccessibleName) ||
                string.IsNullOrWhiteSpace(c.AccessibleDescription))) return false;
        var names = controls.Select(c => c.AccessibleName).ToHashSet(StringComparer.Ordinal);
        return required.All(names.Contains);
    }

    private static int Step(int number, Func<Form> create, params string[] required)
    {
        try
        {
            using var form = create();
            return Verify(form, required) ? 0 : 10 + number;
        }
        catch
        {
            // 81–87 mean form creation/inspection failed. No exception
            // messages are disclosed from installed operator state.
            return 80 + number;
        }
    }

    internal static int SelfCheck()
    {
        var checks = new (Func<Form> Create, string[] Required)[]
        {
            (() => new ViewerLauncherForm(), new[] { "Copy access code", "Open dashboard" }),
            (() => new OperationsCenterForm(() => false, _ => { }),
                new[] { "Task history and evidence", "Refresh operations" }),
            (() => new SetupReadinessForm(), new[] { "Refresh setup status", "Register safe workspace" }),
            (() => new EditSavedSettingsForm(), new[] { "Saved model ID", "Restore selected model" }),
            (() => new LocalModelConnectionForm(), new[] { "Model ID", "Check model connection" }),
            (() => new RegisterProjectForm(), new[] { "Project name", "Review project registration" }),
            (() => new RegisterWorkspaceForm(), new[] { "Workspace folder", "Safety validation commands" }),
        };
        for (var i = 0; i < checks.Length; i++)
        {
            int result = Step(i + 1, checks[i].Create, checks[i].Required);
            if (result != 0) return result;
        }
        return 0;
    }
}
