using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows.Forms;

namespace ClineOrchestrator.Launcher;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        if (!OperatingSystem.IsWindows()) return;
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new ViewerLauncherForm());
    }
}

/// <summary>
/// A user-invoked foreground host for the already-reviewed passive viewer.
/// No daemon, task, setup mutation, Windows service or release path exists here.
/// </summary>
internal sealed class ViewerLauncherForm : Form
{
    private const string ViewerUrl = "http://127.0.0.1:4321/viewer";
    private readonly Label status = new()
    {
        AutoSize = false, Height = 55, Dock = DockStyle.Top,
        Text = "Preparing local read-only viewer...", Padding = new Padding(16, 12, 16, 4),
    };
    private readonly TextBox accessCode = new()
    {
        ReadOnly = true, UseSystemPasswordChar = true, Dock = DockStyle.Top,
        Margin = new Padding(16, 4, 16, 4), Height = 32,
    };
    private readonly Button copyCode = new() { Text = "Copy access code", Enabled = false, AutoSize = true };
    private readonly Button openDashboard = new() { Text = "Open dashboard", Enabled = false, AutoSize = true };
    private readonly Button connectModel = new() { Text = "Connect local model", AutoSize = true };
    private readonly Button exit = new() { Text = "Stop viewer and close", AutoSize = true };
    private Process? viewer;
    private string? secret;
    private bool stopping;

    internal ViewerLauncherForm()
    {
        Text = "Cline Orchestrator";
        Width = 570;
        Height = 285;
        MinimumSize = new System.Drawing.Size(490, 270);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.Sizable;
        MaximizeBox = false;

        var heading = new Label
        {
            Text = "Local operator dashboard (read-only)",
            AutoSize = false, Dock = DockStyle.Top,
            Height = 43, Font = new System.Drawing.Font("Segoe UI", 12, System.Drawing.FontStyle.Bold),
            Padding = new Padding(16, 12, 8, 0),
        };
        var help = new Label
        {
            Text = "Copy the access code to sign in. It is generated for this launch and is never saved.",
            Dock = DockStyle.Top, Height = 46, Padding = new Padding(16, 7, 10, 3),
        };
        var actions = new FlowLayoutPanel
        {
            Dock = DockStyle.Top, Height = 48, Padding = new Padding(12, 3, 0, 0),
            FlowDirection = FlowDirection.LeftToRight, WrapContents = true,
        };
        actions.Controls.Add(copyCode);
        actions.Controls.Add(openDashboard);
        actions.Controls.Add(connectModel);
        actions.Controls.Add(exit);
        Controls.Add(actions);
        Controls.Add(accessCode);
        Controls.Add(help);
        Controls.Add(status);
        Controls.Add(heading);

        copyCode.Click += (_, _) =>
        {
            if (!stopping && secret is { Length: > 0 })
            {
                try { Clipboard.SetText(secret); }
                catch { status.Text = "Clipboard is unavailable. Open a new viewer session to retry."; }
            }
        };
        openDashboard.Click += (_, _) =>
        {
            if (stopping || viewer is null || viewer.HasExited) return;
            try
            {
                Process.Start(new ProcessStartInfo(ViewerUrl) { UseShellExecute = true });
            }
            catch { status.Text = "Could not open your browser. Open http://127.0.0.1:4321/viewer manually."; }
        };
        connectModel.Click += (_, _) =>
        {
            using var dialog = new LocalModelConnectionForm();
            dialog.ShowDialog(this);
        };
        exit.Click += (_, _) => Close();
        Shown += async (_, _) => await StartViewerAsync();
        FormClosing += (_, _) => StopOwnedViewer();
    }

    private async Task StartViewerAsync()
    {
        try
        {
            // There is no viewer/daemon/task process running unless the operator
            // has explicitly launched this executable.
            var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, ".."));
            var node = Path.Combine(root, "runtime", "node.exe");
            var entry = Path.Combine(root, "app", "node_modules", "cline-orchestrator", "dist", "product-cli.js");
            if (!File.Exists(node) || !File.Exists(entry))
                throw new InvalidOperationException("Installed runtime files are missing.");

            // Never reuse a token from the environment, URL, file, registry or logs.
            secret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
            var psi = new ProcessStartInfo(node)
            {
                UseShellExecute = false, WorkingDirectory = root,
                CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
            };
            psi.ArgumentList.Add(entry);
            psi.ArgumentList.Add("viewer");

            // Discard any inherited product authorities. The viewer accepts only
            // its own random viewing secret and fixed loopback port.
            foreach (string key in psi.Environment.Keys.Cast<string>().ToArray())
                if (key.StartsWith("ORCH_", StringComparison.OrdinalIgnoreCase))
                    psi.Environment.Remove(key);
            psi.Environment["ORCH_VIEWER_TOKEN"] = secret;
            psi.Environment["ORCH_VIEWER_PORT"] = "4321";
            psi.Environment["ORCH_AUTO_APPROVE_COMMANDS"] = "false";
            psi.Environment["ORCH_AUTO_APPROVE_EDITS"] = "false";

            viewer = Process.Start(psi) ?? throw new InvalidOperationException("Viewer could not start.");
            using var client = new HttpClient(new HttpClientHandler { UseProxy = false })
            {
                Timeout = TimeSpan.FromMilliseconds(1200),
            };
            for (int i = 0; i < 40; i++)
            {
                if (viewer.HasExited) throw new InvalidOperationException("Viewer stopped before it was ready.");
                try
                {
                    using var response = await client.GetAsync(ViewerUrl);
                    // 200 unauthenticated sign-in is expected for the passive viewer.
                    if (response.StatusCode == HttpStatusCode.OK)
                    {
                        status.Text = "Ready: localhost viewer. No tasks can run from this dashboard.";
                        accessCode.Text = secret;
                        copyCode.Enabled = true;
                        openDashboard.Enabled = true;
                        return;
                    }
                }
                catch (HttpRequestException) { }
                catch (TaskCanceledException) { }
                await Task.Delay(250);
            }
            throw new InvalidOperationException("Viewer did not become ready.");
        }
        catch
        {
            status.Text = "Local viewer unavailable. Check for another process using port 4321 or a damaged installation.";
            copyCode.Enabled = false;
            openDashboard.Enabled = false;
            StopOwnedViewer();
        }
    }

    private void StopOwnedViewer()
    {
        if (stopping) return;
        stopping = true;
        copyCode.Enabled = false;
        openDashboard.Enabled = false;
        accessCode.Text = "";
        secret = null;
        try
        {
            if (viewer is { HasExited: false })
            {
                viewer.Kill(entireProcessTree: true);
                viewer.WaitForExit(5000);
            }
        }
        catch
        {
            // Never terminate any other process or look up a process by name/port.
        }
        finally
        {
            viewer?.Dispose();
            viewer = null;
        }
    }
}
