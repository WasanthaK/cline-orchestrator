using System.Drawing;
using System.Windows.Forms;

namespace ClineOrchestrator.Launcher;

/// <summary>Scrollable, explicit approval of the exact canonical root and
/// complete Safety rules. Closing the window is a cancellation, not consent.</summary>
internal sealed class WorkspaceSafetyReviewForm : Form
{
    internal WorkspaceSafetyReviewForm(string exactReview)
    {
        Text = "Review workspace and Safety policies";
        Width = 820;
        Height = 660;
        MinimumSize = new Size(560, 410);
        StartPosition = FormStartPosition.CenterParent;
        ShowIcon = false;

        var instructions = new Label
        {
            Dock = DockStyle.Top, Height = 58,
            Text = "Review the canonical folder, file-access rules, and validation commands below.\n"
                + "Registration does not start a task. Future tasks still require separate approval.",
            Padding = new Padding(14, 12, 12, 5),
        };
        var content = new TextBox
        {
            Dock = DockStyle.Fill, Multiline = true,
            ReadOnly = true, ScrollBars = ScrollBars.Both,
            WordWrap = false,
            Font = new Font("Consolas", 10),
            Text = exactReview,
            TabStop = true,
        };
        var actions = new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom, Height = 58,
            FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(12, 10, 12, 8),
            WrapContents = false,
        };
        var cancel = new Button
        {
            Text = "Cancel", DialogResult = DialogResult.No,
            AutoSize = true, TabIndex = 0,
        };
        var accept = new Button
        {
            Text = "Register this workspace", DialogResult = DialogResult.Yes,
            AutoSize = true, TabIndex = 1,
        };
        actions.Controls.Add(cancel);
        actions.Controls.Add(accept);
        CancelButton = cancel;
        // Deliberately NO AcceptButton: Enter cannot accidentally register.
        Controls.Add(content);
        Controls.Add(actions);
        Controls.Add(instructions);
        ActiveControl = cancel;
    }
}
