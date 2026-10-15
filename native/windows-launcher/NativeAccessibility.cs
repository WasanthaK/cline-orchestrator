using System.Windows.Forms;

namespace ClineOrchestrator.Launcher;

/// <summary>Offline-only WinForms accessibility smoke. No form is displayed.</summary>
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
        var named = controls.Select(c => c.AccessibleName).ToHashSet(StringComparer.Ordinal);
        return required.All(named.Contains);
    }

    internal static bool SelfCheck()
    {
        // Instantiation does not invoke any Shown handler or viewer child.
        using var launch = new ViewerLauncherForm();
        using var operations = new OperationsCenterForm(() => false, _ => { });
        using var setup = new SetupReadinessForm();
        using var edit = new EditSavedSettingsForm();
        using var connect = new LocalModelConnectionForm();
        using var project = new RegisterProjectForm();
        using var workspace = new RegisterWorkspaceForm();
        return Verify(launch, "Copy access code", "Open dashboard")
            && Verify(operations, "Task history and evidence", "Refresh operations")
            && Verify(setup, "Refresh setup status", "Register safe workspace")
            && Verify(edit, "Saved model ID", "Restore selected model")
            && Verify(connect, "Model ID", "Check model connection")
            && Verify(project, "Project name", "Review project registration")
            && Verify(workspace, "Workspace folder", "Safety validation commands");
    }
}
